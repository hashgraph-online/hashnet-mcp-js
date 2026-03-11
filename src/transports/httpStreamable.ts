import { randomUUID } from "node:crypto";
import type { Server as HttpServer } from "node:http";

import express, { type Request, type Response } from "express";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";

import type { EnvConfig } from "../config/env.js";
import type { FeatureFlags } from "../config/featureFlags.js";
import type { AppLogger } from "../observability/logger.js";
import { registerLegacySseRoutes } from "./httpLegacySse.js";
import { enforceBearerAuth, enforceOrigin } from "./originValidation.js";
import {
  createRequestRateLimiter,
  enforceRequestRateLimit,
  type RequestRateLimiter,
} from "./requestRateLimit.js";
import type { SessionRegistryStats } from "./sessionRegistry.js";
import { createSessionRegistry, SessionCapacityError } from "./sessionRegistry.js";

interface RunStreamableHttpOptions {
  env: EnvConfig;
  flags: FeatureFlags;
  logger: AppLogger;
  createServer: () => McpServer;
  requestRateLimiter?: RequestRateLimiter;
}

export interface RunningHttpServer {
  host: string;
  port: number;
  close: () => Promise<void>;
}

function sendJsonRpcError(res: Response, status: number, message: string, code = -32000): void {
  res.status(status).json({
    jsonrpc: "2.0",
    error: {
      code,
      message,
    },
    id: null,
  });
}

function getClientInfo(body: unknown): { name?: string; version?: string } | undefined {
  if (!body || typeof body !== "object" || !("params" in body)) {
    return undefined;
  }

  const params = (body as { params?: unknown }).params;
  if (!params || typeof params !== "object" || !("clientInfo" in params)) {
    return undefined;
  }

  const clientInfo = (params as { clientInfo?: unknown }).clientInfo;
  if (!clientInfo || typeof clientInfo !== "object") {
    return undefined;
  }

  const name = "name" in clientInfo ? String((clientInfo as { name?: unknown }).name ?? "") : undefined;
  const version =
    "version" in clientInfo ? String((clientInfo as { version?: unknown }).version ?? "") : undefined;

  return {
    name: name || undefined,
    version: version || undefined,
  };
}

function renderMetrics(active: SessionRegistryStats): string {
  return [
    "# HELP mcp_active_sessions Number of currently active MCP HTTP sessions.",
    "# TYPE mcp_active_sessions gauge",
    `mcp_active_sessions ${active.activeSessions}`,
    "# HELP mcp_sessions_created_total Total number of MCP HTTP sessions created.",
    "# TYPE mcp_sessions_created_total counter",
    `mcp_sessions_created_total ${active.createdSessions}`,
    "# HELP mcp_sessions_expired_total Total number of MCP HTTP sessions expired due to idle timeout.",
    "# TYPE mcp_sessions_expired_total counter",
    `mcp_sessions_expired_total ${active.expiredSessions}`,
    "# HELP mcp_sessions_rejected_total Total number of MCP HTTP sessions rejected due to capacity limits.",
    "# TYPE mcp_sessions_rejected_total counter",
    `mcp_sessions_rejected_total ${active.rejectedSessions}`,
    "# HELP process_uptime_seconds Process uptime in seconds.",
    "# TYPE process_uptime_seconds gauge",
    `process_uptime_seconds ${Math.floor(process.uptime())}`,
  ].join("\n");
}

