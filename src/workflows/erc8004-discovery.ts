import { scaffoldWorkflow } from './scaffold';
import type { PipelineDefinition } from './types';
import { withBroker } from '../broker';

interface Erc8004DiscoveryInput {
  query?: string;
  limit?: number;
}

interface Erc8004DiscoveryContext {
  hits?: unknown;
}

const erc8004DiscoveryDefinition: PipelineDefinition<Erc8004DiscoveryInput, Erc8004DiscoveryContext> = {
  name: 'workflow.erc8004Discovery',
  description: 'Filter search/vector/namespace lookups for ERC-8004 registries.',
  version: '1.0.0',
  requiredEnv: [],
  createContext: () => ({}),
  steps: [
    {
      name: 'hol.search',
      allowDuringDryRun: true,
      run: async ({ input, context }) => {
        const response = await withBroker(
          (client) => client.search({ q: input.query, registries: ['erc-8004'], limit: input.limit ?? 10 }),
          'workflow.erc8004Discovery hol.search',
          { requireApiKey: false },
        );
        context.hits = response.hits;
        return response;
      },
    },
    {
      name: 'hol.registrySearchByNamespace',
      allowDuringDryRun: true,
      run: async ({ input }) =>
        withBroker((client) => client.registrySearchByNamespace('erc-8004', input.query), 'workflow.erc8004Discovery hol.registrySearchByNamespace', { requireApiKey: false }),
    },
  ],
};

export const erc8004DiscoveryWorkflow = scaffoldWorkflow(erc8004DiscoveryDefinition);
