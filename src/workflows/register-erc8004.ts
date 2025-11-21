import type { AgentRegistrationRequest, AdditionalRegistryCatalogResponse, LedgerVerifyRequest } from '@hashgraphonline/standards-sdk';
import { scaffoldWorkflow } from './scaffold';
import type { PipelineDefinition } from './types';
import { withBroker } from '../broker';
import { registerAgentAdvancedPipeline, type RegisterAgentAdvancedInput } from './register-advanced';

export interface RegisterAgentErc8004Input extends RegisterAgentAdvancedInput {
  erc8004Networks?: string[];
  ledgerVerification?: LedgerVerifyRequest;
}

interface RegisterAgentErc8004Context {
  resolvedNetworks: string[];
  missingNetworks: string[];
  advancedResult?: unknown;
  catalog?: AdditionalRegistryCatalogResponse;
}

const registerAgentErc8004Definition: PipelineDefinition<RegisterAgentErc8004Input, RegisterAgentErc8004Context> = {
  name: 'workflow.registerAgentErc8004',
  description: 'ERC-8004-specific registration workflow with optional ledger verification.',
  version: '1.0.0',
  requiredEnv: ['REGISTRY_BROKER_API_KEY'],
  createContext: () => ({ resolvedNetworks: [], missingNetworks: [] }),
  steps: [
    {
      name: 'hol.getAdditionalRegistries',
      allowDuringDryRun: true,
      run: async ({ context }) => {
        const catalog = await withBroker((client) => client.getAdditionalRegistries());
        context.catalog = catalog;
        return catalog;
      },
    },
    {
      name: 'workflow.erc8004.resolveNetworks',
      allowDuringDryRun: true,
      run: async ({ input, context }) => {
        const response = context.catalog;
        if (!response) {
          context.resolvedNetworks = [];
          context.missingNetworks = [];
          return { resolved: [], missing: [] };
        }
        const selections = input.erc8004Networks?.length ? input.erc8004Networks : defaultErc8004Selections(response);
        const { resolved, missing } = resolveErc8004Selections(selections, response);
        context.resolvedNetworks = resolved;
        context.missingNetworks = missing;
        return { resolved, missing };
      },
    },
    {
      name: 'hol.ledger.authenticate',
      skip: ({ input }) => !input.ledgerVerification,
      run: async ({ input }) => withBroker((client) => client.verifyLedgerChallenge(input.ledgerVerification!)),
    },
    {
      name: 'workflow.registerAgentAdvanced',
      run: async ({ input, context, dryRun }) => {
        const advancedInput: RegisterAgentAdvancedInput = {
          payload: withAdditionalRegistries(input.payload, context.resolvedNetworks),
          additionalRegistrySelections: context.resolvedNetworks,
          updateAdditionalRegistries: input.updateAdditionalRegistries,
          skipUpdate: input.skipUpdate,
          creditTopUp: input.creditTopUp,
        };
        const result = await registerAgentAdvancedPipeline.run(advancedInput, { dryRun });
        context.advancedResult = result;
        return result;
      },
    },
  ],
};

export const registerAgentErc8004Pipeline = scaffoldWorkflow(registerAgentErc8004Definition);

function resolveErc8004Selections(selections: string[], catalog: AdditionalRegistryCatalogResponse) {
  if (!catalog.registries || catalog.registries.length === 0) {
    return { resolved: [], missing: selections };
  }
  const resolved = new Set<string>();
  const missing: string[] = [];
  selections.forEach((entry) => {
    const normalized = entry.trim().toLowerCase();
    if (!normalized) return;
    let matched = false;
    for (const descriptor of catalog.registries ?? []) {
      const descriptorId = descriptor.id?.toLowerCase();
      const networks = descriptor.networks ?? [];
      if (!descriptorId || !descriptorId.startsWith('erc-8004')) continue;
      for (const network of networks) {
        if (!network) continue;
        const candidates = [network.key, network.networkId, network.label, network.name]
          .map((value) => value?.toLowerCase().trim())
          .filter(Boolean);
        if (candidates.includes(normalized) || `${descriptorId}:${network.networkId?.toLowerCase()}` === normalized) {
          if (network.key) {
            resolved.add(network.key);
          }
          matched = true;
        }
      }
    }
    if (!matched) {
      missing.push(entry);
    }
  });
  return { resolved: Array.from(resolved), missing };
}

function defaultErc8004Selections(catalog: AdditionalRegistryCatalogResponse) {
  const defaults = catalog.registries?.find((entry) => entry.id?.toLowerCase() === 'erc-8004');
  if (!defaults || !defaults.networks) return [];
  return defaults.networks.map((network) => network?.key).filter((key): key is string => Boolean(key));
}

function withAdditionalRegistries(payload: AgentRegistrationRequest, networks: string[]) {
  if (networks.length === 0) return payload;
  return { ...payload, additionalRegistries: networks };
}
