import { afterEach, describe, expect, test, vi } from "vitest";
import * as standardsSdk from "@hashgraphonline/standards-sdk";

import { createBrokerRateLimiter } from "../../src/broker/rateLimit.js";
import type { EnvConfig } from "../../src/config/env.js";
import { createMcpServer } from "../../src/mcp/createServer.js";
import { createLogger } from "../../src/observability/logger.js";
import { runStreamableHttp, type RunningHttpServer } from "../../src/transports/httpStreamable.js";

const protocolVersion = "2025-06-18";

async function postJson(
  url: string,
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
): Promise<{ response: Response; payload: any }> {
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
  let payload: any;

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

    const port = 3500 + Math.floor(Math.random() * 300);
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
});
