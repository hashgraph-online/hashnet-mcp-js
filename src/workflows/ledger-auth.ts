import type { LedgerChallengeRequest, LedgerVerifyRequest } from '@hashgraphonline/standards-sdk';
import { scaffoldWorkflow } from './scaffold';
import type { PipelineDefinition } from './types';
import { withBroker } from '../broker';

interface LedgerAuthInput extends LedgerChallengeRequest {
  signature?: string;
  signatureKind?: 'raw' | 'map';
  publicKey?: string;
  expiresInMinutes?: number;
}

interface LedgerAuthContext {
  challenge?: Awaited<ReturnType<typeof withBrokerChallenge>>;
  verification?: Awaited<ReturnType<typeof withBrokerVerify>>;
}

const ledgerAuthDefinition: PipelineDefinition<LedgerAuthInput, LedgerAuthContext> = {
  name: 'workflow.ledgerAuth',
  description: 'Create a ledger challenge and optionally verify it to obtain a ledger API key.',
  version: '1.0.0',
  requiredEnv: ['REGISTRY_BROKER_API_KEY'],
  createContext: () => ({}),
  steps: [
    {
      name: 'hol.ledger.challenge',
      run: async ({ input, context }) => {
        const challenge = await withBrokerChallenge({ accountId: input.accountId, network: input.network });
        context.challenge = challenge;
        return challenge;
      },
    },
    {
      name: 'hol.ledger.authenticate',
      skip: ({ input }) => !input.signature,
      run: async ({ input, context }) => {
        const verification = await withBrokerVerify({
          challengeId: context.challenge?.challengeId ?? input['challengeId'] ?? '',
          accountId: input.accountId,
          network: input.network,
          signature: input.signature!,
          signatureKind: input.signatureKind,
          publicKey: input.publicKey,
          expiresInMinutes: input.expiresInMinutes,
        });
        context.verification = verification;
        return verification;
      },
    },
  ],
};

export const ledgerAuthWorkflow = scaffoldWorkflow(ledgerAuthDefinition);

async function withBrokerChallenge(payload: LedgerChallengeRequest) {
  return withBroker((client) => client.createLedgerChallenge(payload));
}

async function withBrokerVerify(payload: LedgerVerifyRequest) {
  return withBroker((client) => client.verifyLedgerChallenge(payload));
}
