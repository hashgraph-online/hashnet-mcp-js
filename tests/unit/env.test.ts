import { describe, expect, test } from "vitest";

import { isLocalHost, loadEnv, redactEnvForLogs } from "../../src/config/env.js";

describe("env loader", () => {
  test("defaults are applied", () => {
    const env = loadEnv({});
    expect(env.registryBrokerApiUrl).toBe("https://hol.org/registry/api/v1");
    expect(env.brokerRequestTimeoutMs).toBe(15_000);
    expect(env.mcpHost).toBe("127.0.0.1");
    expect(env.mcpPort).toBe(3333);
    expect(env.mcpSessionIdleTtlMs).toBe(15 * 60 * 1000);
    expect(env.mcpSessionMaxCount).toBe(250);
  });

  test("unsafe host without bearer token throws", () => {
    expect(() =>
      loadEnv({
        MCP_TRANSPORT: "http",
        MCP_HOST: "0.0.0.0",
      }),
    ).toThrow(/requires MCP_SERVER_BEARER_TOKEN/);
  });

  test("redaction hides secrets", () => {
    const env = loadEnv({
      REGISTRY_BROKER_API_KEY: "secret",
      MCP_SERVER_BEARER_TOKEN: "token",
    });

    const redacted = redactEnvForLogs(env);
    expect(redacted.registryBrokerApiKey).toBe("***REDACTED***");
    expect(redacted.mcpServerBearerToken).toBe("***REDACTED***");
  });

  test("local host helper", () => {
    expect(isLocalHost("127.0.0.1")).toBe(true);
    expect(isLocalHost("localhost")).toBe(true);
    expect(isLocalHost("::1")).toBe(true);
    expect(isLocalHost("0.0.0.0")).toBe(false);
  });
});
