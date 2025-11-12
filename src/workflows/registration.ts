import type { AgentRegistrationRequest } from '@hashgraphonline/standards-sdk';
import { registerPipeline } from './registry';
import type { PipelineDefinition } from './types';
import { withBroker } from '../broker';
import type { CreditShortfallSummary } from './errors';
import { runCreditAwareRegistration } from './utils/credits';

interface RegistrationInput {
  payload: Record<string, unknown>;
}

interface RegistrationContext {
  payload: Record<string, unknown>;
  attemptId?: string;
  result?: unknown;
  uaid?: string;
  quote?: CreditShortfallSummary;
}

const registrationDefinition: PipelineDefinition<RegistrationInput, RegistrationContext> = {
  name: 'workflow.registerMcp',
  description: 'Quote, register, and wait for completion.',
  version: '1.0.0',
  requiredEnv: ['REGISTRY_BROKER_API_KEY'],
  createContext: ({ payload }) => ({ payload }),
  steps: [
    {
      name: 'hol.getRegistrationQuote',
      allowDuringDryRun: true,
      run: async ({ context }) => {
        const quote = await withBroker((client) => client.getRegistrationQuote(context.payload));
        context.quote = quote;
        return quote;
      },
    },
    {
      name: 'hol.registerAgent',
      run: async ({ context }) => {
        const response = await runCreditAwareRegistration({
          payload: context.payload as AgentRegistrationRequest,
          onShortfall: async (err) => {
            context.quote = err.summary;
            return 'abort';
          },
        });
        if ('attemptId' in response && typeof response.attemptId === 'string') {
          context.attemptId = response.attemptId;
        }
        context.result = response;
        return response;
      },
    },
    {
      name: 'hol.waitForRegistrationCompletion',
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