export async function runStreamableHttp(options: RunStreamableHttpOptions): Promise<RunningHttpServer> {
  const { env, flags, logger, createServer } = options;

  const app = express();
  app.use(express.json({ limit: "1mb" }));
  const sessions = createSessionRegistry({
    idleTtlMs: env.mcpSessionIdleTtlMs,
    maxSessions: env.mcpSessionMaxCount,
  });
  const requestRateLimiter = options.requestRateLimiter ?? createRequestRateLimiter();

  const validateRequest = (req: Request, res: Response): boolean => {
    if (!enforceRequestRateLimit(req, res, requestRateLimiter)) {
      return false;
    }

    if (!enforceOrigin(req, res, env.mcpAllowedOrigins, logger)) {
      return false;
    }

    if (!enforceBearerAuth(req, res, env.mcpServerBearerToken)) {
      return false;
    }

    return true;
  };

  app.get("/healthz", (_req: Request, res: Response) => {
    res.json({
      status: "ok",
      transport: "http",
      sessions: sessions.stats(),
    });
  });

  app.get("/readyz", (_req: Request, res: Response) => {
    res.json({
      status: "ready",
      brokerConfigured: Boolean(env.registryBrokerApiUrl),
      sessions: sessions.stats(),
    });
  });

  app.get("/metrics", (_req: Request, res: Response) => {
    res.type("text/plain").send(`${renderMetrics(sessions.stats())}\n`);
  });

  app.all(["/mcp", "/mcp/stream"], async (req: Request, res: Response) => {
    if (!validateRequest(req, res)) {
      return;
    }

    const isInitialize = req.method === "POST" && isInitializeRequest(req.body);
    const protocolVersion = req.header("mcp-protocol-version");

    if (!isInitialize && !protocolVersion) {
      sendJsonRpcError(
        res,
        400,
        "Bad Request: MCP-Protocol-Version header is required for non-initialize requests",
      );
      return;
    }

    const sessionId = req.header("mcp-session-id");
    let transport: StreamableHTTPServerTransport;

    try {
      if (sessionId) {
        const existing = sessions.get(sessionId);

        if (!existing) {
          sendJsonRpcError(res, 404, "Session not found");
          return;
        }

        if (!(existing.transport instanceof StreamableHTTPServerTransport)) {
          sendJsonRpcError(
            res,
            400,
            "Bad Request: session exists but belongs to a different transport protocol",
          );
          return;
        }

        transport = existing.transport;
      } else if (isInitialize) {
        let initializedTransport: StreamableHTTPServerTransport;
        initializedTransport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (newSessionId) => {
            sessions.register({
              sessionId: newSessionId,
              kind: "streamable-http",
              transport: initializedTransport,
              clientInfo: getClientInfo(req.body),
              protocolVersion,
            });
          },
        });

        initializedTransport.onclose = () => {
          if (initializedTransport.sessionId) {
            sessions.remove(initializedTransport.sessionId);
          }
        };

        const server = createServer();
        await server.connect(initializedTransport);
        transport = initializedTransport;
      } else {
        sendJsonRpcError(res, 400, "Bad Request: no valid session ID provided");
        return;
      }

      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      if (error instanceof SessionCapacityError) {
        if (!res.headersSent) {
          sendJsonRpcError(
            res,
            503,
            `Session capacity reached: maximum active sessions is ${error.maxSessions}`,
          );
        }
        return;
      }

      logger.error(
        {
          error,
          method: req.method,
          path: req.path,
          sessionId,
        },
        "streamable HTTP request failed",
      );

      if (!res.headersSent) {
        sendJsonRpcError(res, 500, "Internal server error", -32603);
      }
    }
  });

  if (flags.featureLegacySse) {
    registerLegacySseRoutes({
      app,
      logger,
      createServer,
      sessions,
      validateRequest,
    });
  }

  const reapTimer = setInterval(() => {
    void sessions.reapExpired(logger);
  }, env.mcpSessionReapIntervalMs);
  reapTimer.unref();

  const httpServer = await new Promise<HttpServer>((resolve, reject) => {
    const server = app.listen(env.mcpPort, env.mcpHost, () => resolve(server));
    server.on("error", (error: Error) => reject(error));
  });

  logger.info(
    {
      host: env.mcpHost,
      port: env.mcpPort,
      sessionIdleTtlMs: env.mcpSessionIdleTtlMs,
      sessionMaxCount: env.mcpSessionMaxCount,
      streamablePaths: ["/mcp", "/mcp/stream"],
      legacySseEnabled: flags.featureLegacySse,
    },
    "HTTP transport listening",
  );

  return {
    host: env.mcpHost,
    port: env.mcpPort,
    close: async () => {
      clearInterval(reapTimer);
      await sessions.closeAll(logger);

      await new Promise<void>((resolve, reject) => {
        httpServer.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    },
  };
}
