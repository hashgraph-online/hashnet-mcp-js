import { describe, expect, test } from "vitest";
import * as standardsSdk from "@hashgraphonline/standards-sdk";

import { toMcpToolError } from "../../src/broker/errors.js";

describe("toMcpToolError", () => {
  test("maps RegistryBrokerError shape", () => {
    const RegistryBrokerErrorCtor = (standardsSdk as Record<string, unknown>).RegistryBrokerError as new (
      message: string,
      details: { status: number; statusText: string; body: unknown },
    ) => Error;

    const error = new RegistryBrokerErrorCtor("request failed", {
      status: 401,
      statusText: "Unauthorized",
      body: { message: "bad token" },
    });

    const result = toMcpToolError(error);

    expect(result.isError).toBe(true);
    expect(result.content[0]?.type).toBe("text");
    expect((result.content[0] as { text?: string }).text).toContain("status=401");
    expect(result.structuredContent).toMatchObject({
      ok: false,
      error: {
        code: "BROKER_HTTP_ERROR",
        category: "auth",
        retryable: false,
        statusCode: 401,
      },
    });
  });

  test("maps generic Error", () => {
    const result = toMcpToolError(new Error("boom"));
    expect(result.isError).toBe(true);
    expect((result.content[0] as { text?: string }).text).toContain("boom");
    expect(result.structuredContent).toMatchObject({
      ok: false,
      error: {
        code: "TOOL_EXECUTION_FAILED",
        category: "internal",
      },
    });
  });
});
