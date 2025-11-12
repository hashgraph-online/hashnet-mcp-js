import { registerPipeline } from './registry';
import type { PipelineDefinition } from './types';
import { withBroker } from '../broker';

interface ChatInput {
  uaid: string;
  message?: string;
}

interface ChatContext {
  sessionId?: string;
  uaid: string;
  transcript: unknown;
}

const chatDefinition: PipelineDefinition<ChatInput, ChatContext> = {
  name: 'workflow.chatSmoke',
  description: 'Create a chat session, send a message, read history, compact, and close.',
  version: '1.0.0',
  requiredEnv: ['REGISTRY_BROKER_API_KEY'],
  createContext: ({ uaid }) => ({ uaid, transcript: undefined }),
  steps: [
    {
      name: 'rb.chat.createSession',
      run: async ({ context }) => {
        const response = await withBroker((client) => client.chat.createSession({ uaid: context.uaid, historyTtlSeconds: 60 }));
        if (response?.sessionId) {
          context.sessionId = response.sessionId;
        }
        return response;
      },
    },
    {
      name: 'rb.chat.sendMessage',
      run: async ({ input, context }) => {
        if (!context.sessionId) throw new Error('Missing chat session');
        return withBroker((client) => client.chat.sendMessage({
          sessionId: context.sessionId!,
          message: input.message ?? 'Hello from workflow.chatSmoke',
        }));
      },
    },
    {
      name: 'rb.chat.history',
      run: async ({ context }) => {
        if (!context.sessionId) throw new Error('Missing chat session');
        const history = await withBroker((client) => client.chat.getHistory(context.sessionId!));
        context.transcript = history;
        return history;
      },
    },
    {
      name: 'rb.chat.compact',
      allowDuringDryRun: true,
      run: async ({ context }) => {
        if (!context.sessionId) throw new Error('Missing chat session');
        return withBroker((client) => client.chat.compactHistory({ sessionId: context.sessionId!, preserveEntries: 2 }));
      },
    },
    {
      name: 'rb.chat.end',
      allowDuringDryRun: true,
      run: async ({ context }) => {
        if (!context.sessionId) throw new Error('Missing chat session');
        return withBroker((client) => client.chat.endSession(context.sessionId!));
      },
    },
  ],
};

export const chatPipeline = registerPipeline(chatDefinition);
