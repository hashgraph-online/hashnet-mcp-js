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

interface DelegationCandidate {
  summary: SelectedAgentSummary;
  target: {
    uaid?: string;
    agentUrl?: string;
  };
  rank: number;
}

const RANK_SCORE_AVAILABLE = 8;
const RANK_SCORE_COMMUNICATION_SUPPORTED = 4;
const RANK_SCORE_ROUTING_SUPPORTED = 2;
const RANK_TRUST_SCORE_DIVISOR = 100;

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function booleanValue(value: unknown): boolean {
  return value === true;
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

function rankCandidate(hit: JsonObject): number {
  return (
    (booleanValue(hit.available) ? RANK_SCORE_AVAILABLE : 0) +
    (booleanValue(hit.communicationSupported) ? RANK_SCORE_COMMUNICATION_SUPPORTED : 0) +
    (booleanValue(hit.routingSupported) ? RANK_SCORE_ROUTING_SUPPORTED : 0) +
    (numberValue(hit.trustScore) ?? 0) / RANK_TRUST_SCORE_DIVISOR
  );
}

function candidateTarget(hit: JsonObject): DelegationCandidate["target"] {
  return {
    uaid: stringValue(hit.uaid),
    agentUrl: stringValue(hit.agentUrl) ?? stringValue(hit.endpoint),
  };
}

function hasRoutableTarget(target: DelegationCandidate["target"]): boolean {
  return Boolean(target.uaid || target.agentUrl);
}

function candidateFromHit(hit: JsonObject): DelegationCandidate | null {
  const target = candidateTarget(hit);

  if (!hasRoutableTarget(target)) {
    return null;
  }

  return {
    summary: summarizeAgent(hit),
    target,
    rank: rankCandidate(hit),
  };
}

function notFoundError(message: string): Error & { status: number } {
  const error = new Error(message) as Error & { status: number };
  error.status = 404;
  return error;
}

function statusValue(error: unknown): number | undefined {
  if (!error || typeof error !== "object" || !("status" in error)) {
    return undefined;
  }

  const status = (error as { status?: unknown }).status;
  return typeof status === "number" ? status : undefined;
}

function shouldContinueAfterCreateSessionFailure(error: unknown): boolean {
  const status = statusValue(error);
  return status === 404;
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
          let candidates: DelegationCandidate[];

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
            candidates = [
              {
                summary: selectedAgent,
                target,
                rank: rankCandidate(resolved),
              },
            ];
          } else if (args.agentUrl) {
            selectedAgent = summarizeAgent({}, args.agentUrl);
            target = {
              agentUrl: args.agentUrl,
            };
            candidates = [
              {
                summary: selectedAgent,
                target,
                rank: 0,
              },
            ];
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

            const hits = Array.isArray(search.hits)
              ? search.hits.filter((hit): hit is JsonObject => !!hit && typeof hit === "object")
              : [];
            const orderedCandidates = hits
              .map((hit) => candidateFromHit(hit))
              .filter((candidate): candidate is DelegationCandidate => candidate !== null)
              .sort((left, right) => right.rank - left.rank);
            const selectedCandidate = orderedCandidates[0];

            if (!selectedCandidate) {
              throw notFoundError(`No registry agents matched "${query}".`);
            }

            candidateCount = orderedCandidates.length;
            selectedAgent = selectedCandidate.summary;
            target = selectedCandidate.target;
            candidates = orderedCandidates;
          }

          if (!target.uaid && !target.agentUrl) {
            throw notFoundError("Selected registry agent did not include a UAID or endpoint.");
          }

          let session: JsonObject | undefined;
          let response: JsonObject | undefined;
          let lastError: Error | undefined;

          for (const [candidateIndex, candidate] of candidates.entries()) {
            await ctx.server.sendLoggingMessage(
              {
                level: "info",
                data: `workflow.delegate: creating delegated chat session for candidate ${candidateIndex + 1}/${candidates.length}`,
              },
              extra.sessionId,
            );

            const createPayload: Record<string, unknown> = {
              auth: args.auth,
              senderUaid: args.senderUaid,
              historyTtlSeconds: args.historyTtlSeconds,
              encryptionRequested: args.encryptionRequested,
            };

            if (candidate.target.uaid) {
              createPayload.uaid = candidate.target.uaid;
            } else {
              createPayload.agentUrl = candidate.target.agentUrl;
            }

            try {
              session = (await ctx.withBrokerAuth(traceId, "createSession", (client) =>
                client.createSession(createPayload))) as JsonObject;
            } catch (error) {
              lastError = error instanceof Error ? error : new Error(String(error));
              await ctx.server.sendLoggingMessage(
                {
                  level: "warning",
                  data: `workflow.delegate: candidate ${candidate.summary.name ?? candidate.summary.uaid ?? candidate.summary.agentUrl ?? candidateIndex + 1} failed: ${lastError.message}`,
                },
                extra.sessionId,
              );
              session = undefined;
              if (shouldContinueAfterCreateSessionFailure(error)) {
                continue;
              }
              break;
            }

            const sessionId = stringValue(session.sessionId);
            if (!sessionId) {
              lastError = new Error("Broker createSession response did not include sessionId.");
              await ctx.server.sendLoggingMessage(
                {
                  level: "warning",
                  data: `workflow.delegate: candidate ${candidate.summary.name ?? candidate.summary.uaid ?? candidate.summary.agentUrl ?? candidateIndex + 1} failed: ${lastError.message}`,
                },
                extra.sessionId,
              );
              session = undefined;
              continue;
            }

            await ctx.server.sendLoggingMessage(
              {
                level: "info",
                data: `workflow.delegate: relaying task to delegated session ${sessionId}`,
              },
              extra.sessionId,
            );

            response = (await ctx.withBrokerAuth(traceId, "sendMessage", (client) =>
              client.sendMessage({
                sessionId,
                message: args.task,
                streaming: args.streaming,
                auth: args.auth,
              }))) as JsonObject;

            selectedAgent = candidate.summary;
            lastError = undefined;
            break;
          }

          if (!session || !response) {
            throw lastError ?? new Error("Unable to delegate task to any candidate.");
          }

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
