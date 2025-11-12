import { registerPipeline } from './registry';
import type { PipelineDefinition } from './types';
import { withBroker } from '../broker';

interface RegistrationInput {
  payload: Record<string, unknown>;
}

interface RegistrationContext {
  payload: Record<string, unknown>;
  attemptId?: string;
  result?: unknown;
  uaid?: string;
}

const registrationDefinition: PipelineDefinition<RegistrationInput, RegistrationContext> = {
  name: 'workflow.registerMcp',
  description: 'Quote, register, and wait for completion.',
  version: '1.0.0',
  requiredEnv: ['REGISTRY_BROKER_API_KEY', 'HEDERA_ACCOUNT_ID', 'HEDERA_PRIVATE_KEY'],
  createContext: ({ payload }) => ({ payload }),
  steps: [
    {
      name: 'rb.getRegistrationQuote',
      allowDuringDryRun: true,
      run: async ({ context }) => withBroker((client) => client.getRegistrationQuote(context.payload)),
    },
    {
      name: 'rb.registerAgent',
      run: async ({ context }) => {
        const response = await withBroker((client) => client.registerAgent(context.payload));
        if ('attemptId' in response && typeof response.attemptId === 'string') {
          context.attemptId = response.attemptId;
        }
        context.result = response;
        return response;
      },
    },
    {
      name: 'rb.waitForRegistrationCompletion',
      run: async ({ context }) => {
        if (!context.attemptId) {
          throw new Error('Registration attemptId missing.');
        }
        const result = await withBroker((client) =>
          client.waitForRegistrationCompletion(context.attemptId!, {
            intervalMs: 2_000,
            timeoutMs: 5 * 60_000,
          }),
        );
        if (result?.result?.uaid) {
          context.uaid = result.result.uaid;
        }
        return result;
      },
    },
  ],
};

export const registrationPipeline = registerPipeline(registrationDefinition);
