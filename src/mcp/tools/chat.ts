import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import {
  holChatCreateSessionInputSchema,
  holChatCreateSessionOutputSchema,
  holChatEndInputSchema,
  holChatEndOutputSchema,
  holChatHistoryInputSchema,
  holChatHistoryOutputSchema,
  holChatSendMessageInputSchema,
  holChatSendMessageOutputSchema,
} from "../schemas/common.js";
import { executeTool, traceIdFrom } from "./execute.js";
import { errorResult } from "./result.js";
import type { ToolRegisterContext } from "./types.js";

export function registerChatTools(server: McpServer, ctx: ToolRegisterContext): void {
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
        senderUaid: args.senderUaid,
        historyTtlSeconds: args.historyTtlSeconds,
        encryptionRequested: args.encryptionRequested,
      };

      if (args.uaid) {
        payload.uaid = args.uaid;
      } else {
        payload.agentUrl = args.agentUrl;
      }

      return executeTool(ctx, extra, {
        toolName: "hol.chat.createSession",
        run: async (traceId) => ({
          session: await ctx.withBroker(traceId, "createSession", (client) => client.createSession(payload)),
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
              senderUaid: args.senderUaid,
              historyTtlSeconds: args.historyTtlSeconds,
              encryptionRequested: args.encryptionRequested,
            };

            if (args.uaid) {
              createPayload.uaid = args.uaid;
            } else {
              createPayload.agentUrl = args.agentUrl;
            }

            const created = await ctx.withBroker(traceId, "createSession", (client) =>
              client.createSession(createPayload),
            );
            sessionId = created.sessionId;
          }

          return {
            sessionId,
            response: await ctx.withBroker(traceId, "sendMessage", (client) =>
              client.sendMessage({
                sessionId,
                message: args.message,
                streaming: args.streaming,
              }),
            ),
          };
        },
        summary: (data) => `Sent message to HOL chat session ${data.sessionId}.`,
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
          history: await ctx.withBroker(traceId, "fetchHistorySnapshot", (client) =>
            client.fetchHistorySnapshot(args.sessionId, { decrypt: false }),
          ),
        }),
        summary: (data) => `Fetched chat history for session ${data.sessionId}.`,
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
          await ctx.withBroker(traceId, "endSession", (client) => client.endSession(args.sessionId));
          return {
            sessionId: args.sessionId,
            ended: true,
          };
        },
        summary: (data) => `Ended chat session ${data.sessionId}.`,
      });
    },
  );
}
