import type { CallToolResult, ContentBlock } from "@modelcontextprotocol/sdk/types.js";

import { TOOL_SCHEMA_VERSION } from "../../constants.js";

export type ToolErrorCategory =
  | "auth"
  | "validation"
  | "not_found"
  | "rate_limit"
  | "timeout"
  | "cancelled"
  | "upstream"
  | "internal"
  | "capacity";

export interface ToolMetaOptions {
  summary: string;
  traceId: string;
  durationMs: number;
  count?: number;
  warnings?: string[];
}

export interface ToolErrorOptions {
  code?: string;
  category?: ToolErrorCategory;
  retryable?: boolean;
  statusCode?: number;
  traceId?: string;
  durationMs?: number;
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function textBlock(text: string): ContentBlock {
  return { type: "text", text };
}

export function successResult(data: Record<string, unknown>, options: ToolMetaOptions): CallToolResult {
  const structuredContent = {
    ok: true as const,
    data,
    meta: {
      schemaVersion: TOOL_SCHEMA_VERSION,
      summary: options.summary,
      traceId: options.traceId,
      durationMs: options.durationMs,
      ...(options.count === undefined ? {} : { count: options.count }),
      ...(options.warnings && options.warnings.length > 0 ? { warnings: options.warnings } : {}),
    },
  };

  return {
    structuredContent,
    content: [textBlock(options.summary)],
  };
}

export function textResult(text: string): CallToolResult {
  return {
    content: [textBlock(text)],
  };
}

export function errorResult(message: string, details?: unknown, options: ToolErrorOptions = {}): CallToolResult {
  const error = {
    code: options.code ?? "TOOL_ERROR",
    category: options.category ?? "internal",
    message,
    retryable: options.retryable ?? false,
    ...(options.statusCode === undefined ? {} : { statusCode: options.statusCode }),
    ...(details === undefined ? {} : { details }),
  };
  const suffix = details === undefined ? "" : `\n${safeStringify(details)}`;

  return {
    isError: true,
    structuredContent: {
      ok: false,
      error,
      meta: {
        schemaVersion: TOOL_SCHEMA_VERSION,
        ...(options.traceId === undefined ? {} : { traceId: options.traceId }),
        ...(options.durationMs === undefined ? {} : { durationMs: options.durationMs }),
        summary: message,
      },
    },
    content: [textBlock(`${message}${suffix}`)],
  };
}
