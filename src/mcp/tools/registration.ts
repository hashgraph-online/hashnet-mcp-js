import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import {
  holRegisterAgentOutputSchema,
  holRegistrationQuoteOutputSchema,
  holWaitRegistrationOutputSchema,
  registrationPayloadSchema,
  waitRegistrationInputSchema,
} from "../schemas/common.js";
import { executeTool } from "./execute.js";
import type { ToolRegisterContext } from "./types.js";

export function registerRegistrationTools(server: McpServer, ctx: ToolRegisterContext): void {
  server.registerTool(
    "hol.getRegistrationQuote",
    {
      title: "Get Registration Quote",
      description: "Get the credit quote required to register an agent",
      inputSchema: registrationPayloadSchema,
      outputSchema: holRegistrationQuoteOutputSchema,
    },
    async (args, extra) => {
      const authError = ctx.requirePaidToolAuth("hol.getRegistrationQuote");
      if (authError) {
        return authError;
      }

      return executeTool(ctx, extra, {
        toolName: "hol.getRegistrationQuote",
        run: async (traceId) => ({
          quote: await ctx.withBrokerAuth(traceId, "getRegistrationQuote", (client) =>
            client.getRegistrationQuote(args as Record<string, unknown>),
          ),
        }),
        summary: () => "Fetched registration quote.",
      });
    },
  );

  server.registerTool(
    "hol.registerAgent",
    {
      title: "Register Agent",
      description: "Register an HCS-11 agent profile with the Registry Broker",
      inputSchema: registrationPayloadSchema,
      outputSchema: holRegisterAgentOutputSchema,
    },
    async (args, extra) => {
      const authError = ctx.requirePaidToolAuth("hol.registerAgent");
      if (authError) {
        return authError;
      }

      return executeTool(ctx, extra, {
        toolName: "hol.registerAgent",
        run: async (traceId) => ({
          registration: await ctx.withBrokerAuth(traceId, "registerAgent", (client) =>
            client.registerAgent(args as Record<string, unknown>),
          ),
        }),
        summary: () => "Submitted agent registration.",
      });
    },
  );

  server.registerTool(
    "hol.waitForRegistrationCompletion",
    {
      title: "Wait For Registration Completion",
      description: "Poll registration progress by attemptId until completion or timeout",
      inputSchema: waitRegistrationInputSchema,
      outputSchema: holWaitRegistrationOutputSchema,
    },
    async (args, extra) => {
      const authError = ctx.requirePaidToolAuth("hol.waitForRegistrationCompletion");
      if (authError) {
        return authError;
      }

      return executeTool(ctx, extra, {
        toolName: "hol.waitForRegistrationCompletion",
        run: async (traceId) => ({
          attemptId: args.attemptId,
          progress: await ctx.withBrokerAuth(traceId, "waitForRegistrationCompletion", (client) =>
            client.waitForRegistrationCompletion(args.attemptId, {
              intervalMs: args.pollIntervalMs,
              timeoutMs: args.timeoutMs,
              throwOnFailure: false,
              signal: extra.signal,
            }),
          ),
        }),
        summary: (data) => `Fetched registration progress for attempt ${data.attemptId}.`,
      });
    },
  );
}
