import type { AgentAuthConfig } from '@hashgraphonline/standards-sdk';
import { registerPipeline } from './registry';
import type { PipelineDefinition } from './types';
import { withBroker } from '../broker';

interface ChatInput {
  uaid: string;
  message?: string;
  auth?: AgentAuthConfig;
}

interface ChatContext {
  sessionId?: string;
  uaid: string;
  transcript: unknown;
  auth?: AgentAuthConfig;
}

const chatDefinition: PipelineDefinition<ChatInput, ChatContext> = {
  name: 'workflow.chatSmoke',
  description: 'Create a chat session, send a message, read history, compact, and close.',
  version: '1.0.0',
  requiredEnv: ['REGISTRY_BROKER_API_KEY'],
  createContext: ({ uaid, auth }) => ({ uaid, auth, transcript: undefined }),
  steps: [
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
        return withBroker((client) =>
          client.chat.sendMessage({
            sessionId: context.sessionId!,
            message: input.message ?? 'Hello from workflow.chatSmoke',
            auth: input.auth ?? context.auth,
          }),
        );
      },
    },
    {
      name: 'hol.chat.history',
      run: async ({ context }) => {
        if (!context.sessionId) throw new Error('Missing chat session');
        const history = await withBroker((client) => client.chat.getHistory(context.sessionId!));
        context.transcript = history;
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
