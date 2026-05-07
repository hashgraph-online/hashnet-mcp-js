import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import {
  holChatCreateSessionInputSchema,
  holChatCreateSessionOutputSchema,
  holChatEndInputSchema,
  holChatEndOutputSchema,
  holChatHistoryInputSchema,
  holChatHistoryOutputSchema,
  holChatReadinessInputSchema,
  holChatReadinessOutputSchema,
  holChatResumeInputSchema,
  holChatResumeOutputSchema,
  holChatRetryInputSchema,
  holChatRetryOutputSchema,
  holChatSendMessageInputSchema,
  holChatSendMessageOutputSchema,
} from "../schemas/common.js";
import { executeTool, traceIdFrom } from "./execute.js";
import { errorResult } from "./result.js";
import type { ToolRegisterContext } from "./types.js";

function readSessionState(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null || !("state" in value)) {
    return undefined;
  }
  const state = (value as { state?: unknown }).state;
  return typeof state === "string" ? state : undefined;
}

export function registerChatTools(server: McpServer, ctx: ToolRegisterContext): void {
  server.registerTool(
    "hol.chat.readiness",
    {
      title: "Check Chat Readiness",
      description: "Check Broker chat route readiness by UAID or agent URL before opening a session",
      inputSchema: holChatReadinessInputSchema,
      outputSchema: holChatReadinessOutputSchema,
    },
    async (args, extra) => {
      const authError = ctx.requirePaidToolAuth("hol.chat.readiness");
      if (authError) {
        return authError;
      }

      if (!args.uaid && !args.agentUrl) {
        return errorResult("hol.chat.readiness requires either 'uaid' or 'agentUrl'", undefined, {
          code: "VALIDATION_ERROR",
          category: "validation",
          traceId: traceIdFrom(extra),
        });
      }

      const payload: Record<string, unknown> = {};
      if (args.uaid) {
        payload.uaid = args.uaid;
      } else {
        payload.agentUrl = args.agentUrl;
      }
      if (args.forceRefresh === true) {
        payload.forceRefresh = true;
      }

      return executeTool(ctx, extra, {
        toolName: "hol.chat.readiness",
        run: async (traceId) => ({
          readiness: await ctx.withBrokerAuth(traceId, "checkChatReadiness", (client) =>
            client.checkChatReadiness(payload),
          ),
        }),
        summary: () => "Checked HOL chat readiness.",
      });
    },
  );

  server.registerTool(
    "hol.chat.createSession",
    {
      title: "Create Chat Session",
      description: "Create a Broker chat session by UAID or agent URL",
      inputSchema: holChatCreateSessionInputSchema,
      outputSchema: holChatCreateSessionOutputSchema,
    },
    async (args, extra) => {
      const authError = ctx.requirePaidToolAuth("hol.chat.createSession");
      if (authError) {
        return authError;
      }

      if (!args.uaid && !args.agentUrl) {
        return errorResult("hol.chat.createSession requires either 'uaid' or 'agentUrl'", undefined, {
          code: "VALIDATION_ERROR",
          category: "validation",
          traceId: traceIdFrom(extra),
        });
      }

      const payload: Record<string, unknown> = {
        auth: args.auth,
        senderUaid: args.senderUaid,
        historyTtlSeconds: args.historyTtlSeconds,
        encryptionRequested: args.encryptionRequested,
        visibility: args.visibility,
        idempotencyKey: args.idempotencyKey,
      };

      if (args.uaid) {
        payload.uaid = args.uaid;
      } else {
        payload.agentUrl = args.agentUrl;
      }

      return executeTool(ctx, extra, {
        toolName: "hol.chat.createSession",
        run: async (traceId) => ({
          session: await ctx.withBrokerAuth(traceId, "createSession", (client) => client.createSession(payload)),
        }),
        summary: () => "Created HOL chat session.",
      });
    },
  );

  server.registerTool(
    "hol.chat.sendMessage",
    {
      title: "Send Chat Message",
      description: "Send message to an existing session or auto-create one from UAID/URL",
      inputSchema: holChatSendMessageInputSchema,
      outputSchema: holChatSendMessageOutputSchema,
    },
    async (args, extra) => {
      const authError = ctx.requirePaidToolAuth("hol.chat.sendMessage");
      if (authError) {
        return authError;
      }

      if (!args.sessionId && !args.uaid && !args.agentUrl) {
        return errorResult(
          "hol.chat.sendMessage requires either 'sessionId' or ('uaid'/'agentUrl') for auto-session",
          undefined,
          {
            code: "VALIDATION_ERROR",
            category: "validation",
            traceId: traceIdFrom(extra),
          },
        );
      }

      return executeTool(ctx, extra, {
        toolName: "hol.chat.sendMessage",
        run: async (traceId) => {
          let sessionId = args.sessionId;

          if (!sessionId) {
            const createPayload: Record<string, unknown> = {
              auth: args.auth,
              senderUaid: args.senderUaid,
              historyTtlSeconds: args.historyTtlSeconds,
              encryptionRequested: args.encryptionRequested,
              visibility: args.visibility,
              idempotencyKey: args.idempotencyKey,
            };

            if (args.uaid) {
              createPayload.uaid = args.uaid;
            } else {
              createPayload.agentUrl = args.agentUrl;
            }

            const created = await ctx.withBrokerAuth(traceId, "createSession", (client) =>
              client.createSession(createPayload),
            );
            sessionId = created.sessionId;
          }

          return {
            sessionId,
            response: await ctx.withBrokerAuth(traceId, "sendMessage", (client) =>
              client.sendMessage({
                sessionId,
                message: args.message,
                streaming: args.streaming,
                auth: args.auth,
                senderUaid: args.senderUaid,
                idempotencyKey: args.idempotencyKey,
                transport: args.transport,
              }),
            ),
          };
        },
        summary: (data) => `Sent message to HOL chat session ${data.sessionId}.`,
      });
    },
  );

  server.registerTool(
    "hol.chat.retry",
    {
      title: "Retry Chat Message",
      description:
        "Replay a persisted chat message by message ID or idempotency key without duplicating history",
      inputSchema: holChatRetryInputSchema,
      outputSchema: holChatRetryOutputSchema,
    },
    async (args, extra) => {
      const authError = ctx.requirePaidToolAuth("hol.chat.retry");
      if (authError) {
        return authError;
      }

      return executeTool(ctx, extra, {
        toolName: "hol.chat.retry",
        run: async (traceId) => {
          const retryIdentifier = args.messageId ?? args.idempotencyKey;
          if (!retryIdentifier) {
            throw new Error("hol.chat.retry requires either 'messageId' or 'idempotencyKey'");
          }
          return {
            sessionId: args.sessionId,
            response: await ctx.withBrokerAuth(traceId, "retryMessage", (client) =>
              client.retryMessage(retryIdentifier, {
                sessionId: args.sessionId,
                uaid: args.uaid,
                agentUrl: args.agentUrl,
                auth: args.auth,
                senderUaid: args.senderUaid,
                message: args.message,
                idempotencyKey: args.idempotencyKey,
              }),
            ),
          };
        },
        summary: (data) => `Retried HOL chat message for session ${data.sessionId}.`,
      });
    },
  );

  server.registerTool(
    "hol.chat.history",
    {
      title: "Fetch Chat History",
      description: "Fetch chat history snapshot for a session",
      inputSchema: holChatHistoryInputSchema,
      outputSchema: holChatHistoryOutputSchema,
    },
    async (args, extra) => {
      const authError = ctx.requirePaidToolAuth("hol.chat.history");
      if (authError) {
        return authError;
      }

      return executeTool(ctx, extra, {
        toolName: "hol.chat.history",
        run: async (traceId) => ({
          sessionId: args.sessionId,
          history: await ctx.withBrokerAuth(traceId, "fetchHistorySnapshot", (client) =>
            client.fetchHistorySnapshot(args.sessionId, { decrypt: false }),
          ),
        }),
        summary: (data) => `Fetched chat history for session ${data.sessionId}.`,
      });
    },
  );

  server.registerTool(
    "hol.chat.resume",
    {
      title: "Resume Chat Session",
      description: "Resume a broker chat session and return its route plus history snapshot",
      inputSchema: holChatResumeInputSchema,
      outputSchema: holChatResumeOutputSchema,
    },
    async (args, extra) => {
      const authError = ctx.requirePaidToolAuth("hol.chat.resume");
      if (authError) {
        return authError;
      }

      return executeTool(ctx, extra, {
        toolName: "hol.chat.resume",
        run: async (traceId) => ({
          sessionId: args.sessionId,
          session: await ctx.withBrokerAuth(traceId, "resumeSession", (client) =>
            client.resumeSession(args.sessionId),
          ),
        }),
        summary: (data) => `Resumed chat session ${data.sessionId}.`,
      });
    },
  );

  server.registerTool(
    "hol.chat.cancel",
    {
      title: "Cancel Chat Session",
      description: "Cancel a chat session while returning a terminal session state",
      inputSchema: holChatEndInputSchema,
      outputSchema: holChatEndOutputSchema,
    },
    async (args, extra) => {
      const authError = ctx.requirePaidToolAuth("hol.chat.cancel");
      if (authError) {
        return authError;
      }

      return executeTool(ctx, extra, {
        toolName: "hol.chat.cancel",
        run: async (traceId) => {
          const cancelled = await ctx.withBrokerAuth(traceId, "cancelSession", (client) =>
            client.cancelSession(args.sessionId),
          );
          return {
            sessionId: args.sessionId,
            state: readSessionState(cancelled),
            ended: true,
          };
        },
        summary: (data) => `Cancelled chat session ${data.sessionId}.`,
      });
    },
  );

  server.registerTool(
    "hol.chat.end",
    {
      title: "End Chat Session",
      description: "Terminate a chat session",
      inputSchema: holChatEndInputSchema,
      outputSchema: holChatEndOutputSchema,
    },
    async (args, extra) => {
      const authError = ctx.requirePaidToolAuth("hol.chat.end");
      if (authError) {
        return authError;
      }

      return executeTool(ctx, extra, {
        toolName: "hol.chat.end",
        run: async (traceId) => {
          const ended = await ctx.withBrokerAuth(traceId, "endSession", (client) => client.endSession(args.sessionId));
          return {
            sessionId: args.sessionId,
            state: readSessionState(ended),
            ended: true,
          };
        },
        summary: (data) => `Ended chat session ${data.sessionId}.`,
      });
    },
  );
}
