import { registerPipeline } from './registry';
import type { PipelineDefinition } from './types';
import { withBroker } from '../broker';

interface DiscoveryInput {
  query?: string;
  limit?: number;
}

interface DiscoveryContext {
  results: {
    search?: unknown;
    vector?: unknown;
  };
}

const discoveryDefinition: PipelineDefinition<DiscoveryInput, DiscoveryContext> = {
  name: 'workflow.discovery',
  description: 'Run hol.search and hol.vectorSearch to explore agents.',
  version: '1.0.0',
  requiredEnv: ['REGISTRY_BROKER_API_KEY'],
  createContext: () => ({ results: {} }),
  steps: [
    {
      name: 'hol.search',
      description: 'Keyword search',
      allowDuringDryRun: true,
      run: async ({ input, context }) => {
        const payload = { q: input.query, limit: input.limit ?? 5 };
        const response = await withBroker((client) => client.search(payload));
        context.results.search = response;
        return response;
      },
    },
    {
      name: 'hol.vectorSearch',
      description: 'Vector similarity search',
      allowDuringDryRun: true,
      run: async ({ input, context }) => {
        if (!input.query) {
          return undefined;
        }
        const response = await withBroker((client) => client.vectorSearch({ query: input.query, limit: input.limit ?? 5 }));
        context.results.vector = response;
        return response;
      },
    },
  ],
};

export const discoveryPipeline = registerPipeline(discoveryDefinition);
