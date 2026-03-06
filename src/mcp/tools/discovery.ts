import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { SERVER_NAME, SERVER_VERSION } from "../../constants.js";
import {
  emptyInputSchema,
  holCapabilitiesOutputSchema,
  holResolveUaidInputSchema,
  holResolveUaidOutputSchema,
  holSearchInputSchema,
  holSearchOutputSchema,
  holStatsOutputSchema,
  holVectorSearchInputSchema,
  holVectorSearchOutputSchema,
} from "../schemas/common.js";
import { executeTool, traceIdFrom } from "./execute.js";
import { errorResult } from "./result.js";
import type { ToolRegisterContext } from "./types.js";

export function registerDiscoveryTools(server: McpServer, ctx: ToolRegisterContext): void {
  server.registerTool(
    "hol.stats",
    {
      title: "HOL Stats",
      description: "Fetch Registry Broker stats and service health metadata",
      inputSchema: emptyInputSchema,
      outputSchema: holStatsOutputSchema,
    },
    async (_args, extra) =>
      executeTool(ctx, extra, {
        toolName: "hol.stats",
        run: async (traceId) => ({
          stats: await ctx.withBroker(traceId, "stats", (client) => client.stats()),
        }),
        summary: () => "Fetched HOL registry stats.",
      }),
  );

  server.registerTool(
    "hol.search",
    {
      title: "HOL Search",
      description: "Keyword search for agents and MCP servers",
      inputSchema: holSearchInputSchema,
      outputSchema: holSearchOutputSchema,
    },
    async (args, extra) => {
      const query = (args.q ?? args.query ?? "").trim();

      if (!query) {
        return errorResult("hol.search requires either 'q' or 'query'", undefined, {
          code: "VALIDATION_ERROR",
          category: "validation",
          traceId: traceIdFrom(extra),
        });
      }

      const { q: _q, query: _query, ...rest } = args;

      return executeTool(ctx, extra, {
        toolName: "hol.search",
        run: async (traceId) => {
          const results = await ctx.withBroker(traceId, "search", (client) =>
            client.search({
              ...rest,
              q: query,
            }),
          );

          return {
            query,
            count: Array.isArray(results.hits) ? results.hits.length : 0,
            results,
          };
        },
        summary: (data) => `Found ${data.count} search results for "${data.query}".`,
        count: (data) => data.count,
      });
    },
  );

  server.registerTool(
    "hol.vectorSearch",
    {
      title: "HOL Vector Search",
      description: "Semantic vector search for agents and MCP servers",
      inputSchema: holVectorSearchInputSchema,
      outputSchema: holVectorSearchOutputSchema,
    },
    async (args, extra) =>
      executeTool(ctx, extra, {
        toolName: "hol.vectorSearch",
        run: async (traceId) => {
          const results = await ctx.withBroker(traceId, "vectorSearch", (client) =>
            client.vectorSearch({
              query: args.query,
              limit: args.limit,
              filter: args.filter,
            }),
          );

          return {
            query: args.query,
            count: Array.isArray(results.results) ? results.results.length : 0,
            results,
          };
        },
        summary: (data) => `Found ${data.count} vector search results for "${data.query}".`,
        count: (data) => data.count,
      }),
  );

  server.registerTool(
    "hol.resolveUaid",
    {
      title: "Resolve UAID",
      description: "Resolve a UAID into registry metadata",
      inputSchema: holResolveUaidInputSchema,
      outputSchema: holResolveUaidOutputSchema,
    },
    async (args, extra) =>
      executeTool(ctx, extra, {
        toolName: "hol.resolveUaid",
        run: async (traceId) => ({
          uaid: args.uaid,
          resolved: await ctx.withBroker(traceId, "resolveUaid", (client) => client.resolveUaid(args.uaid)),
        }),
        summary: (data) => `Resolved UAID ${data.uaid}.`,
      }),
  );

  server.registerTool(
    "hol.capabilities",
    {
      title: "HOL Capabilities",
      description: "Describe server capabilities, auth requirements, and runtime limits",
      inputSchema: emptyInputSchema,
      outputSchema: holCapabilitiesOutputSchema,
    },
    async (_args, extra) =>
      executeTool(ctx, extra, {
        toolName: "hol.capabilities",
        run: async () => ({
          server: {
            name: SERVER_NAME,
            version: SERVER_VERSION,
          },
          transports: {
            stdio: true,
            http: true,
            legacySse: ctx.flags.featureLegacySse,
          },
          auth: {
            brokerApiKeyConfigured: Boolean(ctx.env.registryBrokerApiKey),
            httpBearerRequired: Boolean(ctx.env.mcpServerBearerToken),
          },
          limits: {
            brokerRateLimitConcurrency: ctx.env.brokerRateLimitConcurrency,
            brokerRateLimitMinTimeMs: ctx.env.brokerRateLimitMinTimeMs,
            brokerRequestTimeoutMs: ctx.env.brokerRequestTimeoutMs,
            sessionIdleTtlMs: ctx.env.mcpSessionIdleTtlMs,
            sessionMaxCount: ctx.env.mcpSessionMaxCount,
          },
          features: {
            legacySse: ctx.flags.featureLegacySse,
            memorySqlite: ctx.flags.featureMemorySqlite,
            memoryRedis: ctx.flags.featureMemoryRedis,
            ledgerAuth: ctx.flags.featureLedgerAuth,
            encryptedChat: ctx.flags.featureEncryptedChat,
          },
        }),
        summary: () => "Returned HOL MCP server capabilities and runtime limits.",
      }),
  );
}
