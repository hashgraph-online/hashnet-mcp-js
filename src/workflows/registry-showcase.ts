import { scaffoldWorkflow } from './scaffold';
import type { PipelineDefinition } from './types';
import { withBroker } from '../broker';
import { discoveryPipeline } from './discovery';
import { chatPipeline } from './chat';
import { opsPipeline } from './ops';
import type { AgentRegistrationRequest } from '@hashgraphonline/standards-sdk';

export interface RegistryShowcaseInput {
  query?: string;
  uaid?: string;
  message?: string;
  performCreditCheck?: boolean;
}

interface RegistryShowcaseContext {
  discovery?: unknown;
  uaid?: string;
  listProtocols?: unknown;
  detectProtocol?: unknown;
  stats?: unknown;
  metrics?: unknown;
  dashboard?: unknown;
  websocket?: unknown;
  chat?: unknown;
  creditQuote?: unknown;
}

const registryShowcaseDefinition: PipelineDefinition<RegistryShowcaseInput, RegistryShowcaseContext> = {
  name: 'workflow.registryBrokerShowcase',
  description: 'Discovery + analytics + chat showcase workflow inspired by registry-broker-demo.ts.',
  version: '1.0.0',
  requiredEnv: ['REGISTRY_BROKER_API_KEY'],
  createContext: () => ({}),
  steps: [
    {
      name: 'workflow.discovery',
      allowDuringDryRun: true,
      run: async ({ input, context, dryRun }) => {
        const result = await discoveryPipeline.run({ query: input.query }, { dryRun });
        context.discovery = result;
        context.uaid = input.uaid ?? (result.steps[0]?.output as any)?.hits?.[0]?.uaid;
        return result;
      },
    },
    {
      name: 'hol.listProtocols',
      allowDuringDryRun: true,
      run: async ({ context }) => {
        const response = await withBroker((client) => client.listProtocols());
        context.listProtocols = response;
        return response;
      },
    },
    {
      name: 'hol.detectProtocol',
      allowDuringDryRun: true,
      run: async ({ context }) => {
        const response = await withBroker((client) => client.detectProtocol({ headers: { 'content-type': 'application/json' }, body: '{}' }));
        context.detectProtocol = response;
        return response;
      },
    },
    {
      name: 'hol.stats',
      allowDuringDryRun: true,
      run: async ({ context }) => {
        const response = await withBroker((client) => client.stats());
        context.stats = response;
        return response;
      },
    },
    {
      name: 'hol.metricsSummary',
      allowDuringDryRun: true,
      run: async ({ context }) => {
        const response = await withBroker((client) => client.metricsSummary());
        context.metrics = response;
        return response;
      },
    },
    {
      name: 'hol.dashboardStats',
      allowDuringDryRun: true,
      run: async ({ context }) => {
        const response = await withBroker((client) => client.dashboardStats());
        context.dashboard = response;
        return response;
      },
    },
    {
      name: 'hol.websocketStats',
      allowDuringDryRun: true,
      run: async ({ context }) => {
        const response = await withBroker((client) => client.websocketStats());
        context.websocket = response;
        return response;
      },
    },
    {
      name: 'workflow.registryBrokerShowcase.chat',
      skip: ({ input, context }) => !(input.message && context.uaid),
      run: async ({ input, context, dryRun }) => {
        if (!context.uaid) throw new Error('No UAID discovered for chat');
        const result = await chatPipeline.run({ uaid: context.uaid, message: input.message }, { dryRun });
        context.chat = result;
        return result;
      },
    },
    {
      name: 'hol.getRegistrationQuote',
      skip: ({ input }) => !input.performCreditCheck,
      run: async ({ context }) => {
        const discoveryRecord =
          context.discovery && typeof context.discovery === 'object'
            ? (context.discovery as { context?: Record<string, unknown> })
            : null;
        const payload = (discoveryRecord?.context as { registrationPayload?: unknown } | undefined)?.registrationPayload ?? context.discovery;
        const response = await withBroker((client) => client.getRegistrationQuote(payload as unknown as AgentRegistrationRequest));
        context.creditQuote = response;
        return response;
      },
    },
  ],
};

export const registryBrokerShowcaseWorkflow = scaffoldWorkflow(registryShowcaseDefinition);
