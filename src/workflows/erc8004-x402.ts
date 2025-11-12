import type { AgentRegistrationRequest, LedgerVerifyRequest } from '@hashgraphonline/standards-sdk';
import { scaffoldWorkflow } from './scaffold';
import type { PipelineDefinition } from './types';
import { registerAgentErc8004Pipeline } from './register-erc8004';
import { x402TopUpWorkflow } from './x402-topup';
import { chatPipeline } from './chat';

interface Erc8004X402Input {
  payload: AgentRegistrationRequest;
  erc8004Networks?: string[];
  creditPurchase?: {
    accountId: string;
    credits: number;
    evmPrivateKey: string;
    ledgerVerification?: LedgerVerifyRequest;
    network?: 'base' | 'base-sepolia';
  };
  chatMessage?: string;
}

const erc8004X402Definition: PipelineDefinition<Erc8004X402Input, Record<string, unknown>> = {
  name: 'workflow.erc8004X402',
  description: 'Register on ERC-8004 networks with X402 credit purchases and chat smoke.',
  version: '1.0.0',
  requiredEnv: ['REGISTRY_BROKER_API_KEY'],
  createContext: () => ({}),
  steps: [
    {
      name: 'workflow.x402TopUp',
      skip: ({ input }) => !input.creditPurchase,
      run: async ({ input, dryRun }) =>
        x402TopUpWorkflow.run(
          {
            accountId: input.creditPurchase!.accountId,
            credits: input.creditPurchase!.credits,
            evmPrivateKey: input.creditPurchase!.evmPrivateKey,
            network: input.creditPurchase!.network,
            ledgerVerification: input.creditPurchase!.ledgerVerification,
          },
          { dryRun },
        ),
    },
    {
      name: 'workflow.registerAgentErc8004',
      run: async ({ input, dryRun }) =>
        registerAgentErc8004Pipeline.run(
          {
            payload: input.payload,
            erc8004Networks: input.erc8004Networks,
            creditTopUp: undefined,
          },
          { dryRun },
        ),
    },
    {
      name: 'workflow.erc8004X402.chat',
      skip: ({ input }) => !input.chatMessage,
      run: async ({ input, context, dryRun }) => {
        const uaid = (context?.context as any)?.registrationResult?.context?.uaid;
        if (!uaid) throw new Error('UAID missing after registration');
        return chatPipeline.run({ uaid, message: input.chatMessage }, { dryRun });
      },
    },
  ],
};

export const erc8004X402Workflow = scaffoldWorkflow(erc8004X402Definition);
