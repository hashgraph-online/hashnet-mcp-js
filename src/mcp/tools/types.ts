import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import type { BrokerAuthAvailability } from "../../broker/auth.js";
import type { RegistryBrokerClientLike } from "../../broker/client.js";
import type { BrokerRateLimiter } from "../../broker/rateLimit.js";
import type { EnvConfig } from "../../config/env.js";
import type { FeatureFlags } from "../../config/featureFlags.js";
import type { AppLogger } from "../../observability/logger.js";

export interface ToolRegisterContext {
  authAvailability: BrokerAuthAvailability;
  env: EnvConfig;
  flags: FeatureFlags;
  logger: AppLogger;
  rateLimiter: BrokerRateLimiter;
  server: McpServer;
  withBroker<T>(
    traceId: string,
    operation: string,
    fn: (client: RegistryBrokerClientLike) => Promise<T>,
  ): Promise<T>;
  withBrokerAuth<T>(
    traceId: string,
    operation: string,
    fn: (client: RegistryBrokerClientLike) => Promise<T>,
  ): Promise<T>;
  requirePaidToolAuth(toolName: string): CallToolResult | null;
}
