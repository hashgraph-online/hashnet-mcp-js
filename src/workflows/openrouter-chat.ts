import { scaffoldWorkflow } from './scaffold';
import type { PipelineDefinition } from './types';
import { withBroker } from '../broker';

interface OpenRouterChatInput {
  modelId: string;
  registry?: string;
  message: string;
  authToken?: string;
  historyTtlSeconds?: number;
}

interface OpenRouterChatContext {
  uaid?: string;
  sessionId?: string;
  transcript?: unknown;
}

const openRouterChatDefinition: PipelineDefinition<OpenRouterChatInput, OpenRouterChatContext> = {
  name: 'workflow.openrouterChat',
  description: 'Discover an OpenRouter model and run a chat message against it.',
  version: '1.0.0',
  requiredEnv: ['REGISTRY_BROKER_API_KEY'],
  createContext: () => ({}),
  steps: [
    {
      name: 'hol.search',
      run: async ({ input, context }) => {
        const result = await withBroker((client) =>
          client.search({ q: input.modelId, registries: input.registry ? [input.registry] : ['openrouter'], limit: 1 }),
        );
        if (!result.hits?.length) {
          throw new Error(`Model ${input.modelId} not found in registry ${input.registry ?? 'openrouter'}`);
        }
        context.uaid = result.hits[0].uaid;
        return result.hits[0];
      },
    },
    {
      name: 'hol.chat.createSession',
      run: async ({ input, context }) => {
        if (!context.uaid) throw new Error('UAID missing from discovery step');
        const auth = input.authToken ? { type: 'bearer' as const, token: input.authToken } : undefined;
        const response = await withBroker((client) =>
          client.chat.createSession({
            uaid: context.uaid!,
            historyTtlSeconds: input.historyTtlSeconds ?? 900,
            auth,
          }),
        );
        context.sessionId = response.sessionId;
        return response;
      },
    },
    {
      name: 'hol.chat.sendMessage',
      run: async ({ input, context }) => {
        if (!context.sessionId) throw new Error('Missing chat session');
        const auth = input.authToken ? { type: 'bearer' as const, token: input.authToken } : undefined;
        return withBroker((client) =>
          client.chat.sendMessage({ sessionId: context.sessionId!, auth, message: input.message, uaid: context.uaid }),
        );
      },
    },
    {
      name: 'hol.chat.history',
      allowDuringDryRun: true,
      run: async ({ context }) => {
        if (!context.sessionId) throw new Error('Missing chat session');
        const history = await withBroker((client) => client.chat.getHistory(context.sessionId!));
        context.transcript = history;
        return history;
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

export const openRouterChatWorkflow = scaffoldWorkflow(openRouterChatDefinition);
