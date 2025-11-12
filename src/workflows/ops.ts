import { registerPipeline } from './registry';
import type { PipelineDefinition } from './types';
import { withBroker } from '../broker';

interface OpsInput {
  inspect?: boolean;
}

interface OpsContext {
  stats?: unknown;
  metrics?: unknown;
  dashboard?: unknown;
}

const opsDefinition: PipelineDefinition<OpsInput, OpsContext> = {
  name: 'workflow.opsCheck',
  description: 'Run stats, metrics, dashboard, listProtocols, detectProtocol.',
  version: '1.0.0',
  requiredEnv: ['REGISTRY_BROKER_API_KEY'],
  createContext: () => ({}),
  steps: [
    {
      name: 'rb.stats',
      allowDuringDryRun: true,
      run: async ({ context }) => {
        const response = await withBroker((client) => client.stats());
        context.stats = response;
        return response;
      },
    },
    {
      name: 'rb.metricsSummary',
      allowDuringDryRun: true,
      run: async ({ context }) => {
        const response = await withBroker((client) => client.metricsSummary());
        context.metrics = response;
        return response;
      },
    },
    {
      name: 'rb.dashboardStats',
      allowDuringDryRun: true,
      run: async ({ context }) => {
        const response = await withBroker((client) => client.dashboardStats());
        context.dashboard = response;
        return response;
      },
    },
    {
      name: 'rb.listProtocols',
      allowDuringDryRun: true,
      run: async () => withBroker((client) => client.listProtocols()),
    },
    {
      name: 'rb.detectProtocol',
      allowDuringDryRun: true,
      run: async () =>
        withBroker((client) =>
          client.detectProtocol({
            headers: { 'content-type': 'application/json' },
            body: '{}',
          } as any),
        ),
    },
  ],
};

export const opsPipeline = registerPipeline(opsDefinition);
