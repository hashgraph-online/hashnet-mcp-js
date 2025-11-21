import type { AgentAuthConfig } from '@hashgraphonline/standards-sdk';
import { scaffoldWorkflow } from './scaffold';
import type { PipelineDefinition } from './types';
import { withBroker } from '../broker';

interface BridgeInput {
  uaid: string;
  localMessage: string;
  agentverseMessage: string;
  agentverseUaid: string;
  localAuth?: AgentAuthConfig;
  agentverseAuth?: AgentAuthConfig;
  iterations?: number;
}

interface BridgeContext {
  localSession?: string;
  agentverseSession?: string;
  localUaid?: string;
  agentverseUaid?: string;
  transcripts: Array<{ target: 'local' | 'agentverse'; response: unknown }>;
}

const agentverseBridgeDefinition: PipelineDefinition<BridgeInput, BridgeContext> = {
  name: 'workflow.agentverseBridge',
  description: 'Relay messages between a local UAID session and an Agentverse UAID.',
  version: '1.0.0',
  requiredEnv: ['REGISTRY_BROKER_API_KEY'],
  createContext: () => ({ transcripts: [] }),
  steps: [
    {
      name: 'workflow.agentverseBridge.createSessions',
      run: async ({ input, context }) => {
        const local = await withBroker((client) =>
          client.chat.createSession({ uaid: input.uaid, auth: input.localAuth, historyTtlSeconds: 300 }),
        );
        const agentverse = await withBroker((client) =>
          client.chat.createSession({ uaid: input.agentverseUaid, auth: input.agentverseAuth, historyTtlSeconds: 300 }),
        );
        context.localSession = local.sessionId;
        context.agentverseSession = agentverse.sessionId;
        context.localUaid = input.uaid;
        context.agentverseUaid = input.agentverseUaid;
        return { local, agentverse };
      },
    },
    {
      name: 'workflow.agentverseBridge.relay',
      run: async ({ input, context }) => {
        if (!context.localSession || !context.agentverseSession) {
          throw new Error('Sessions missing');
        }
        const iterations = input.iterations ?? 1;
        for (let i = 0; i < iterations; i += 1) {
          const localResponse = await withBroker((client) =>
            client.chat.sendMessage({
              sessionId: context.localSession!,
              auth: input.localAuth,
              message: input.localMessage,
              uaid: context.localUaid,
            }),
          );
          context.transcripts.push({ target: 'local', response: localResponse });
          const agentverseResponse = await withBroker((client) =>
            client.chat.sendMessage({
              sessionId: context.agentverseSession!,
              auth: input.agentverseAuth,
              message: input.agentverseMessage,
              uaid: context.agentverseUaid,
            }),
          );
          context.transcripts.push({ target: 'agentverse', response: agentverseResponse });
        }
        return context.transcripts;
      },
    },
    {
      name: 'workflow.agentverseBridge.history',
      allowDuringDryRun: true,
      run: async ({ context }) => {
        const localHistory = await withBroker((client) => client.chat.getHistory(context.localSession!));
        const agentverseHistory = await withBroker((client) => client.chat.getHistory(context.agentverseSession!));
        return { localHistory, agentverseHistory };
      },
    },
    {
      name: 'workflow.agentverseBridge.cleanup',
      allowDuringDryRun: true,
      run: async ({ context }) => {
        await Promise.all([
          withBroker((client) => client.chat.endSession(context.localSession!)),
          withBroker((client) => client.chat.endSession(context.agentverseSession!)),
        ]);
        return { ended: true };
      },
    },
  ],
};

export const agentverseBridgeWorkflow = scaffoldWorkflow(agentverseBridgeDefinition);
