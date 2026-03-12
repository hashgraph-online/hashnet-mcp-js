import type { Express, Request, RequestHandler, Response } from "express";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { AppLogger } from "../observability/logger.js";
import type { SessionRegistry } from "./sessionRegistry.js";
import { SessionCapacityError } from "./sessionRegistry.js";

interface LegacySseRouteOptions {
  app: Express;
  logger: AppLogger;
  createServer: () => McpServer;
  sessions: SessionRegistry;
  requestGuards: RequestHandler[];
}

function sendJsonRpcError(res: Response, status: number, message: string): void {
  res.status(status).json({
    jsonrpc: "2.0",
    error: {
      code: -32000,
      message,
    },
    id: null,
  });
}

export function registerLegacySseRoutes(options: LegacySseRouteOptions): void {
  const { app, logger, createServer, sessions, requestGuards } = options;

  app.get(
    ["/mcp/sse", "/sse"],
    ...requestGuards,
    async (req: Request, res: Response) => {
      try {
        const transport = new SSEServerTransport("/mcp/messages", res);
        sessions.register({
          sessionId: transport.sessionId,
          kind: "legacy-sse",
          transport,
        });

        res.on("close", () => {
          sessions.remove(transport.sessionId);
        });

        const server = createServer();
        await server.connect(transport);

        logger.debug({ sessionId: transport.sessionId }, "legacy SSE session established");
      } catch (error) {
        if (error instanceof SessionCapacityError) {
          sendJsonRpcError(
            res,
            503,
            `Session capacity reached: maximum active sessions is ${error.maxSessions}`,
          );
          return;
        }

        logger.error({ error }, "legacy SSE initialization failed");
        if (!res.headersSent) {
          sendJsonRpcError(res, 500, "Internal server error");
        }
      }
    },
  );

  app.post(
    ["/mcp/messages", "/messages"],
    ...requestGuards,
    async (req: Request, res: Response) => {
      const sessionId = typeof req.query.sessionId === "string" ? req.query.sessionId : "";
      if (!sessionId) {
        sendJsonRpcError(res, 400, "Bad Request: missing sessionId query parameter");
        return;
      }

      const existing = sessions.get(sessionId);
      if (!(existing?.transport instanceof SSEServerTransport)) {
        sendJsonRpcError(res, 400, "Bad Request: invalid sessionId for SSE transport");
        return;
      }

      try {
        await existing.transport.handlePostMessage(req, res, req.body);
      } catch (error) {
        logger.error({ error, sessionId }, "legacy SSE message handling failed");
        if (!res.headersSent) {
          sendJsonRpcError(res, 500, "Internal server error");
        }
      }
    },
  );
}
