import { describe, expect, test } from "vitest";

import { getCliHelpText, parseCliArgs } from "../../src/cli/args.js";

describe("CLI args", () => {
  test("parses transport and network flags", () => {
    const result = parseCliArgs([
      "--http",
      "--host",
      "0.0.0.0",
      "--port",
      "4444",
      "--allowed-origins",
      "http://localhost:3000,http://127.0.0.1:3000",
      "--broker-url",
      "https://example.com/registry/api/v1",
      "--bearer-token",
      "token",
      "--log-level",
      "debug",
      "--legacy-sse",
    ]);

    expect(result.helpText).toBeUndefined();
    expect(result.env).toEqual({
      MCP_TRANSPORT: "http",
      MCP_HOST: "0.0.0.0",
      MCP_PORT: "4444",
      MCP_ALLOWED_ORIGINS: "http://localhost:3000,http://127.0.0.1:3000",
      REGISTRY_BROKER_API_URL: "https://example.com/registry/api/v1",
      MCP_SERVER_BEARER_TOKEN: "token",
      LOG_LEVEL: "debug",
      FEATURE_LEGACY_SSE: "1",
    });
  });

  test("returns help text", () => {
    const result = parseCliArgs(["--help"]);
    expect(result.helpText).toBe(getCliHelpText());
    expect(result.helpText).toContain("npx @hol-org/hashnet-mcp");
  });

  test("accepts optional up subcommand", () => {
    const result = parseCliArgs(["up", "--transport", "stdio"]);

    expect(result.helpText).toBeUndefined();
    expect(result.env).toEqual({
      MCP_TRANSPORT: "stdio",
    });
  });

  test("still rejects unknown positional arguments", () => {
    expect(() => parseCliArgs(["start", "--transport", "stdio"])).toThrow(
      /Unknown argument/,
    );
  });

  test("rejects invalid ports", () => {
    expect(() => parseCliArgs(["--port", "abc"])).toThrow(/positive integer/);
  });

  test("rejects unknown flags", () => {
    expect(() => parseCliArgs(["--wat"])).toThrow(/Unknown argument/);
  });
});
