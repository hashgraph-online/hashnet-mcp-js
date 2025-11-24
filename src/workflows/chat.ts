import type { AgentAuthConfig } from '@hashgraphonline/standards-sdk';
import { registerPipeline } from './registry';
import type { PipelineDefinition } from './types';
import { withBroker } from '../broker';
import { loadMemoryContext, recordMemory } from './utils/memory';

interface ChatInput {
  uaid: string;
  message?: string;
  auth?: AgentAuthConfig;
  disableMemory?: boolean;
}

interface ChatContext {
  sessionId?: string;
  uaid: string;
  transcript: unknown;
  auth?: AgentAuthConfig;
  memoryContext?: unknown;
  memoryOptOut?: boolean;
}

const chatDefinition: PipelineDefinition<ChatInput, ChatContext> = {
  name: 'workflow.chatSmoke',
  description: 'Create a chat session, send a message, read history, compact, and close.',
  version: '1.0.0',
  requiredEnv: ['REGISTRY_BROKER_API_KEY'],
  createContext: ({ uaid, auth, disableMemory }) => ({ uaid, auth, transcript: undefined, memoryOptOut: disableMemory }),
  steps: [
    {
      name: 'workflow.chatSmoke.memory.load',
      skip: ({ input }) => Boolean(input.disableMemory),
      run: async ({ context }) => {
        const scope = { uaid: context.uaid };
        const loaded = await loadMemoryContext({ scope, optOut: context.memoryOptOut });
        context.memoryContext = loaded ?? undefined;
        return loaded ?? { skipped: true };
      },
    },
    {
      name: 'hol.chat.createSession',
      run: async ({ context }) => {
        const response = await withBroker((client) =>
          client.chat.createSession({ uaid: context.uaid, historyTtlSeconds: 60, auth: context.auth }),
        );
        if (response?.sessionId) {
          context.sessionId = response.sessionId;
        }
        return response;
      },
    },
    {
      name: 'hol.chat.sendMessage',
      run: async ({ input, context }) => {
        if (!context.sessionId) throw new Error('Missing chat session');
        const message = input.message ?? 'Hello from workflow.chatSmoke';
        await recordMemory({
          scope: { uaid: context.uaid, sessionId: context.sessionId },
          role: 'user',
          content: message,
          toolName: 'workflow.chatSmoke',
          optOut: context.memoryOptOut,
        });
        const response = await withBroker((client) =>
          client.chat.sendMessage({
            sessionId: context.sessionId!,
            message,
            uaid: context.uaid,
            auth: input.auth ?? context.auth,
          }),
        );
        await recordMemory({
          scope: { uaid: context.uaid, sessionId: context.sessionId },
          role: 'assistant',
          content: JSON.stringify(response),
          toolName: 'workflow.chatSmoke',
          optOut: context.memoryOptOut,
        });
        return response;
      },
    },
    {
      name: 'hol.chat.history',
      run: async ({ context }) => {
        if (!context.sessionId) throw new Error('Missing chat session');
        const history = await withBroker((client) => client.chat.getHistory(context.sessionId!));
        context.transcript = history;
        await recordMemory({
          scope: { uaid: context.uaid, sessionId: context.sessionId },
          role: 'event',
          content: JSON.stringify({ history }),
          toolName: 'workflow.chatSmoke',
          optOut: context.memoryOptOut,
        });
        return history;
      },
    },
    {
      name: 'hol.chat.compact',
      allowDuringDryRun: true,
      run: async ({ context }) => {
        if (!context.sessionId) throw new Error('Missing chat session');
        try {
          return await withBroker((client) => client.chat.compactHistory({ sessionId: context.sessionId!, preserveEntries: 2 }));
        } catch (error) {
          const message = error instanceof Error ? error.message.toLowerCase() : '';
          if (message.includes('authenticated account required') || message.includes('insufficient credits')) {
            return { skipped: true, reason: 'history compaction requires authenticated account' };
          }
          throw error;
        }
      },
    },
    {
      name: 'hol.chat.end',
      allowDuringDryRun: true,
      run: async ({ context }) => {
        if (!context.sessionId) throw new Error('Missing chat session');
        return withBroker((client) => client.chat.endSession(context.sessionId!));
      },
    },
  ],
};

export const chatPipeline = registerPipeline(chatDefinition);
