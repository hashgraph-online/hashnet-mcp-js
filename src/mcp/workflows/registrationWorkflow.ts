import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import {
  workflowRegistrationInputSchema,
  workflowRegistrationOutputSchema,
} from "../schemas/common.js";
import { executeTool } from "../tools/execute.js";
import type { ToolRegisterContext } from "../tools/types.js";

export function registerRegistrationWorkflow(server: McpServer, ctx: ToolRegisterContext): void {
  server.registerTool(
    "workflow.registration",
    {
      title: "Registration Workflow",
      description: "Quote -> register -> optional wait for completion",
      inputSchema: workflowRegistrationInputSchema,
      outputSchema: workflowRegistrationOutputSchema,
    },
    async (args, extra) => {
      const authError = ctx.requirePaidToolAuth("workflow.registration");
      if (authError) {
        return authError;
      }

      return executeTool(ctx, extra, {
        toolName: "workflow.registration",
        run: async (traceId) => {
          await ctx.server.sendLoggingMessage(
            {
              level: "info",
              data: "workflow.registration: requesting registration quote",
            },
            extra.sessionId,
          );

          const quote = await ctx.withBrokerAuth(traceId, "getRegistrationQuote", (client) =>
            client.getRegistrationQuote(args.payload as Record<string, unknown>),
          );

          await ctx.server.sendLoggingMessage(
            {
              level: "info",
              data: "workflow.registration: submitting registration",
            },
            extra.sessionId,
          );

          const registration = await ctx.withBrokerAuth(traceId, "registerAgent", (client) =>
            client.registerAgent(args.payload as Record<string, unknown>),
          );

          let progress: unknown;
          const attemptId =
            typeof registration === "object" && registration !== null && "attemptId" in registration
              ? String((registration as { attemptId?: string }).attemptId ?? "")
              : "";

          if (args.wait && attemptId.length > 0) {
            await ctx.server.sendLoggingMessage(
              {
                level: "info",
                data: `workflow.registration: waiting for attemptId ${attemptId}`,
              },
              extra.sessionId,
            );

            progress = await ctx.withBrokerAuth(traceId, "waitForRegistrationCompletion", (client) =>
              client.waitForRegistrationCompletion(attemptId, {
                intervalMs: args.pollIntervalMs,
                timeoutMs: args.timeoutMs,
                throwOnFailure: false,
                signal: extra.signal,
              }),
            );
          }

          return {
            quote,
            registration,
            progress,
            waited: Boolean(args.wait && attemptId.length > 0),
          };
        },
        summary: (data) =>
          data.waited
            ? "Completed registration workflow with wait-for-completion."
            : "Completed registration workflow without waiting for completion.",
      });
    },
  );
}
