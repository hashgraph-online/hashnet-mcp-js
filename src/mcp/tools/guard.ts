import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import {
  emptyInputSchema,
  holGuardBillingBalanceOutputSchema,
  holGuardEntitlementsOutputSchema,
  holGuardResolveTrustInputSchema,
  holGuardResolveTrustOutputSchema,
  holGuardRevocationsOutputSchema,
  holGuardSessionOutputSchema,
  holGuardSyncReceiptsInputSchema,
  holGuardSyncReceiptsOutputSchema,
  holGuardTrustByHashInputSchema,
  holGuardTrustByHashOutputSchema,
} from "../schemas/common.js";
import { executeTool, traceIdFrom } from "./execute.js";
import { errorResult } from "./result.js";
import type { ToolRegisterContext } from "./types.js";

function normalizeGuardTrustQuery(args: {
  ecosystem?: string;
  name?: string;
  version?: string;
}): {
  ecosystem?: string;
  name?: string;
  version?: string;
} {
  const ecosystem = args.ecosystem?.trim();
  const name = args.name?.trim();
  const version = args.version?.trim();

  return {
    ...(ecosystem ? { ecosystem } : {}),
    ...(name ? { name } : {}),
    ...(version ? { version } : {}),
  };
}

export function registerGuardTools(server: McpServer, ctx: ToolRegisterContext): void {
  server.registerTool(
    "hol.guard.session",
    {
      title: "Guard Session",
      description: "Fetch the current Guard session and product bucket state",
      inputSchema: emptyInputSchema,
      outputSchema: holGuardSessionOutputSchema,
    },
    async (_args, extra) => {
      const authError = ctx.requirePaidToolAuth("hol.guard.session");
      if (authError) {
        return authError;
      }

      return executeTool(ctx, extra, {
        toolName: "hol.guard.session",
        run: async (traceId) => ({
          session: await ctx.withBrokerAuth(traceId, "getGuardSession", (client) => client.getGuardSession()),
        }),
        summary: () => "Fetched Guard session state.",
      });
    },
  );

  server.registerTool(
    "hol.guard.entitlements",
    {
      title: "Guard Entitlements",
      description: "Fetch the current Guard plan entitlements",
      inputSchema: emptyInputSchema,
      outputSchema: holGuardEntitlementsOutputSchema,
    },
    async (_args, extra) => {
      const authError = ctx.requirePaidToolAuth("hol.guard.entitlements");
      if (authError) {
        return authError;
      }

      return executeTool(ctx, extra, {
        toolName: "hol.guard.entitlements",
        run: async (traceId) => ({
          entitlements: await ctx.withBrokerAuth(traceId, "getGuardEntitlements", (client) =>
            client.getGuardEntitlements(),
          ),
        }),
        summary: () => "Fetched Guard entitlements.",
      });
    },
  );

  server.registerTool(
    "hol.guard.billingBalance",
    {
      title: "Guard Billing Balance",
      description: "Fetch the Guard billing balance and product credit buckets",
      inputSchema: emptyInputSchema,
      outputSchema: holGuardBillingBalanceOutputSchema,
    },
    async (_args, extra) => {
      const authError = ctx.requirePaidToolAuth("hol.guard.billingBalance");
      if (authError) {
        return authError;
      }

      return executeTool(ctx, extra, {
        toolName: "hol.guard.billingBalance",
        run: async (traceId) => ({
          balance: await ctx.withBrokerAuth(traceId, "getGuardBillingBalance", (client) =>
            client.getGuardBillingBalance(),
          ),
        }),
        summary: () => "Fetched Guard billing balance.",
      });
    },
  );

  server.registerTool(
    "hol.guard.trustByHash",
    {
      title: "Guard Trust By Hash",
      description: "Resolve Guard trust evidence by artifact sha256 hash",
      inputSchema: holGuardTrustByHashInputSchema,
      outputSchema: holGuardTrustByHashOutputSchema,
    },
    async (args, extra) =>
      executeTool(ctx, extra, {
        toolName: "hol.guard.trustByHash",
        run: async (traceId) => ({
          trust: await ctx.withBroker(traceId, "getGuardTrustByHash", (client) =>
            client.getGuardTrustByHash(args.sha256),
          ),
        }),
        summary: () => "Fetched Guard trust by artifact hash.",
      }),
  );

  server.registerTool(
    "hol.guard.resolveTrust",
    {
      title: "Guard Resolve Trust",
      description: "Resolve Guard trust recommendations by ecosystem, name, and version",
      inputSchema: holGuardResolveTrustInputSchema,
      outputSchema: holGuardResolveTrustOutputSchema,
    },
    async (args, extra) => {
      const query = normalizeGuardTrustQuery(args);
      const hasQuery = Object.keys(query).length > 0;
      if (!hasQuery) {
        return errorResult(
          "hol.guard.resolveTrust requires at least one of 'ecosystem', 'name', or 'version'",
          undefined,
          {
            code: "VALIDATION_ERROR",
            category: "validation",
            traceId: traceIdFrom(extra),
          },
        );
      }

      return executeTool(ctx, extra, {
        toolName: "hol.guard.resolveTrust",
        run: async (traceId) => ({
          query,
          trust: await ctx.withBroker(traceId, "resolveGuardTrust", (client) =>
            client.resolveGuardTrust(query),
          ),
        }),
        summary: () => "Resolved Guard trust recommendations.",
      });
    },
  );

  server.registerTool(
    "hol.guard.revocations",
    {
      title: "Guard Revocations",
      description: "Fetch Guard revocations and recent security advisories",
      inputSchema: emptyInputSchema,
      outputSchema: holGuardRevocationsOutputSchema,
    },
    async (_args, extra) =>
      executeTool(ctx, extra, {
        toolName: "hol.guard.revocations",
        run: async (traceId) => ({
          revocations: await ctx.withBroker(traceId, "getGuardRevocations", (client) =>
            client.getGuardRevocations(),
          ),
        }),
        summary: () => "Fetched Guard revocations.",
      }),
  );

  server.registerTool(
    "hol.guard.syncReceipts",
    {
      title: "Guard Sync Receipts",
      description: "Sync Guard receipts to the configured broker account",
      inputSchema: holGuardSyncReceiptsInputSchema,
      outputSchema: holGuardSyncReceiptsOutputSchema,
    },
    async (args, extra) => {
      const authError = ctx.requirePaidToolAuth("hol.guard.syncReceipts");
      if (authError) {
        return authError;
      }

      return executeTool(ctx, extra, {
        toolName: "hol.guard.syncReceipts",
        run: async (traceId) => ({
          sync: await ctx.withBrokerAuth(traceId, "syncGuardReceipts", (client) =>
            client.syncGuardReceipts(args),
          ),
        }),
        summary: (data) => `Synced ${String((data.sync as { receiptsStored?: number }).receiptsStored ?? "unknown")} Guard receipts.`,
      });
    },
  );
}
