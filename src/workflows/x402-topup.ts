import type { BuyCreditsWithX402Params, LedgerVerifyRequest } from '@hashgraphonline/standards-sdk';
import { scaffoldWorkflow } from './scaffold';
import type { PipelineDefinition } from './types';
import { withBroker } from '../broker';

export interface X402TopUpInput {
  accountId: string;
  credits: number;
  usdAmount?: number;
  description?: string;
  metadata?: Record<string, unknown>;
  evmPrivateKey: string;
  network?: 'base' | 'base-sepolia';
  rpcUrl?: string;
  ledgerVerification?: LedgerVerifyRequest;
}

interface X402TopUpContext {
  minimums?: unknown;
  ledgerVerification?: unknown;
  purchase?: unknown;
}

const x402TopUpDefinition: PipelineDefinition<X402TopUpInput, X402TopUpContext> = {
  name: 'workflow.x402TopUp',
  description: 'Buy registry credits via X402 using an EVM wallet.',
  version: '1.0.0',
  requiredEnv: ['REGISTRY_BROKER_API_KEY'],
  createContext: () => ({}),
  steps: [
    {
      name: 'hol.ledger.authenticate',
      skip: ({ input }) => !input.ledgerVerification,
      run: async ({ input, context }) => {
        const verification = await withBroker((client) => client.verifyLedgerChallenge(input.ledgerVerification!));
        context.ledgerVerification = verification;
        return verification;
      },
    },
    {
      name: 'hol.x402.minimums',
      allowDuringDryRun: true,
      run: async ({ context }) => {
        const minimums = await withBroker((client) => client.getX402Minimums());
        context.minimums = minimums;
        return minimums;
      },
    },
    {
      name: 'hol.x402.buyCredits',
      run: async ({ input, context }) => {
        const payload: BuyCreditsWithX402Params = {
          accountId: input.accountId,
          credits: input.credits,
          usdAmount: input.usdAmount,
          description: input.description,
          metadata: input.metadata,
          evmPrivateKey: input.evmPrivateKey,
          network: input.network,
          rpcUrl: input.rpcUrl,
        } as BuyCreditsWithX402Params;
        const purchase = await withBroker((client) => client.buyCreditsWithX402(payload));
        context.purchase = purchase;
        return purchase;
      },
    },
  ],
};

export const x402TopUpWorkflow = scaffoldWorkflow(x402TopUpDefinition);
