import type { AppLogger } from "./logger.js";

export interface ToolTelemetry {
  toolName: string;
  requestId: string;
  durationMs: number;
  success: boolean;
  upstreamOperation?: string;
  statusCode?: number;
}

export function recordToolTelemetry(logger: AppLogger, payload: ToolTelemetry): void {
  logger.info(
    {
      event: "tool_execution",
      ...payload,
    },
    `tool=${payload.toolName} success=${payload.success} durationMs=${payload.durationMs}`,
  );
}
