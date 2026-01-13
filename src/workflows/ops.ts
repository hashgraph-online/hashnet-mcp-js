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
  requiredEnv: [],
  createContext: () => ({}),
  steps: [
    {
      name: 'hol.stats',
      allowDuringDryRun: true,
      run: async ({ context }) => {
        const response = await withBroker((client) => client.stats(), 'workflow.opsCheck hol.stats', { requireApiKey: false });
        context.stats = response;
        return response;
      },
    },
    {
      name: 'hol.metricsSummary',
      allowDuringDryRun: true,
      run: async ({ context }) => {
        const response = await withBroker((client) => client.metricsSummary(), 'workflow.opsCheck hol.metricsSummary', { requireApiKey: false });
        context.metrics = response;
        return response;
      },
    },
    {
      name: 'hol.dashboardStats',
      allowDuringDryRun: true,
      run: async ({ context }) => {
        const response = await withBroker((client) => client.dashboardStats(), 'workflow.opsCheck hol.dashboardStats', { requireApiKey: false });
        context.dashboard = response;
        return response;
      },
    },
    {
      name: 'hol.listProtocols',
      allowDuringDryRun: true,
      run: async () => withBroker((client) => client.listProtocols(), 'workflow.opsCheck hol.listProtocols', { requireApiKey: false }),
    },
    {
      name: 'hol.detectProtocol',
      allowDuringDryRun: true,
      run: async () =>
        withBroker(
          (client) =>
            client.detectProtocol({
              headers: { 'content-type': 'application/json' },
              body: '{}',
            }),
          'workflow.opsCheck hol.detectProtocol',
          { requireApiKey: false },
        ),
    },
  ],
};

export const opsPipeline = registerPipeline(opsDefinition);
