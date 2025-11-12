import type { AgentRegistrationRequest, LedgerVerifyRequest } from '@hashgraphonline/standards-sdk';
import { scaffoldWorkflow } from './scaffold';
import type { PipelineDefinition } from './types';
import { x402TopUpWorkflow } from './x402-topup';
import { registerAgentAdvancedPipeline } from './register-advanced';
import { chatPipeline } from './chat';

interface X402RegistrationInput {
  payload: AgentRegistrationRequest;
  x402: {
    accountId: string;
    credits: number;
    evmPrivateKey: string;
    ledgerVerification?: LedgerVerifyRequest;
  };
  chatMessage?: string;
}

const x402RegistrationDefinition: PipelineDefinition<X402RegistrationInput, Record<string, unknown>> = {
  name: 'workflow.x402Registration',
  description: 'Full agent registration funded via X402 credits with chat validation.',
  version: '1.0.0',
  requiredEnv: ['REGISTRY_BROKER_API_KEY'],
  createContext: () => ({}),
  steps: [
    {
      name: 'workflow.x402TopUp',
      run: async ({ input, dryRun }) =>
        x402TopUpWorkflow.run(
          {
            accountId: input.x402.accountId,
            credits: input.x402.credits,
            evmPrivateKey: input.x402.evmPrivateKey,
            ledgerVerification: input.x402.ledgerVerification,
          },
          { dryRun },
        ),
    },
    {
      name: 'workflow.registerAgentAdvanced',
      run: async ({ input, dryRun }) => registerAgentAdvancedPipeline.run({ payload: input.payload }, { dryRun }),
    },
    {
      name: 'workflow.x402Registration.chat',
      skip: ({ input }) => !input.chatMessage,
      run: async ({ input, context, dryRun }) => {
        const uaid = (context.context as any)?.registrationResult?.context?.uaid;
        if (!uaid) throw new Error('UAID missing after registration');
        return chatPipeline.run({ uaid, message: input.chatMessage }, { dryRun });
      },
    },
  ],
};

export const x402RegistrationWorkflow = scaffoldWorkflow(x402RegistrationDefinition);
