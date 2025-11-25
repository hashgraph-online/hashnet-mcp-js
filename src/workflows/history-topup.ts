import type { AgentAuthConfig } from '@hashgraphonline/standards-sdk';
import { RegistryBrokerError } from '@hashgraphonline/standards-sdk';
import { scaffoldWorkflow } from './scaffold';
import type { PipelineDefinition } from './types';
import { withBroker } from '../broker';
import { loadMemoryContext, recordMemory } from './utils/memory';

interface CreditTopUpConfig {
  accountId: string;
  privateKey: string;
  hbarAmount?: number;
  memo?: string;
}

export interface HistoryTopUpInput {
  uaid: string;
  auth?: AgentAuthConfig;
  messages?: string[];
  historyTtlSeconds?: number;
  preserveEntries?: number;
  creditTopUp: CreditTopUpConfig;
  disableMemory?: boolean;
}

interface HistoryTopUpContext {
  sessionId?: string;
  transcripts: unknown[];
  compactions: unknown[];
  purchases: unknown[];
  memoryOptOut?: boolean;
  uaid: string;
}

const historyTopUpDefinition: PipelineDefinition<HistoryTopUpInput, HistoryTopUpContext> = {
  name: 'workflow.historyTopUp',
  description: 'Run a chat session, trigger credit purchases on history errors, and confirm recovery.',
  version: '1.0.0',
  requiredEnv: ['REGISTRY_BROKER_API_KEY'],
  createContext: (input) => ({ transcripts: [], compactions: [], purchases: [], memoryOptOut: input.disableMemory, uaid: input.uaid }),
  steps: [
    {
      name: 'workflow.historyTopUp.memory.load',
      skip: ({ input }) => Boolean(input.disableMemory),
      run: async ({ input, context }) => {
        const scope = { uaid: input.uaid };
        const loaded = await loadMemoryContext({ scope, optOut: context.memoryOptOut });
        return loaded ?? { skipped: true };
      },
    },
    {
      name: 'hol.chat.createSession',
      run: async ({ input, context }) => {
        const response = await withBroker((client) =>
          client.chat.createSession({ uaid: input.uaid, historyTtlSeconds: input.historyTtlSeconds ?? 120, auth: input.auth }),
        );
        context.sessionId = response.sessionId;
        return response;
      },
    },
    {
      name: 'hol.chat.sendMessage',
      run: async ({ input, context }) => {
        if (!context.sessionId) throw new Error('Missing chat session');
        const messages = input.messages?.length ? input.messages : ['Hello from workflow.historyTopUp'];
        const last = messages[messages.length - 1];
        for (const message of messages) {
          await recordMemory({
            scope: { uaid: input.uaid, sessionId: context.sessionId },
            role: 'user',
            content: message,
            toolName: 'workflow.historyTopUp',
            optOut: context.memoryOptOut,
          });
          await withBroker((client) =>
            client.chat.sendMessage({ sessionId: context.sessionId!, auth: input.auth, message, uaid: input.uaid }),
          );
        }
        return { lastMessage: last };
      },
    },
    {
      name: 'hol.chat.history',
      run: async ({ input, context }) => {
        if (!context.sessionId) throw new Error('Missing chat session');
        const history = await withBroker((client) => client.chat.getHistory(context.sessionId!));
        context.transcripts.push(history);
        await recordMemory({
          scope: { uaid: input.uaid, sessionId: context.sessionId },
          role: 'event',
          content: JSON.stringify({ history }),
          toolName: 'workflow.historyTopUp',
          optOut: context.memoryOptOut,
        });
        return history;
      },
    },
    {
      name: 'workflow.historyTopUp.compact',
      run: async ({ input, context }) => {
        if (!context.sessionId) throw new Error('Missing chat session');
        const sessionId = context.sessionId;
        const preserveEntries = input.preserveEntries ?? 2;
        try {
          const response = await withBroker((client) =>
            client.chat.compactHistory({ sessionId, preserveEntries }),
          );
          context.compactions.push(response);
          return response;
        } catch (error) {
          if (error instanceof RegistryBrokerError && error.status === 402) {
            const purchase = await withBroker((client) =>
              client.purchaseCreditsWithHbar({
                accountId: input.creditTopUp.accountId,
                privateKey: input.creditTopUp.privateKey,
                hbarAmount: input.creditTopUp.hbarAmount ?? 0.25,
                memo: input.creditTopUp.memo ?? 'workflow.historyTopUp',
                metadata: { sessionId },
              }),
            );
            context.purchases.push(purchase);
            const retry = await withBroker((client) =>
              client.chat.compactHistory({ sessionId, preserveEntries }),
            );
            context.compactions.push(retry);
            await recordMemory({
              scope: { uaid: input.uaid, sessionId },
              role: 'event',
              content: JSON.stringify({ purchase, retry }),
              toolName: 'workflow.historyTopUp',
              optOut: context.memoryOptOut,
            });
            return retry;
          }
          throw error;
        }
      },
    },
    {
      name: 'workflow.historyTopUp.confirm',
      run: async ({ context }) => {
        if (!context.sessionId) throw new Error('Missing chat session');
        const snapshot = await withBroker((client) => client.chat.getHistory(context.sessionId!));
        context.transcripts.push(snapshot);
        await recordMemory({
          scope: { uaid: context.uaid, sessionId: context.sessionId },
          role: 'event',
          content: JSON.stringify({ snapshot }),
          toolName: 'workflow.historyTopUp',
          optOut: context.memoryOptOut,
        });
        return snapshot;
      },
    },
  ],
};

export const historyTopUpWorkflow = scaffoldWorkflow(historyTopUpDefinition);
