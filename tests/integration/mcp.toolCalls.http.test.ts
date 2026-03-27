import { afterEach, describe, expect, test, vi } from "vitest";
import * as standardsSdk from "@hashgraphonline/standards-sdk";

import { createBrokerRateLimiter } from "../../src/broker/rateLimit.js";
import type { EnvConfig } from "../../src/config/env.js";
import { createMcpServer } from "../../src/mcp/createServer.js";
import { createLogger } from "../../src/observability/logger.js";
import { createRequestRateLimiter } from "../../src/transports/requestRateLimit.js";
import { runStreamableHttp, type RunningHttpServer } from "../../src/transports/httpStreamable.js";

const protocolVersion = "2025-06-18";
const testPortStride = 100;

function randomTestPort(base: number): number {
  return base + Math.floor(Math.random() * testPortStride);
}

interface JsonRpcPayload {
  error?: { message?: string };
  result?: {
    tools?: Array<{ name: string }>;
    isError?: boolean;
    structuredContent?: {
      ok?: boolean;
      error?: { message?: string };
      data?: {
        server?: { name?: string };
        stats?: { totalAgents?: number };
      };
    };
  };
}

async function postJson(
  url: string,
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
): Promise<{ response: Response; payload: JsonRpcPayload }> {
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
  let payload: JsonRpcPayload;

  if (contentType.includes("application/json")) {
    payload = JSON.parse(raw);
  } else if (contentType.includes("text/event-stream") || raw.includes("event:")) {
    const dataLine = raw
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.startsWith("data:"));

    if (!dataLine) {
      throw new Error(`No SSE data line found in response: ${raw}`);
    }

    payload = JSON.parse(dataLine.replace(/^data:\s*/, ""));
  } else {
    throw new Error(`Unexpected response content-type=${contentType} body=${raw}`);
  }

  return { response, payload };
}

