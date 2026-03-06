import { describe, expect, test } from "vitest";

import { createRegistryBrokerClient } from "../../src/broker/client.js";

describe("createRegistryBrokerClient", () => {
  test("applies base URL, API key, app id, and trace id headers", () => {
    const client = createRegistryBrokerClient(
      {
        registryBrokerApiUrl: "https://example.com/registry/api/v1",
        registryBrokerApiKey: "test-key",
        brokerRequestTimeoutMs: 10_000,
      },
      "trace-123",
    ) as unknown as {
      baseUrl: string;
      getDefaultHeaders: () => Record<string, string>;
    };

    expect(client.baseUrl).toBe("https://example.com/registry/api/v1");
    const headers = client.getDefaultHeaders();
    expect(headers["x-api-key"]).toBe("test-key");
    expect(headers["x-app-id"]).toBe("hol-mcp-server-poc");
    expect(headers["x-trace-id"]).toBe("trace-123");
  });
});
