import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import { createRegistryBrokerClient, type RegistryBrokerClientLike } from "../broker/client.js";
import type { EnvConfig } from "../config/env.js";
import type { FeatureFlags } from "../config/featureFlags.js";
import type { BrokerRateLimiter } from "../broker/rateLimit.js";
import type { AppLogger } from "../observability/logger.js";
import { SERVER_NAME, SERVER_VERSION } from "../constants.js";
import { registerChatTools } from "./tools/chat.js";
import { errorResult } from "./tools/result.js";
import { registerDiscoveryTools } from "./tools/discovery.js";
import { registerRegistrationTools } from "./tools/registration.js";
import { registerDiscoveryWorkflow } from "./workflows/discoveryWorkflow.js";
import { registerRegistrationWorkflow } from "./workflows/registrationWorkflow.js";

export interface CreateMcpServerOptions {
  env: EnvConfig;
  flags: FeatureFlags;
  logger: AppLogger;
  rateLimiter: BrokerRateLimiter;
}

async function withBrokerCall<T>(
  env: EnvConfig,
  logger: AppLogger,
  rateLimiter: BrokerRateLimiter,
  traceId: string,
  operation: string,
  fn: (client: RegistryBrokerClientLike) => Promise<T>,
): Promise<T> {
  const startedAt = Date.now();
  return rateLimiter.schedule(async () => {
    const client = createRegistryBrokerClient(env, traceId);
    logger.debug({ traceId, operation }, "broker request start");

    try {
      const result = await fn(client);
      logger.debug(
        {
          traceId,
          operation,
          durationMs: Date.now() - startedAt,
        },
        "broker request complete",
      );
      return result;
    } catch (error) {
      logger.error(
        {
          traceId,
          operation,
          durationMs: Date.now() - startedAt,
          error,
        },
        "broker request failed",
      );
      throw error;
    }
  });
}

function requirePaidToolAuth(env: EnvConfig, toolName: string): CallToolResult | null {
  if (env.registryBrokerApiKey) {
    return null;
  }

  return errorResult(
    `${toolName} requires REGISTRY_BROKER_API_KEY (or equivalent authenticated broker credentials)`,
    undefined,
    {
      code: "AUTH_REQUIRED",
      category: "auth",
    },
  );
}

export function createMcpServer(opts: CreateMcpServerOptions): McpServer {
  const server = new McpServer(
    {
      name: SERVER_NAME,
      version: SERVER_VERSION,
    },
    {
      capabilities: {
        tools: {
          listChanged: false,
        },
        logging: {},
      },
    },
  );

  const registerContext = {
    env: opts.env,
    flags: opts.flags,
    logger: opts.logger,
    rateLimiter: opts.rateLimiter,
    server,
    withBroker<T>(traceId: string, operation: string, fn: (client: RegistryBrokerClientLike) => Promise<T>) {
      return withBrokerCall(opts.env, opts.logger, opts.rateLimiter, traceId, operation, fn);
    },
    requirePaidToolAuth(toolName: string) {
      return requirePaidToolAuth(opts.env, toolName);
    },
  };

  registerDiscoveryTools(server, registerContext);
  registerChatTools(server, registerContext);
  registerRegistrationTools(server, registerContext);
  registerDiscoveryWorkflow(server, registerContext);
  registerRegistrationWorkflow(server, registerContext);

  return server;
}
