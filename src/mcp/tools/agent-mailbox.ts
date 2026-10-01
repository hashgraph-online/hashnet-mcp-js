import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import {
  holAgentConversationCancelInputSchema,
  holAgentConversationCancelOutputSchema,
  holAgentConversationGetInputSchema,
  holAgentConversationGetOutputSchema,
  holAgentInboxAckInputSchema,
  holAgentInboxAckOutputSchema,
  holAgentInboxClaimInputSchema,
  holAgentInboxClaimOutputSchema,
  holAgentInboxListInputSchema,
  holAgentInboxListOutputSchema,
  holAgentInboxRenewLeaseInputSchema,
  holAgentInboxRenewLeaseOutputSchema,
  holAgentMeInputSchema,
  holAgentMeOutputSchema,
  holAgentMessageGetInputSchema,
  holAgentMessageGetOutputSchema,
  holAgentPairingCompleteInputSchema,
  holAgentPairingCompleteOutputSchema,
  holAgentRejectInputSchema,
  holAgentRejectOutputSchema,
  holAgentReplyInputSchema,
  holAgentReplyOutputSchema,
  holAgentSendInputSchema,
  holAgentSendOutputSchema,
} from "../schemas/agent-mailbox.js";
import { executeTool } from "./execute.js";
import type { ToolRegisterContext } from "./types.js";

/**
 * Agent-mailbox tools call the broker's /agent-* routes with the bot's
 * own grant bearer token supplied per call. They never use
 * ctx.withBrokerAuth — a shared hosted server must not act with its
 * operator's env credentials on behalf of an arbitrary caller.
 */

function apiBaseUrl(registryBrokerApiUrl: string): string {
  const base = registryBrokerApiUrl.replace(/\/+$/, "");
  return /\/api\/v\d+$/i.test(base) ? base : `${base}/api/v1`;
}

class AgentMailboxError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "AgentMailboxError";
    this.status = status;
  }
}

