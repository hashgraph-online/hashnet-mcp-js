import { afterEach, describe, expect, test, vi } from "vitest";
import * as standardsSdk from "@hashgraphonline/standards-sdk";

import { createBrokerRateLimiter } from "../../src/broker/rateLimit.js";
import type { EnvConfig } from "../../src/config/env.js";
import { createMcpServer } from "../../src/mcp/createServer.js";
import { createLogger } from "../../src/observability/logger.js";
import { runStreamableHttp, type RunningHttpServer } from "../../src/transports/httpStreamable.js";

const protocolVersion = "2025-06-18";
const testPortStride = 100;

function randomTestPort(base: number): number {
  return base + Math.floor(Math.random() * testPortStride);
}

async function postJson(
  url: string,
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
): Promise<{ response: Response; payload: Record<string, unknown> }> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...headers,
    },
    body: JSON.stringify(body),
  });

  const contentType = response.headers.get("content-type") ?? "";
  const raw = await response.text();
  let payload: Record<string, unknown>;

  if (contentType.includes("application/json")) {
    payload = JSON.parse(raw) as Record<string, unknown>;
  } else if (contentType.includes("text/event-stream") || raw.includes("event:")) {
    const dataLine = raw
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.startsWith("data:"));

    if (!dataLine) {
      throw new Error(`No SSE data line found in response: ${raw}`);
    }

    payload = JSON.parse(dataLine.replace(/^data:\s*/, "")) as Record<string, unknown>;
  } else {
    throw new Error(`Unexpected response content-type=${contentType} body=${raw}`);
  }

  return { response, payload };
}