describe("MCP HTTP tool calls", () => {
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

  test("initialize -> tools/list -> hol.stats with mocked broker call", async () => {
    const BrokerCtor = (standardsSdk as Record<string, unknown>).RegistryBrokerClient as {
      prototype: Record<string, unknown>;
    };

    vi.spyOn(BrokerCtor.prototype as { stats: () => Promise<unknown> }, "stats").mockResolvedValue({
      totalAgents: 42,
      totalRegistries: 3,
    });

    const port = randomTestPort(30_100);
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

    const createServer = () =>
      createMcpServer({
        env,
        flags,
        logger,
        rateLimiter: rateLimiter!,
      });

    running = await runStreamableHttp({ env, flags, logger, createServer });
    const url = `http://${env.mcpHost}:${env.mcpPort}/mcp`;
    const healthUrl = `http://${env.mcpHost}:${env.mcpPort}/healthz`;

    const initialHealthResponse = await fetch(healthUrl);
    const initialHealth = (await initialHealthResponse.json()) as {
      status: string;
      sessions: { activeSessions: number };
    };
    expect(initialHealth.status).toBe("ok");
    expect(initialHealth.sessions.activeSessions).toBe(0);

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

    expect(initialize.payload.error).toBeUndefined();
    const sessionId = initialize.response.headers.get("mcp-session-id");
    expect(sessionId).toBeTruthy();

    const initializedHealthResponse = await fetch(healthUrl);
    const initializedHealth = (await initializedHealthResponse.json()) as {
      sessions: { activeSessions: number };
    };
    expect(initializedHealth.sessions.activeSessions).toBe(1);

    const commonHeaders = {
      "mcp-session-id": String(sessionId),
      "mcp-protocol-version": protocolVersion,
    };

    const tools = await postJson(
      url,
      {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/list",
        params: {},
      },
      commonHeaders,
    );

    expect(tools.payload.error).toBeUndefined();
    const listedTools = tools.payload.result?.tools as Array<{ name: string }>;
    const expectedTools = [
      "hol.stats",
      "hol.capabilities",
      "hol.search",
      "hol.vectorSearch",
      "hol.resolveUaid",
      "hol.chat.createSession",
      "hol.chat.sendMessage",
      "hol.chat.history",
      "hol.chat.end",
      "hol.getRegistrationQuote",
      "hol.registerAgent",
      "hol.waitForRegistrationCompletion",
      "workflow.delegate",
      "workflow.discovery",
      "workflow.registration",
    ];

    const listedNames = new Set(listedTools.map((tool) => tool.name));
    for (const expectedTool of expectedTools) {
      expect(listedNames.has(expectedTool), `missing tool: ${expectedTool}`).toBe(true);
    }

    const capabilities = await postJson(
      url,
      {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: {
          name: "hol.capabilities",
          arguments: {},
        },
      },
      commonHeaders,
    );

    expect(capabilities.payload.error).toBeUndefined();
    expect(capabilities.payload.result?.isError).not.toBe(true);
    expect(capabilities.payload.result?.structuredContent?.ok).toBe(true);
    expect(capabilities.payload.result?.structuredContent?.data?.server?.name).toBe("hol-mcp-server-poc");

    const stats = await postJson(
      url,
      {
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: {
          name: "hol.stats",
          arguments: {},
        },
      },
      commonHeaders,
    );

    expect(stats.payload.error).toBeUndefined();
    expect(stats.payload.result?.isError).not.toBe(true);
    expect(stats.payload.result?.structuredContent?.ok).toBe(true);
    expect(stats.payload.result?.structuredContent?.data?.stats?.totalAgents).toBe(42);
  });

  test("delegates a task end to end with cached ledger auth when no broker API key is configured", async () => {
    const BrokerCtor = (standardsSdk as Record<string, unknown>).RegistryBrokerClient as {
      prototype: Record<string, unknown>;
    };

    const authenticateSpy = vi
      .spyOn(
        BrokerCtor.prototype as {
          authenticateWithLedgerCredentials: () => Promise<unknown>;
        },
        "authenticateWithLedgerCredentials",
      )
      .mockResolvedValue({
        key: "issued-ledger-key",
        accountId: "0.0.12345",
        network: "hedera:testnet",
        apiKey: {
          id: "api-key-1",
          prefix: "issued",
          lastFour: "1234",
          createdAt: "2026-03-13T00:00:00.000Z",
        },
      });
    vi.spyOn(BrokerCtor.prototype as { search: () => Promise<unknown> }, "search").mockResolvedValue({
      hits: [
        {
          name: "Unroutable Candidate",
          available: true,
          communicationSupported: true,
          routingSupported: true,
          trustScore: 100,
        },
        {
          uaid: "uaid:delegate-1",
          name: "Primary Candidate",
          description: "Reviews TypeScript changes",
          registry: "hashgraph-online",
          endpoint: "https://delegate.example.com/mcp",
          score: 0.99,
          available: true,
          communicationSupported: true,
          routingSupported: true,
        },
        {
          uaid: "uaid:delegate-2",
          name: "Registry Reviewer",
          description: "Reviews TypeScript changes",
          registry: "hashgraph-online",
          endpoint: "https://delegate-2.example.com/mcp",
          score: 0.88,
          available: false,
          communicationSupported: true,
          routingSupported: true,
        },
      ],
    });
    vi.spyOn(BrokerCtor.prototype as { createSession: () => Promise<unknown> }, "createSession")
      .mockRejectedValueOnce(new Error("upstream timeout"))
      .mockResolvedValue({
        sessionId: "session-123",
      });
    vi.spyOn(BrokerCtor.prototype as { sendMessage: () => Promise<unknown> }, "sendMessage").mockResolvedValue({
      messageId: "message-1",
      accepted: true,
    });

    const port = randomTestPort(30_300);
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
      hederaPrivateKey: "302e020100300506032b657004220420fakeprivatekeyfakeprivatekeyfakep",
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

    const createServer = () =>
      createMcpServer({
        env,
        flags,
        logger,
        rateLimiter: rateLimiter!,
      });

    running = await runStreamableHttp({ env, flags, logger, createServer });
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

    expect(initialize.payload.error).toBeUndefined();
    const sessionId = initialize.response.headers.get("mcp-session-id");
    expect(sessionId).toBeTruthy();

    const delegate = await postJson(
      url,
      {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: {
          name: "workflow.delegate",
          arguments: {
            task: "Review the pending TypeScript changes for regressions.",
            query: "typescript code review specialist",
            limit: 3,
          },
        },
      },
      {
        "mcp-session-id": String(sessionId),
        "mcp-protocol-version": protocolVersion,
      },
    );

    expect(delegate.payload.error).toBeUndefined();
    expect(delegate.payload.result?.isError).not.toBe(true);
    expect(delegate.payload.result?.structuredContent?.ok).toBe(true);

    const delegateData = delegate.payload.result?.structuredContent?.data as
      | {
          candidateCount?: number;
          selectedAgent?: { uaid?: string; name?: string };
          session?: { sessionId?: string };
        }
      | undefined;

    expect(delegateData?.candidateCount).toBe(2);
    expect(delegateData?.selectedAgent?.uaid).toBe("uaid:delegate-2");
    expect(delegateData?.selectedAgent?.name).toBe("Registry Reviewer");
    expect(delegateData?.session?.sessionId).toBe("session-123");
    expect(authenticateSpy).toHaveBeenCalledTimes(1);
  });

  test("does not retry a different candidate after sendMessage fails", async () => {
    const BrokerCtor = (standardsSdk as Record<string, unknown>).RegistryBrokerClient as {
      prototype: Record<string, unknown>;
    };

    vi.spyOn(
      BrokerCtor.prototype as {
        authenticateWithLedgerCredentials: () => Promise<unknown>;
      },
      "authenticateWithLedgerCredentials",
    ).mockResolvedValue({
      key: "issued-ledger-key",
      accountId: "0.0.12345",
      network: "hedera:testnet",
      apiKey: {
        id: "api-key-1",
        prefix: "issued",
        lastFour: "1234",
        createdAt: "2026-03-13T00:00:00.000Z",
      },
    });
    vi.spyOn(BrokerCtor.prototype as { search: () => Promise<unknown> }, "search").mockResolvedValue({
      hits: [
        {
          uaid: "uaid:delegate-1",
          name: "Primary Candidate",
          description: "Reviews TypeScript changes",
          registry: "hashgraph-online",
          endpoint: "https://delegate.example.com/mcp",
          score: 0.99,
          available: true,
          communicationSupported: true,
          routingSupported: true,
        },
        {
          uaid: "uaid:delegate-2",
          name: "Registry Reviewer",
          description: "Reviews TypeScript changes",
          registry: "hashgraph-online",
          endpoint: "https://delegate-2.example.com/mcp",
          score: 0.88,
          available: false,
          communicationSupported: true,
          routingSupported: true,
        },
      ],
    });
    const createSessionSpy = vi
      .spyOn(BrokerCtor.prototype as { createSession: () => Promise<unknown> }, "createSession")
      .mockResolvedValue({
        sessionId: "session-123",
      });
    const sendMessageSpy = vi
      .spyOn(BrokerCtor.prototype as { sendMessage: () => Promise<unknown> }, "sendMessage")
      .mockRejectedValue(new Error("upstream timeout"));

    const port = randomTestPort(30_400);
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
      hederaPrivateKey: "302e020100300506032b657004220420fakeprivatekeyfakeprivatekeyfakep",
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

    const createServer = () =>
      createMcpServer({
        env,
        flags,
        logger,
        rateLimiter: rateLimiter!,
      });

    running = await runStreamableHttp({ env, flags, logger, createServer });
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

    expect(initialize.payload.error).toBeUndefined();
    const sessionId = initialize.response.headers.get("mcp-session-id");
    expect(sessionId).toBeTruthy();

    const delegate = await postJson(
      url,
      {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: {
          name: "workflow.delegate",
          arguments: {
            task: "Review the pending TypeScript changes for regressions.",
            query: "typescript code review specialist",
            limit: 3,
          },
        },
      },
      {
        "mcp-session-id": String(sessionId),
        "mcp-protocol-version": protocolVersion,
      },
    );

    expect(delegate.payload.error).toBeUndefined();
    expect(delegate.payload.result?.isError).toBe(true);
    expect(delegate.payload.result?.structuredContent?.error?.message).toContain("upstream timeout");
    expect(createSessionSpy).toHaveBeenCalledTimes(1);
    expect(sendMessageSpy).toHaveBeenCalledTimes(1);
  });

  test("returns 429 when the streamable HTTP request budget is exhausted", async () => {
    const port = randomTestPort(30_500);
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

    const createServer = () =>
      createMcpServer({
        env,
        flags,
        logger,
        rateLimiter: rateLimiter!,
      });

    running = await runStreamableHttp({
      env,
      flags,
      logger,
      createServer,
      requestRateLimiter: createRequestRateLimiter({
        maxRequests: 1,
        windowMs: 60_000,
      }),
    });

    const url = `http://${env.mcpHost}:${env.mcpPort}/mcp`;
    const requestBody = {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion,
        capabilities: { tools: {}, logging: {} },
        clientInfo: { name: "integration-test", version: "0.1.0" },
      },
    };

    const first = await postJson(url, requestBody, {
      "mcp-protocol-version": protocolVersion,
    });
    expect(first.response.status).toBe(200);

    const second = await postJson(url, requestBody, {
      "mcp-protocol-version": protocolVersion,
    });
    expect(second.response.status).toBe(429);
    expect(second.payload.error?.message).toContain("Rate limit exceeded");
  });

  test("rate limits streamable HTTP requests before bearer auth", async () => {
    const port = randomTestPort(30_700);
    const env: EnvConfig = {
      registryBrokerApiUrl: "https://example.com/registry/api/v1",
      registryBrokerApiKey: "integration-test-key",
      brokerRequestTimeoutMs: 10_000,
      mcpTransport: "http",
      mcpHost: "127.0.0.1",
      mcpPort: port,
      mcpAllowedOrigins: ["http://localhost:*", "http://127.0.0.1:*"],
      mcpServerBearerToken: "test-secret",
      mcpSessionIdleTtlMs: 60_000,
      mcpSessionMaxCount: 10,
      mcpSessionReapIntervalMs: 1_000,
      logLevel: "silent",
      brokerRateLimitConcurrency: 5,
      brokerRateLimitMinTimeMs: 1,
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

    const createServer = () =>
      createMcpServer({
        env,
        flags,
        logger,
        rateLimiter: rateLimiter!,
      });

    running = await runStreamableHttp({
      env,
      flags,
      logger,
      createServer,
      requestRateLimiter: createRequestRateLimiter({
        maxRequests: 1,
        windowMs: 60_000,
      }),
    });

    const url = `http://${env.mcpHost}:${env.mcpPort}/mcp`;
    const requestBody = {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion,
        capabilities: { tools: {}, logging: {} },
        clientInfo: { name: "integration-test", version: "0.1.0" },
      },
    };

    const first = await postJson(url, requestBody, {
      "mcp-protocol-version": protocolVersion,
    });
    expect(first.response.status).toBe(401);

    const second = await postJson(url, requestBody, {
      "mcp-protocol-version": protocolVersion,
    });
    expect(second.response.status).toBe(429);
    expect(second.payload.error?.message).toContain("Rate limit exceeded");
  });

  test("returns 429 when the legacy SSE request budget is exhausted", async () => {
    const port = randomTestPort(30_900);
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
      hederaNetwork: undefined,
      hederaAccountId: undefined,
      hederaPrivateKey: undefined,
      evmLedgerNetwork: undefined,
      ethPrivateKey: undefined,
      rbEncryptionPrivateKey: undefined,
    };

    const flags = {
      featureLegacySse: true,
      featureMemorySqlite: false,
      featureMemoryRedis: false,
      featureLedgerAuth: false,
      featureEncryptedChat: false,
    };

    const logger = createLogger({ logLevel: "silent" });
    rateLimiter = createBrokerRateLimiter(env);

    const createServer = () =>
      createMcpServer({
        env,
        flags,
        logger,
        rateLimiter: rateLimiter!,
      });

    running = await runStreamableHttp({
      env,
      flags,
      logger,
      createServer,
      requestRateLimiter: createRequestRateLimiter({
        maxRequests: 1,
        windowMs: 60_000,
      }),
    });

    const url = `http://${env.mcpHost}:${env.mcpPort}/mcp/sse`;
    const first = await fetch(url, {
      headers: {
        accept: "text/event-stream",
      },
    });
    expect(first.status).toBe(200);
    await first.body?.cancel();

    const second = await fetch(url, {
      headers: {
        accept: "text/event-stream",
      },
    });
    expect(second.status).toBe(429);
    const payload = (await second.json()) as {
      error?: { message?: string };
    };
    expect(payload.error?.message).toContain("Rate limit exceeded");
  });

  test("rate limits legacy SSE requests before bearer auth", async () => {
    const port = randomTestPort(31_100);
    const env: EnvConfig = {
      registryBrokerApiUrl: "https://example.com/registry/api/v1",
      registryBrokerApiKey: "integration-test-key",
      brokerRequestTimeoutMs: 10_000,
      mcpTransport: "http",
      mcpHost: "127.0.0.1",
      mcpPort: port,
      mcpAllowedOrigins: ["http://localhost:*", "http://127.0.0.1:*"],
      mcpServerBearerToken: "test-secret",
      mcpSessionIdleTtlMs: 60_000,
      mcpSessionMaxCount: 10,
      mcpSessionReapIntervalMs: 1_000,
      logLevel: "silent",
      brokerRateLimitConcurrency: 5,
      brokerRateLimitMinTimeMs: 1,
      hederaNetwork: undefined,
      hederaAccountId: undefined,
      hederaPrivateKey: undefined,
      evmLedgerNetwork: undefined,
      ethPrivateKey: undefined,
      rbEncryptionPrivateKey: undefined,
    };

    const flags = {
      featureLegacySse: true,
      featureMemorySqlite: false,
      featureMemoryRedis: false,
      featureLedgerAuth: false,
      featureEncryptedChat: false,
    };

    const logger = createLogger({ logLevel: "silent" });
    rateLimiter = createBrokerRateLimiter(env);

    const createServer = () =>
      createMcpServer({
        env,
        flags,
        logger,
        rateLimiter: rateLimiter!,
      });

    running = await runStreamableHttp({
      env,
      flags,
      logger,
      createServer,
      requestRateLimiter: createRequestRateLimiter({
        maxRequests: 1,
        windowMs: 60_000,
      }),
    });

    const url = `http://${env.mcpHost}:${env.mcpPort}/mcp/sse`;
    const first = await fetch(url, {
      headers: {
        accept: "text/event-stream",
      },
    });
    expect(first.status).toBe(401);

    const second = await fetch(url, {
      headers: {
        accept: "text/event-stream",
      },
    });
    expect(second.status).toBe(429);
    const payload = (await second.json()) as {
      error?: { message?: string };
    };
    expect(payload.error?.message).toContain("Rate limit exceeded");
  });
});