async function callAgentMailbox(
  ctx: ToolRegisterContext,
  options: {
    method?: string;
    path: string;
    grantToken?: string;
    body?: Record<string, unknown>;
    traceId: string;
  },
): Promise<Record<string, unknown> | null> {
  const base = apiBaseUrl(ctx.env.registryBrokerApiUrl);
  const headers: Record<string, string> = {
    accept: "application/json",
    "x-app-id": "hashnet-mcp-js",
    "x-trace-id": options.traceId,
  };
  if (options.grantToken) {
    headers.authorization = `Bearer ${options.grantToken}`;
  }
  if (options.body !== undefined) {
    headers["content-type"] = "application/json";
  }

  const response = await fetch(`${base}${options.path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: AbortSignal.timeout(ctx.env.brokerRequestTimeoutMs),
  });

  if (response.status === 204) {
    return null;
  }

  const text = await response.text();
  let parsed: Record<string, unknown> | null;
  try {
    parsed = text ? (JSON.parse(text) as Record<string, unknown>) : null;
  } catch {
    parsed = null;
  }

  if (!response.ok) {
    const detail =
      parsed && typeof parsed.error === "object" && parsed.error !== null
        ? JSON.stringify(parsed.error)
        : text.slice(0, 300);
    throw new AgentMailboxError(
      `agent mailbox request failed (${response.status}): ${detail}`,
      response.status,
    );
  }

  return parsed;
}

export function registerAgentMailboxTools(server: McpServer, ctx: ToolRegisterContext): void {
  server.registerTool(
    "hol.agent.pairing.complete",
    {
      title: "Complete Agent Pairing",
      description:
        "Exchange a short-lived hol_pair_ pairing code for this bot's durable hol_agt_ grant token. Store the returned token; it is shown once.",
      inputSchema: holAgentPairingCompleteInputSchema,
      outputSchema: holAgentPairingCompleteOutputSchema,
    },
    async (args, extra) =>
      executeTool(ctx, extra, {
        toolName: "hol.agent.pairing.complete",
        run: async (traceId) => {
          const result = await callAgentMailbox(ctx, {
            method: "POST",
            path: "/agent-connections/pair",
            body: { pairingCode: args.pairingCode },
            traceId,
          });
          return {
            grantId: String(result?.grantId ?? ""),
            runtimeId: String(result?.runtimeId ?? ""),
            token: String(result?.token ?? ""),
            scopes: Array.isArray(result?.scopes) ? (result.scopes as string[]) : [],
          };
        },
        summary: () => "Pairing complete; grant token issued.",
      }),
  );

  server.registerTool(
    "hol.agent.me",
    {
      title: "Agent Runtime Identity",
      description: "Show this bot's runtime record, connection state, and registration state.",
      inputSchema: holAgentMeInputSchema,
      outputSchema: holAgentMeOutputSchema,
    },
    async (args, extra) =>
      executeTool(ctx, extra, {
        toolName: "hol.agent.me",
        run: async (traceId) => ({
          runtime: (await callAgentMailbox(ctx, {
            path: "/agent-runtimes/me",
            grantToken: args.grantToken,
            traceId,
          }))?.runtime as Record<string, unknown>,
        }),
        summary: () => "Resolved agent runtime identity.",
      }),
  );

  server.registerTool(
    "hol.agent.inbox.list",
    {
      title: "List Agent Inbox",
      description: "List this bot's durable inbox deliveries, newest first, with cursor pagination.",
      inputSchema: holAgentInboxListInputSchema,
      outputSchema: holAgentInboxListOutputSchema,
    },
    async (args, extra) =>
      executeTool(ctx, extra, {
        toolName: "hol.agent.inbox.list",
        run: async (traceId) => {
          const query = new URLSearchParams();
          if (args.cursor) query.set("cursor", args.cursor);
          if (args.limit !== undefined) query.set("limit", String(args.limit));
          if (args.includeAcknowledged !== undefined) {
            query.set("includeAcknowledged", String(args.includeAcknowledged));
          }
          const suffix = query.size > 0 ? `?${query.toString()}` : "";
          const result = await callAgentMailbox(ctx, {
            path: `/agent-inbox${suffix}`,
            grantToken: args.grantToken,
            traceId,
          });
          return {
            items: Array.isArray(result?.items) ? (result.items as Record<string, unknown>[]) : [],
            nextCursor: (result?.nextCursor as string | null) ?? null,
          };
        },
        summary: (data) => `Inbox listed ${data.items.length} item(s).`,
        count: (data) => data.items.length,
      }),
  );

  server.registerTool(
    "hol.agent.inbox.claim",
    {
      title: "Claim Next Inbox Message",
      description:
        "Claim the oldest unclaimed inbox message under a processing lease. Returns null when empty. The lease's fencingToken must be echoed on ack/reply/reject.",
      inputSchema: holAgentInboxClaimInputSchema,
      outputSchema: holAgentInboxClaimOutputSchema,
    },
    async (args, extra) =>
      executeTool(ctx, extra, {
        toolName: "hol.agent.inbox.claim",
        run: async (traceId) => ({
          claim: (await callAgentMailbox(ctx, {
            method: "POST",
            path: "/agent-inbox/leases",
            grantToken: args.grantToken,
            body: {},
            traceId,
          })) as Record<string, unknown> | null,
        }),
        summary: (data) => (data.claim ? "Claimed an inbox message." : "Inbox empty."),
      }),
  );

  server.registerTool(
    "hol.agent.inbox.ack",
    {
      title: "Acknowledge Claimed Message",
      description:
        "Acknowledge a claimed message so it stays in processing until replied or the lease expires.",
      inputSchema: holAgentInboxAckInputSchema,
      outputSchema: holAgentInboxAckOutputSchema,
    },
    async (args, extra) =>
      executeTool(ctx, extra, {
        toolName: "hol.agent.inbox.ack",
        run: async (traceId) => ({
          message: (await callAgentMailbox(ctx, {
            method: "POST",
            path: `/agent-inbox/${encodeURIComponent(args.messageId)}/ack`,
            grantToken: args.grantToken,
            body: { leaseId: args.leaseId, fencingToken: args.fencingToken },
            traceId,
          })) as Record<string, unknown>,
        }),
        summary: () => "Message acknowledged.",
      }),
  );

  server.registerTool(
    "hol.agent.inbox.renewLease",
    {
      title: "Renew Processing Lease",
      description: "Extend a claimed message's lease; rejected if another holder fenced it.",
      inputSchema: holAgentInboxRenewLeaseInputSchema,
      outputSchema: holAgentInboxRenewLeaseOutputSchema,
    },
    async (args, extra) =>
      executeTool(ctx, extra, {
        toolName: "hol.agent.inbox.renewLease",
        run: async (traceId) => ({
          lease: (await callAgentMailbox(ctx, {
            method: "POST",
            path: `/agent-inbox/${encodeURIComponent(args.messageId)}/lease/renew`,
            grantToken: args.grantToken,
            body: {
              leaseId: args.leaseId,
              fencingToken: args.fencingToken,
              ...(args.extendSeconds === undefined ? {} : { extendSeconds: args.extendSeconds }),
            },
            traceId,
          })) as Record<string, unknown>,
        }),
        summary: () => "Lease renewed.",
      }),
  );

  server.registerTool(
    "hol.agent.send",
    {
      title: "Send Agent Message",
      description:
        "Send a durable request or event to an allowed peer UAID. idempotencyKey is required and deduplicates retries.",
      inputSchema: holAgentSendInputSchema,
      outputSchema: holAgentSendOutputSchema,
    },
    async (args, extra) =>
      executeTool(ctx, extra, {
        toolName: "hol.agent.send",
        run: async (traceId) => ({
          accepted: (await callAgentMailbox(ctx, {
            method: "POST",
            path: "/agent-messages",
            grantToken: args.grantToken,
            body: {
              recipientUaid: args.recipientUaid,
              ...(args.conversationId === undefined ? {} : { conversationId: args.conversationId }),
              kind: args.kind,
              content: { type: "text", text: args.text },
              ...(args.expiresInSeconds === undefined
                ? {}
                : { expiresInSeconds: args.expiresInSeconds }),
              idempotencyKey: args.idempotencyKey,
            },
            traceId,
          })) as Record<string, unknown>,
        }),
        summary: () => "Message accepted.",
      }),
  );

  server.registerTool(
    "hol.agent.reply",
    {
      title: "Reply To Agent Message",
      description:
        "Atomically complete a claimed request with a response. Requires the claim's leaseId and fencingToken.",
      inputSchema: holAgentReplyInputSchema,
      outputSchema: holAgentReplyOutputSchema,
    },
    async (args, extra) =>
      executeTool(ctx, extra, {
        toolName: "hol.agent.reply",
        run: async (traceId) => {
          const result = await callAgentMailbox(ctx, {
            method: "POST",
            path: `/agent-messages/${encodeURIComponent(args.messageId)}/reply`,
            grantToken: args.grantToken,
            body: {
              leaseId: args.leaseId,
              fencingToken: args.fencingToken,
              content: { type: "text", text: args.text },
              outcome: args.outcome,
              idempotencyKey: args.idempotencyKey,
            },
            traceId,
          });
          return {
            request: (result?.request ?? {}) as Record<string, unknown>,
            response: (result?.response ?? {}) as Record<string, unknown>,
          };
        },
        summary: () => "Reply sent and request completed.",
      }),
  );

  server.registerTool(
    "hol.agent.reject",
    {
      title: "Reject Agent Message",
      description: "Reject a claimed request with an optional reason.",
      inputSchema: holAgentRejectInputSchema,
      outputSchema: holAgentRejectOutputSchema,
    },
    async (args, extra) =>
      executeTool(ctx, extra, {
        toolName: "hol.agent.reject",
        run: async (traceId) => ({
          message: (await callAgentMailbox(ctx, {
            method: "POST",
            path: `/agent-messages/${encodeURIComponent(args.messageId)}/reject`,
            grantToken: args.grantToken,
            body: {
              leaseId: args.leaseId,
              fencingToken: args.fencingToken,
              ...(args.reason === undefined ? {} : { reason: args.reason }),
            },
            traceId,
          })) as Record<string, unknown>,
        }),
        summary: () => "Message rejected.",
      }),
  );

  server.registerTool(
    "hol.agent.message.get",
    {
      title: "Get Agent Message",
      description: "Fetch a single message's state — including whether a sent request was answered.",
      inputSchema: holAgentMessageGetInputSchema,
      outputSchema: holAgentMessageGetOutputSchema,
    },
    async (args, extra) =>
      executeTool(ctx, extra, {
        toolName: "hol.agent.message.get",
        run: async (traceId) => ({
          message: (await callAgentMailbox(ctx, {
            path: `/agent-messages/${encodeURIComponent(args.messageId)}`,
            grantToken: args.grantToken,
            traceId,
          })) as Record<string, unknown>,
        }),
        summary: () => "Message fetched.",
      }),
  );

  server.registerTool(
    "hol.agent.conversation.get",
    {
      title: "Get Agent Conversation",
      description: "Fetch a conversation's messages and participants with cursor pagination.",
      inputSchema: holAgentConversationGetInputSchema,
      outputSchema: holAgentConversationGetOutputSchema,
    },
    async (args, extra) =>
      executeTool(ctx, extra, {
        toolName: "hol.agent.conversation.get",
        run: async (traceId) => {
          const query = new URLSearchParams();
          if (args.cursor) query.set("cursor", args.cursor);
          if (args.limit !== undefined) query.set("limit", String(args.limit));
          const suffix = query.size > 0 ? `?${query.toString()}` : "";
          return {
            conversation: (await callAgentMailbox(ctx, {
              path: `/agent-conversations/${encodeURIComponent(args.conversationId)}${suffix}`,
              grantToken: args.grantToken,
              traceId,
            })) as Record<string, unknown>,
          };
        },
        summary: () => "Conversation fetched.",
      }),
  );

  server.registerTool(
    "hol.agent.conversation.cancel",
    {
      title: "Cancel Agent Conversation",
      description: "Cancel a conversation and its pending requests. Terminal — cannot be undone.",
      inputSchema: holAgentConversationCancelInputSchema,
      outputSchema: holAgentConversationCancelOutputSchema,
    },
    async (args, extra) =>
      executeTool(ctx, extra, {
        toolName: "hol.agent.conversation.cancel",
        run: async (traceId) => {
          const result = await callAgentMailbox(ctx, {
            method: "POST",
            path: `/agent-conversations/${encodeURIComponent(args.conversationId)}/cancel`,
            grantToken: args.grantToken,
            body: {},
            traceId,
          });
          return {
            conversationId: String(result?.conversationId ?? ""),
            canceledMessages: Number(result?.canceledMessages ?? 0),
          };
        },
        summary: (data) => `Conversation canceled; ${data.canceledMessages} message(s) closed.`,
      }),
  );
}
