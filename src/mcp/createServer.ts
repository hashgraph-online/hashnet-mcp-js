import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import {
  createBrokerAuthState,
  ensureBrokerClientAuth,
  getBrokerAuthAvailability,
  type BrokerAuthState,
} from "../broker/auth.js";
import { createRegistryBrokerClient, type RegistryBrokerClientLike } from "../broker/client.js";
import type { BrokerRateLimiter } from "../broker/rateLimit.js";
import type { EnvConfig } from "../config/env.js";
import type { FeatureFlags } from "../config/featureFlags.js";
import type { AppLogger } from "../observability/logger.js";
import { SERVER_NAME, SERVER_VERSION } from "../constants.js";
import { registerChatTools } from "./tools/chat.js";
import { registerGuardTools } from "./tools/guard.js";
import { errorResult } from "./tools/result.js";
import { registerDiscoveryTools } from "./tools/discovery.js";
import { registerRegistrationTools } from "./tools/registration.js";
import { registerDelegateWorkflow } from "./workflows/delegateWorkflow.js";
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
  requireAuth: boolean,
  authState: BrokerAuthState,
  fn: (client: RegistryBrokerClientLike) => Promise<T>,
): Promise<T> {
  const startedAt = Date.now();
  return rateLimiter.schedule(async () => {
    const client = createRegistryBrokerClient(env, traceId);
    logger.debug({ traceId, operation }, "broker request start");

    try {
      if (requireAuth) {
        await ensureBrokerClientAuth(client, env, logger, authState);
      }

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

function requirePaidToolAuth(
  authAvailability: ReturnType<typeof getBrokerAuthAvailability>,
  toolName: string,
): CallToolResult | null {
  if (authAvailability.paidToolAuthAvailable) {
    return null;
  }

  return errorResult(
    `${toolName} requires REGISTRY_BROKER_API_KEY or ledger credentials (LEDGER_ACCOUNT_ID/HEDERA_ACCOUNT_ID plus matching network and private key).`,
    undefined,
    {
      code: "AUTH_REQUIRED",
      category: "auth",
    },
  );
}

export function createMcpServer(opts: CreateMcpServerOptions): McpServer {
  const authAvailability = getBrokerAuthAvailability(opts.env);
  const authState = createBrokerAuthState();
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
    authAvailability,
    server,
    withBroker<T>(traceId: string, operation: string, fn: (client: RegistryBrokerClientLike) => Promise<T>) {
      return withBrokerCall(opts.env, opts.logger, opts.rateLimiter, traceId, operation, false, authState, fn);
    },
    withBrokerAuth<T>(traceId: string, operation: string, fn: (client: RegistryBrokerClientLike) => Promise<T>) {
      return withBrokerCall(opts.env, opts.logger, opts.rateLimiter, traceId, operation, true, authState, fn);
    },
    requirePaidToolAuth(toolName: string) {
      return requirePaidToolAuth(authAvailability, toolName);
    },
  };

  registerDiscoveryTools(server, registerContext);
  registerGuardTools(server, registerContext);
  registerChatTools(server, registerContext);
  registerRegistrationTools(server, registerContext);
  registerDelegateWorkflow(server, registerContext);
  registerDiscoveryWorkflow(server, registerContext);
  registerRegistrationWorkflow(server, registerContext);

  return server;
}
