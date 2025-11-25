import { registerPipeline } from './registry';
import type { PipelineDefinition } from './types';
import { discoveryPipeline } from './discovery';
import { registrationPipeline } from './registration';
import { chatPipeline } from './chat';
import { opsPipeline } from './ops';
import type { AgentRegistrationRequest } from '@hashgraphonline/standards-sdk';
import { loadMemoryContext, recordMemory } from './utils/memory';

interface FullWorkflowInput {
  registrationPayload: AgentRegistrationRequest;
  discoveryQuery?: string;
  chatMessage?: string;
  disableMemory?: boolean;
}

interface FullWorkflowContext {
  discovery?: unknown;
  registration?: unknown;
  chat?: unknown;
  ops?: unknown;
  uaid?: string;
  memoryOptOut?: boolean;
  memoryContext?: unknown;
}

const fullDefinition: PipelineDefinition<FullWorkflowInput, FullWorkflowContext> = {
  name: 'workflow.fullRegistration',
  description: 'Discovery → Registration → Chat → Ops health check',
  version: '1.0.0',
  requiredEnv: ['REGISTRY_BROKER_API_KEY', 'HEDERA_ACCOUNT_ID', 'HEDERA_PRIVATE_KEY'],
  createContext: (input) => ({ memoryOptOut: input.disableMemory }),
  steps: [
    {
      name: 'workflow.discovery',
      allowDuringDryRun: true,
      run: async ({ input, context }) => {
        const result = await discoveryPipeline.run({ query: input.discoveryQuery, limit: 5 });
        context.discovery = result;
        await recordMemory({
          scope: { namespace: 'workflow.fullRegistration' },
          role: 'event',
          content: JSON.stringify({ discovery: result }),
          toolName: 'workflow.fullRegistration',
          optOut: context.memoryOptOut,
        });
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
        if (context.uaid) {
          await recordMemory({
            scope: { uaid: context.uaid },
            role: 'event',
            content: JSON.stringify({ registration: result }),
            toolName: 'workflow.fullRegistration',
            optOut: context.memoryOptOut,
          });
        }
        return result;
      },
    },
    {
      name: 'workflow.fullRegistration.memory.load',
      skip: ({ input, context }) => Boolean(input.disableMemory || !context.uaid),
      run: async ({ context }) => {
        if (!context.uaid) return { skipped: true };
        const loaded = await loadMemoryContext({ scope: { uaid: context.uaid }, optOut: context.memoryOptOut });
        context.memoryContext = loaded ?? undefined;
        return loaded ?? { skipped: true };
      },
    },
    {
      name: 'workflow.chatSmoke',
      run: async ({ input, context, dryRun }) => {
        if (!context.uaid) throw new Error('UAID missing from registration context');
        const result = await chatPipeline.run({ uaid: context.uaid, message: input.chatMessage, disableMemory: input.disableMemory }, { dryRun });
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
