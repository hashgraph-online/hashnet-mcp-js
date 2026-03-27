import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import { toMcpToolError } from "../../broker/errors.js";
import { recordToolTelemetry } from "../../observability/telemetry.js";
import { successResult } from "./result.js";
import type { ToolRegisterContext } from "./types.js";

export interface ToolHandlerExtra {
  requestId?: string | number;
  sessionId?: string;
  signal?: AbortSignal;
}

export interface ExecuteToolOptions<TData extends Record<string, unknown>> {
  toolName: string;
  run: (traceId: string) => Promise<TData>;
  summary: (data: TData) => string;
  count?: (data: TData) => number | undefined;
  warnings?: (data: TData) => string[] | undefined;
}

function statusCodeFrom(error: unknown): number | undefined {
  if (!error || typeof error !== "object" || !("status" in error)) {
    return undefined;
  }

  const status = (error as { status?: unknown }).status;
  return typeof status === "number" ? status : undefined;
}

export function traceIdFrom(extra: ToolHandlerExtra): string {
  return String(extra.requestId ?? "unknown");
}

export async function executeTool<TData extends Record<string, unknown>>(
  ctx: ToolRegisterContext,
  extra: ToolHandlerExtra,
  options: ExecuteToolOptions<TData>,
): Promise<CallToolResult> {
  const traceId = traceIdFrom(extra);
  const startedAt = Date.now();

  try {
    const data = await options.run(traceId);
    const durationMs = Date.now() - startedAt;

    recordToolTelemetry(ctx.logger, {
      toolName: options.toolName,
      requestId: traceId,
      durationMs,
      success: true,
    });

    return successResult(data, {
      summary: options.summary(data),
      traceId,
      durationMs,
      ...(options.count ? { count: options.count(data) } : {}),
      ...(options.warnings ? { warnings: options.warnings(data) } : {}),
    });
  } catch (error) {
    const durationMs = Date.now() - startedAt;

    recordToolTelemetry(ctx.logger, {
      toolName: options.toolName,
      requestId: traceId,
      durationMs,
      success: false,
      statusCode: statusCodeFrom(error),
    });

    return toMcpToolError(error, `${options.toolName} failed`, {
      traceId,
      durationMs,
    });
  }
}
