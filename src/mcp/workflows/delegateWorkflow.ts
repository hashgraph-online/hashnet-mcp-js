import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { workflowDelegateInputSchema, workflowDelegateOutputSchema } from "../schemas/common.js";
import { executeTool, traceIdFrom } from "../tools/execute.js";
import { errorResult } from "../tools/result.js";
import type { ToolRegisterContext } from "../tools/types.js";

type JsonObject = Record<string, unknown>;

interface SelectedAgentSummary {
  uaid?: string;
  name?: string;
  description?: string;
  registry?: string;
  agentUrl?: string;
  score?: number;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function summarizeAgent(hit: JsonObject, fallbackAgentUrl?: string): SelectedAgentSummary {
  return {
    uaid: stringValue(hit.uaid),
    name: stringValue(hit.name) ?? stringValue(hit.display_name),
    description: stringValue(hit.description) ?? stringValue(hit.bio),
    registry: stringValue(hit.registry),
    agentUrl: stringValue(hit.agentUrl) ?? stringValue(hit.endpoint) ?? fallbackAgentUrl,
    score: numberValue(hit.score) ?? numberValue(hit._score),
  };
}

function notFoundError(message: string): Error & { status: number } {
  const error = new Error(message) as Error & { status: number };
  error.status = 404;
  return error;
}

export function registerDelegateWorkflow(server: McpServer, ctx: ToolRegisterContext): void {
  server.registerTool(
    "workflow.delegate",
    {
      title: "Delegate Workflow",
      description: "Discover a registry subagent, open a session, and relay a task in one call",
      inputSchema: workflowDelegateInputSchema,
      outputSchema: workflowDelegateOutputSchema,
    },
    async (args, extra) => {
      const authError = ctx.requirePaidToolAuth("workflow.delegate");
      if (authError) {
        return authError;
      }

      if (args.uaid && args.agentUrl) {
        return errorResult("workflow.delegate accepts only one of 'uaid' or 'agentUrl'", undefined, {
          code: "VALIDATION_ERROR",
          category: "validation",
          traceId: traceIdFrom(extra),
        });
      }

      return executeTool(ctx, extra, {
        toolName: "workflow.delegate",
        run: async (traceId) => {
          const query = (args.query ?? args.task).trim();
          let candidateCount = 1;
          let search: JsonObject | undefined;
          let selectedAgent: SelectedAgentSummary;
          let target: { uaid?: string; agentUrl?: string };

          if (args.uaid) {
            const uaid = args.uaid;
            await ctx.server.sendLoggingMessage(
              {
                level: "info",
                data: `workflow.delegate: resolving explicit UAID ${uaid}`,
              },
              extra.sessionId,
            );

            const resolved = (await ctx.withBroker(traceId, "resolveUaid", (client) =>
              client.resolveUaid(uaid))) as JsonObject;
            selectedAgent = summarizeAgent(resolved);
            target = {
              uaid,
              agentUrl: selectedAgent.agentUrl,
            };
          } else if (args.agentUrl) {
            selectedAgent = summarizeAgent({}, args.agentUrl);
            target = {
              agentUrl: args.agentUrl,
            };
          } else {
            await ctx.server.sendLoggingMessage(
              {
                level: "info",
                data: `workflow.delegate: searching registry for "${query}"`,
              },
              extra.sessionId,
            );

            search = (await ctx.withBroker(traceId, "search", (client) =>
              client.search({
                ...(args.filters ?? {}),
                q: query,
                limit: args.limit ?? 5,
              }))) as JsonObject;

            const hits = Array.isArray(search.hits) ? (search.hits.filter((hit): hit is JsonObject => !!hit && typeof hit === "object")) : [];
            const selectedHit = hits[0];

            if (!selectedHit) {
              throw notFoundError(`No registry agents matched "${query}".`);
            }

            candidateCount = hits.length;
            selectedAgent = summarizeAgent(selectedHit);
            target = {
              uaid: stringValue(selectedHit.uaid),
              agentUrl: stringValue(selectedHit.agentUrl) ?? stringValue(selectedHit.endpoint),
            };
          }

          if (!target.uaid && !target.agentUrl) {
            throw notFoundError("Selected registry agent did not include a UAID or endpoint.");
          }

          await ctx.server.sendLoggingMessage(
            {
              level: "info",
              data: "workflow.delegate: creating delegated chat session",
            },
            extra.sessionId,
          );

          const createPayload: Record<string, unknown> = {
            auth: args.auth,
            senderUaid: args.senderUaid,
            historyTtlSeconds: args.historyTtlSeconds,
            encryptionRequested: args.encryptionRequested,
          };

          if (target.uaid) {
            createPayload.uaid = target.uaid;
          } else {
            createPayload.agentUrl = target.agentUrl;
          }

          const session = (await ctx.withBrokerAuth(traceId, "createSession", (client) =>
            client.createSession(createPayload))) as JsonObject;

          const sessionId = stringValue(session.sessionId);
          if (!sessionId) {
            throw new Error("Broker createSession response did not include sessionId.");
          }

          await ctx.server.sendLoggingMessage(
            {
              level: "info",
              data: `workflow.delegate: relaying task to delegated session ${sessionId}`,
            },
            extra.sessionId,
          );

          const response = (await ctx.withBrokerAuth(traceId, "sendMessage", (client) =>
            client.sendMessage({
              sessionId,
              message: args.task,
              streaming: args.streaming,
              auth: args.auth,
            }))) as JsonObject;

          return {
            task: args.task,
            query,
            candidateCount,
            selectedAgent,
            session,
            response,
            search,
          };
        },
        summary: (data) =>
          `Delegated task to ${data.selectedAgent.name ?? data.selectedAgent.uaid ?? data.selectedAgent.agentUrl ?? "registry subagent"}.`,
        count: (data) => data.candidateCount,
      });
    },
  );
}
