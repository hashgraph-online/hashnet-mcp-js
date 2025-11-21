import { registerPipeline } from './registry';
import type { PipelineDefinition } from './types';
import { discoveryPipeline } from './discovery';
import { registrationPipeline } from './registration';
import { chatPipeline } from './chat';
import { opsPipeline } from './ops';
import type { AgentRegistrationRequest } from '@hashgraphonline/standards-sdk';

interface FullWorkflowInput {
  registrationPayload: AgentRegistrationRequest;
  discoveryQuery?: string;
  chatMessage?: string;
}

interface FullWorkflowContext {
  discovery?: unknown;
  registration?: unknown;
  chat?: unknown;
  ops?: unknown;
  uaid?: string;
}

const fullDefinition: PipelineDefinition<FullWorkflowInput, FullWorkflowContext> = {
  name: 'workflow.fullRegistration',
  description: 'Discovery → Registration → Chat → Ops health check',
  version: '1.0.0',
  requiredEnv: ['REGISTRY_BROKER_API_KEY', 'HEDERA_ACCOUNT_ID', 'HEDERA_PRIVATE_KEY'],
  createContext: () => ({}),
  steps: [
    {
      name: 'workflow.discovery',
      allowDuringDryRun: true,
      run: async ({ input, context }) => {
        const result = await discoveryPipeline.run({ query: input.discoveryQuery, limit: 5 });
        context.discovery = result;
        return result;
      },
    },
    {
      name: 'workflow.registerMcp',
      run: async ({ input, context, dryRun }) => {
        const payload = { payload: input.registrationPayload };
        const result = await registrationPipeline.run(payload, { dryRun });
        context.registration = result;
        context.uaid = result.context.uaid;
        return result;
      },
    },
    {
      name: 'workflow.chatSmoke',
      run: async ({ input, context, dryRun }) => {
        if (!context.uaid) throw new Error('UAID missing from registration context');
        const result = await chatPipeline.run({ uaid: context.uaid, message: input.chatMessage }, { dryRun });
        context.chat = result;
        return result;
      },
    },
    {
      name: 'workflow.opsCheck',
      allowDuringDryRun: true,
      run: async ({ context, dryRun }) => {
        const result = await opsPipeline.run({}, { dryRun });
        context.ops = result;
        return result;
      },
    },
  ],
};

export const fullWorkflowPipeline = registerPipeline(fullDefinition);
