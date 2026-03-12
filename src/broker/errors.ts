import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as standardsSdk from "@hashgraphonline/standards-sdk";

import { errorResult } from "../mcp/tools/result.js";

type BrokerErrorLike = Error & {
  status: number;
  statusText: string;
  body: unknown;
};

type BrokerParseErrorLike = Error & {
  cause: unknown;
};

const RegistryBrokerErrorCtor = (standardsSdk as Record<string, unknown>).RegistryBrokerError as
  | (new (...args: never[]) => BrokerErrorLike)
  | undefined;
const RegistryBrokerParseErrorCtor = (
  standardsSdk as Record<string, unknown>
).RegistryBrokerParseError as (new (...args: never[]) => BrokerParseErrorLike) | undefined;

function stringify(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function categoryFromStatus(status: number):
  | "auth"
  | "validation"
  | "not_found"
  | "rate_limit"
  | "timeout"
  | "upstream" {
  if (status === 401 || status === 403) {
    return "auth";
  }
  if (status === 404) {
    return "not_found";
  }
  if (status === 408) {
    return "timeout";
  }
  if (status === 429) {
    return "rate_limit";
  }
  if (status >= 400 && status < 500) {
    return "validation";
  }
  return "upstream";
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

function normalizeMessage(value: unknown, fallbackMessage: string): string {
  if (value instanceof Error && value.message) {
    return `${fallbackMessage}: ${value.message}`;
  }
  return `${fallbackMessage}: ${stringify(value)}`;
}

export function toMcpToolError(
  error: unknown,
  fallbackMessage = "Tool execution failed",
  meta: { traceId?: string; durationMs?: number } = {},
): CallToolResult {
  if (RegistryBrokerErrorCtor && error instanceof RegistryBrokerErrorCtor) {
    return errorResult(
      `Broker request failed: status=${error.status} statusText=${error.statusText}`,
      error.body,
      {
        code: "BROKER_HTTP_ERROR",
        category: categoryFromStatus(error.status),
        retryable: isRetryableStatus(error.status),
        statusCode: error.status,
        traceId: meta.traceId,
        durationMs: meta.durationMs,
      },
    );
  }

  if (RegistryBrokerParseErrorCtor && error instanceof RegistryBrokerParseErrorCtor) {
    return errorResult("Broker response schema mismatch", error.cause, {
      code: "BROKER_PARSE_ERROR",
      category: "upstream",
      retryable: false,
      traceId: meta.traceId,
      durationMs: meta.durationMs,
    });
  }

  if (error instanceof Error && error.name === "AbortError") {
    return errorResult(normalizeMessage(error, fallbackMessage), undefined, {
      code: "BROKER_TIMEOUT",
      category: "timeout",
      retryable: true,
      traceId: meta.traceId,
      durationMs: meta.durationMs,
    });
  }

  if (error instanceof Error && error.name === "SessionCapacityError") {
    return errorResult(error.message, undefined, {
      code: "SESSION_CAPACITY",
      category: "capacity",
      retryable: true,
      traceId: meta.traceId,
      durationMs: meta.durationMs,
    });
  }

  if (error instanceof Error) {
    return errorResult(`${fallbackMessage}: ${error.message}`, undefined, {
      code: "TOOL_EXECUTION_FAILED",
      category: "internal",
      retryable: false,
      traceId: meta.traceId,
      durationMs: meta.durationMs,
    });
  }

  return errorResult(normalizeMessage(error, fallbackMessage), undefined, {
    code: "TOOL_EXECUTION_FAILED",
    category: "internal",
    retryable: false,
    traceId: meta.traceId,
    durationMs: meta.durationMs,
  });
}