describe("Guard MCP tools", () => {
  let running: RunningHttpServer | undefined;
  let rateLimiter: ReturnType<typeof createBrokerRateLimiter> | undefined;

  afterEach(async () => {
    vi.restoreAllMocks();
    if (running) {
      await running.close();
      running = undefined;
    }
    if (rateLimiter) {
      await rateLimiter.stop();
      rateLimiter = undefined;
    }
  });

  test("calls the Guard tool surface through the released RegistryBrokerClient", async () => {
    const BrokerCtor = (standardsSdk as Record<string, unknown>).RegistryBrokerClient as {
      prototype: Record<string, unknown>;
    };

    vi.spyOn(BrokerCtor.prototype as { getGuardSession: () => Promise<unknown> }, "getGuardSession").mockResolvedValue({
      principal: { signedIn: false, roles: [] },
      entitlements: {
        planId: "free",
        includedMonthlyCredits: 250,
        deviceLimit: 1,
        retentionDays: 7,
        syncEnabled: false,
        premiumFeedsEnabled: false,
        teamPolicyEnabled: false,
      },
      balance: null,
      bucketingMode: "shared-ledger",
      buckets: [],
    });
    vi.spyOn(
      BrokerCtor.prototype as { getGuardEntitlements: () => Promise<unknown> },
      "getGuardEntitlements",
    ).mockResolvedValue({
      principal: { signedIn: true, roles: ["user"] },
      entitlements: {
        planId: "pro",
        includedMonthlyCredits: 1000,
        deviceLimit: 3,
        retentionDays: 30,
        syncEnabled: true,
        premiumFeedsEnabled: true,
        teamPolicyEnabled: false,
      },
      balance: { accountId: "0.0.1001", availableCredits: 420 },
      bucketingMode: "product-bucketed",
      buckets: [],
    });
    vi.spyOn(
      BrokerCtor.prototype as { getGuardBillingBalance: () => Promise<unknown> },
      "getGuardBillingBalance",
    ).mockResolvedValue({
      generatedAt: "2026-04-10T00:00:00.000Z",
      bucketingMode: "product-bucketed",
      buckets: [
        {
          bucketId: "guard_credits",
          label: "Guard",
          availableCredits: 420,
          includedMonthlyCredits: 1000,
        },
      ],
    });
    vi.spyOn(
      BrokerCtor.prototype as { getGuardTrustByHash: (sha256: string) => Promise<unknown> },
      "getGuardTrustByHash",
    ).mockResolvedValue({
      generatedAt: "2026-04-10T00:00:00.000Z",
      query: { sha256: "abc123" },
      match: {
        artifactId: "artifact-1",
        artifactName: "hashnet-mcp",
        artifactType: "plugin",
        artifactSlug: "hashnet-mcp",
        recommendation: "review",
        verified: true,
        safetyScore: 92,
        trustScore: 88,
      },
      evidence: ["published release"],
    });
    const resolveGuardTrustSpy = vi.spyOn(
      BrokerCtor.prototype as { resolveGuardTrust: (query: Record<string, unknown>) => Promise<unknown> },
      "resolveGuardTrust",
    ).mockResolvedValue({
      generatedAt: "2026-04-10T00:00:00.000Z",
      query: { ecosystem: "mcp", name: "hashnet-mcp", version: "1.0.0" },
      items: [
        {
          artifactId: "artifact-1",
          artifactName: "hashnet-mcp",
          artifactType: "plugin",
          artifactSlug: "hashnet-mcp",
          recommendation: "monitor",
          verified: true,
        },
      ],
    });
    vi.spyOn(
      BrokerCtor.prototype as { getGuardRevocations: () => Promise<unknown> },
      "getGuardRevocations",
    ).mockResolvedValue({
      generatedAt: "2026-04-10T00:00:00.000Z",
      items: [
        {
          id: "revocation-1",
          artifactId: "artifact-2",
          artifactName: "legacy-plugin",
          reason: "Remote endpoint rotated unexpectedly",
          severity: "high",
          publishedAt: "2026-04-09T00:00:00.000Z",
        },
      ],
    });
    vi.spyOn(
      BrokerCtor.prototype as { syncGuardReceipts: (payload: Record<string, unknown>) => Promise<unknown> },
      "syncGuardReceipts",
    ).mockResolvedValue({
      syncedAt: "2026-04-10T00:00:00.000Z",
      receiptsStored: 1,
    });

    const port = randomTestPort(31_300);
    const env: EnvConfig = {
      registryBrokerApiUrl: "https://example.com/registry/api/v1",
      registryBrokerApiKey: "integration-test-key",
      brokerRequestTimeoutMs: 10_000,
      mcpTransport: "http",
      mcpHost: "127.0.0.1",
      mcpPort: port,
      mcpAllowedOrigins: ["http://localhost:*", "http://127.0.0.1:*"],
      mcpServerBearerToken: undefined,
      mcpSessionIdleTtlMs: 60_000,
      mcpSessionMaxCount: 10,
      mcpSessionReapIntervalMs: 1_000,
      logLevel: "silent",
      brokerRateLimitConcurrency: 5,
      brokerRateLimitMinTimeMs: 1,
      ledgerAccountId: undefined,
      hederaNetwork: undefined,
      hederaAccountId: undefined,
      hederaPrivateKey: undefined,
      evmLedgerNetwork: undefined,
      ethPrivateKey: undefined,
      rbEncryptionPrivateKey: undefined,
    };

    const flags = {
      featureLegacySse: false,
      featureMemorySqlite: false,
      featureMemoryRedis: false,
      featureLedgerAuth: false,
      featureEncryptedChat: false,
    };

    const logger = createLogger({ logLevel: "silent" });
    rateLimiter = createBrokerRateLimiter(env);

    running = await runStreamableHttp({
      env,
      flags,
      logger,
      createServer: () =>
        createMcpServer({
          env,
          flags,
          logger,
          rateLimiter: rateLimiter!,
        }),
    });

    const url = `http://${env.mcpHost}:${env.mcpPort}/mcp`;
    const initialize = await postJson(
      url,
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion,
          capabilities: { tools: {}, logging: {} },
          clientInfo: { name: "integration-test", version: "0.1.0" },
        },
      },
      {
        "mcp-protocol-version": protocolVersion,
      },
    );

    const sessionId = initialize.response.headers.get("mcp-session-id");
    expect(sessionId).toBeTruthy();

    const headers = {
      "mcp-session-id": String(sessionId),
      "mcp-protocol-version": protocolVersion,
    };

    const sessionCall = await postJson(
      url,
      {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "hol.guard.session", arguments: {} },
      },
      headers,
    );
    const trustCall = await postJson(
      url,
      {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: {
          name: "hol.guard.resolveTrust",
          arguments: { ecosystem: " ", name: "hashnet-mcp", version: "1.0.0" },
        },
      },
      headers,
    );
    const hashCall = await postJson(
      url,
      {
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: {
          name: "hol.guard.trustByHash",
          arguments: { sha256: "abc123" },
        },
      },
      headers,
    );
    const revocationsCall = await postJson(
      url,
      {
        jsonrpc: "2.0",
        id: 5,
        method: "tools/call",
        params: { name: "hol.guard.revocations", arguments: {} },
      },
      headers,
    );
    const entitlementsCall = await postJson(
      url,
      {
        jsonrpc: "2.0",
        id: 6,
        method: "tools/call",
        params: { name: "hol.guard.entitlements", arguments: {} },
      },
      headers,
    );
    const billingCall = await postJson(
      url,
      {
        jsonrpc: "2.0",
        id: 7,
        method: "tools/call",
        params: { name: "hol.guard.billingBalance", arguments: {} },
      },
      headers,
    );
    const syncCall = await postJson(
      url,
      {
        jsonrpc: "2.0",
        id: 8,
        method: "tools/call",
        params: {
          name: "hol.guard.syncReceipts",
          arguments: {
            receipts: [
              {
                receiptId: "receipt-1",
                capturedAt: "2026-04-10T00:00:00.000Z",
                harness: "codex",
                deviceId: "device-1",
                deviceName: "MacBook",
                artifactId: "artifact-1",
                artifactName: "hashnet-mcp",
                artifactType: "plugin",
                artifactSlug: "hashnet-mcp",
                artifactHash: "abc123",
                policyDecision: "allow",
                recommendation: "monitor",
                changedSinceLastApproval: false,
                capabilities: ["search"],
                summary: "Initial approval",
              },
            ],
          },
        },
      },
      headers,
    );

    expect((sessionCall.payload.result as { isError?: boolean })?.isError).not.toBe(true);
    expect((trustCall.payload.result as { isError?: boolean })?.isError).not.toBe(true);
    expect((hashCall.payload.result as { isError?: boolean })?.isError).not.toBe(true);
    expect((revocationsCall.payload.result as { isError?: boolean })?.isError).not.toBe(true);
    expect((entitlementsCall.payload.result as { isError?: boolean })?.isError).not.toBe(true);
    expect((billingCall.payload.result as { isError?: boolean })?.isError).not.toBe(true);
    expect((syncCall.payload.result as { isError?: boolean })?.isError).not.toBe(true);

    const sessionData = (sessionCall.payload.result as { structuredContent?: { data?: { session?: { principal?: { signedIn?: boolean } } } } })
      ?.structuredContent?.data;
    const billingData = (billingCall.payload.result as { structuredContent?: { data?: { balance?: { buckets?: Array<{ availableCredits?: number }> } } } })
      ?.structuredContent?.data;
    const syncData = (syncCall.payload.result as { structuredContent?: { data?: { sync?: { receiptsStored?: number } } } })
      ?.structuredContent?.data;

    expect(sessionData?.session?.principal?.signedIn).toBe(false);
    expect(billingData?.balance?.buckets?.[0]?.availableCredits).toBe(420);
    expect(syncData?.sync?.receiptsStored).toBe(1);
    expect(resolveGuardTrustSpy).toHaveBeenCalledWith({
      name: "hashnet-mcp",
      version: "1.0.0",
    });
  });

  test("authenticates Guard session and entitlements when ledger auth is configured", async () => {
    const BrokerCtor = (standardsSdk as Record<string, unknown>).RegistryBrokerClient as {
      prototype: Record<string, unknown>;
    };

    const authenticateWithLedgerCredentialsSpy = vi
      .spyOn(
        BrokerCtor.prototype as {
          authenticateWithLedgerCredentials: (options: Record<string, unknown>) => Promise<unknown>;
        },
        "authenticateWithLedgerCredentials",
      )
      .mockResolvedValue({
        key: "issued-ledger-key",
        accountId: "0.0.12345",
        network: "hedera:testnet",
        apiKey: {
          prefix: "issued",
          lastFour: "1234",
        },
      });
    const getGuardSessionSpy = vi
      .spyOn(BrokerCtor.prototype as { getGuardSession: () => Promise<unknown> }, "getGuardSession")
      .mockResolvedValue({
        principal: { signedIn: true, roles: ["user"] },
        entitlements: {
          planId: "pro",
          includedMonthlyCredits: 1000,
          deviceLimit: 3,
          retentionDays: 30,
          syncEnabled: true,
          premiumFeedsEnabled: true,
          teamPolicyEnabled: false,
        },
        balance: { accountId: "0.0.12345", availableCredits: 420 },
        bucketingMode: "product-bucketed",
        buckets: [],
      });
    const getGuardEntitlementsSpy = vi
      .spyOn(
        BrokerCtor.prototype as { getGuardEntitlements: () => Promise<unknown> },
        "getGuardEntitlements",
      )
      .mockResolvedValue({
        principal: { signedIn: true, roles: ["user"] },
        entitlements: {
          planId: "pro",
          includedMonthlyCredits: 1000,
          deviceLimit: 3,
          retentionDays: 30,
          syncEnabled: true,
          premiumFeedsEnabled: true,
          teamPolicyEnabled: false,
        },
        balance: { accountId: "0.0.12345", availableCredits: 420 },
        bucketingMode: "product-bucketed",
        buckets: [],
      });

    const port = randomTestPort(31_500);
    const env: EnvConfig = {
      registryBrokerApiUrl: "https://example.com/registry/api/v1",
      registryBrokerApiKey: undefined,
      brokerRequestTimeoutMs: 10_000,
      mcpTransport: "http",
      mcpHost: "127.0.0.1",
      mcpPort: port,
      mcpAllowedOrigins: ["http://localhost:*", "http://127.0.0.1:*"],
      mcpServerBearerToken: undefined,
      mcpSessionIdleTtlMs: 60_000,
      mcpSessionMaxCount: 10,
      mcpSessionReapIntervalMs: 1_000,
      logLevel: "silent",
      brokerRateLimitConcurrency: 5,
      brokerRateLimitMinTimeMs: 1,
      ledgerAccountId: "0.0.12345",
      hederaNetwork: "hedera:testnet",
      hederaAccountId: "0.0.12345",
      hederaPrivateKey: "hedera-private-key",
      evmLedgerNetwork: undefined,
      ethPrivateKey: undefined,
      rbEncryptionPrivateKey: undefined,
    };

    const flags = {
      featureLegacySse: false,
      featureMemorySqlite: false,
      featureMemoryRedis: false,
      featureLedgerAuth: true,
      featureEncryptedChat: false,
    };

    const logger = createLogger({ logLevel: "silent" });
    rateLimiter = createBrokerRateLimiter(env);

    running = await runStreamableHttp({
      env,
      flags,
      logger,
      createServer: () =>
        createMcpServer({
          env,
          flags,
          logger,
          rateLimiter: rateLimiter!,
        }),
    });

    const url = `http://${env.mcpHost}:${env.mcpPort}/mcp`;
    const initialize = await postJson(
      url,
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion,
          capabilities: { tools: {}, logging: {} },
          clientInfo: { name: "integration-test", version: "0.1.0" },
        },
      },
      {
        "mcp-protocol-version": protocolVersion,
      },
    );

    const sessionId = initialize.response.headers.get("mcp-session-id");
    expect(sessionId).toBeTruthy();

    const headers = {
      "mcp-session-id": String(sessionId),
      "mcp-protocol-version": protocolVersion,
    };

    const sessionCall = await postJson(
      url,
      {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "hol.guard.session", arguments: {} },
      },
      headers,
    );
    const entitlementsCall = await postJson(
      url,
      {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "hol.guard.entitlements", arguments: {} },
      },
      headers,
    );

    expect((sessionCall.payload.result as { isError?: boolean })?.isError).not.toBe(true);
    expect((entitlementsCall.payload.result as { isError?: boolean })?.isError).not.toBe(true);
    expect(authenticateWithLedgerCredentialsSpy).toHaveBeenCalledTimes(1);
    expect(getGuardSessionSpy).toHaveBeenCalledTimes(1);
    expect(getGuardEntitlementsSpy).toHaveBeenCalledTimes(1);
  });

  test("returns a structured auth error for Guard session without paid auth", async () => {
    const port = randomTestPort(31_700);
    const env: EnvConfig = {
      registryBrokerApiUrl: "https://example.com/registry/api/v1",
      registryBrokerApiKey: undefined,
      brokerRequestTimeoutMs: 10_000,
      mcpTransport: "http",
      mcpHost: "127.0.0.1",
      mcpPort: port,
      mcpAllowedOrigins: ["http://localhost:*", "http://127.0.0.1:*"],
      mcpServerBearerToken: undefined,
      mcpSessionIdleTtlMs: 60_000,
      mcpSessionMaxCount: 10,
      mcpSessionReapIntervalMs: 1_000,
      logLevel: "silent",
      brokerRateLimitConcurrency: 5,
      brokerRateLimitMinTimeMs: 1,
      ledgerAccountId: undefined,
      hederaNetwork: undefined,
      hederaAccountId: undefined,
      hederaPrivateKey: undefined,
      evmLedgerNetwork: undefined,
      ethPrivateKey: undefined,
      rbEncryptionPrivateKey: undefined,
    };

    const flags = {
      featureLegacySse: false,
      featureMemorySqlite: false,
      featureMemoryRedis: false,
      featureLedgerAuth: false,
      featureEncryptedChat: false,
    };

    const logger = createLogger({ logLevel: "silent" });
    rateLimiter = createBrokerRateLimiter(env);

    running = await runStreamableHttp({
      env,
      flags,
      logger,
      createServer: () =>
        createMcpServer({
          env,
          flags,
          logger,
          rateLimiter: rateLimiter!,
        }),
    });

    const url = `http://${env.mcpHost}:${env.mcpPort}/mcp`;
    const initialize = await postJson(
      url,
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion,
          capabilities: { tools: {}, logging: {} },
          clientInfo: { name: "integration-test", version: "0.1.0" },
        },
      },
      {
        "mcp-protocol-version": protocolVersion,
      },
    );

    const sessionId = initialize.response.headers.get("mcp-session-id");
    expect(sessionId).toBeTruthy();

    const headers = {
      "mcp-session-id": String(sessionId),
      "mcp-protocol-version": protocolVersion,
    };

    const sessionCall = await postJson(
      url,
      {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "hol.guard.session", arguments: {} },
      },
      headers,
    );

    expect((sessionCall.payload.result as { isError?: boolean })?.isError).toBe(true);
    expect(
      (
        sessionCall.payload.result as {
          structuredContent?: { error?: { code?: string; category?: string } };
        }
      )?.structuredContent?.error,
    ).toMatchObject({
      code: "AUTH_REQUIRED",
      category: "auth",
    });
  });
});
