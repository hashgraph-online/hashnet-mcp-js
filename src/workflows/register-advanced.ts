import type { AgentRegistrationRequest, AdditionalRegistryCatalogResponse } from '@hashgraphonline/standards-sdk';
import { scaffoldWorkflow } from './scaffold';
import type { PipelineDefinition } from './types';
import { withBroker } from '../broker';
import type { CreditShortfallSummary } from './errors';
import { runCreditAwareRegistration, waitForRegistrationCompletion } from './utils/credits';

interface CreditTopUpConfig {
  accountId: string;
  privateKey: string;
  hbarAmount?: number;
  memo?: string;
  maxRetries?: number;
}

export interface RegisterAgentAdvancedInput {
  payload: AgentRegistrationRequest;
  additionalRegistrySelections?: string[];
  updateAdditionalRegistries?: string[];
  skipUpdate?: boolean;
  creditTopUp?: CreditTopUpConfig;
}

interface RegisterAgentAdvancedContext {
  payload: AgentRegistrationRequest;
  resolvedRegistries: string[];
  missingRegistries: string[];
  lastQuote?: CreditShortfallSummary;
  attemptId?: string;
  uaid?: string;
  registrationResult?: unknown;
  updateResult?: unknown;
  progress?: unknown;
  catalog?: AdditionalRegistryCatalogResponse;
}

const registerAgentAdvancedDefinition: PipelineDefinition<RegisterAgentAdvancedInput, RegisterAgentAdvancedContext> = {
  name: 'workflow.registerAgentAdvanced',
  description: 'Extended registration workflow with additional registries and optional updates.',
  version: '1.0.0',
  requiredEnv: ['REGISTRY_BROKER_API_KEY'],
  createContext: ({ payload }) => ({ payload, resolvedRegistries: [], missingRegistries: [] }),
  steps: [
    {
      name: 'hol.getAdditionalRegistries',
      allowDuringDryRun: true,
      skip: ({ input }) => !input.additionalRegistrySelections?.length && !input.updateAdditionalRegistries?.length,
      run: async ({ context }) => {
        const catalog = await withBroker((client) => client.getAdditionalRegistries());
        context.catalog = catalog;
        return catalog;
      },
    },
    {
      name: 'workflow.resolveAdditionalRegistries',
      allowDuringDryRun: true,
      run: async ({ input, context }) => {
        const catalog = context.catalog;
        if (!catalog) return null;
        const selections = input.additionalRegistrySelections ?? [];
        const { resolved, missing } = resolveAdditionalSelections(selections, catalog);
        context.resolvedRegistries = resolved;
        context.missingRegistries = missing;
        if (resolved.length > 0) {
          context.payload = {
            ...context.payload,
            additionalRegistries: resolved,
          };
        }
        return { resolved, missing };
      },
    },
    {
      name: 'hol.getRegistrationQuote',
      allowDuringDryRun: true,
      run: async ({ context }) => withBroker((client) => client.getRegistrationQuote(context.payload)),
    },
    {
      name: 'workflow.registerAgentAdvanced.register',
      run: async ({ input, context }) => {
        const response = await runCreditAwareRegistration({
          payload: context.payload,
          onShortfall: async (err) => {
            context.lastQuote = err.summary;
            if (!input.creditTopUp) {
              return 'abort';
            }
            await purchaseCreditsWithHbar(input.creditTopUp, err.summary);
            return 'retry';
          },
        });
        context.registrationResult = response;
        if ('attemptId' in response && typeof response.attemptId === 'string') {
          context.attemptId = response.attemptId;
        }
        if ('uaid' in response && typeof response.uaid === 'string') {
          context.uaid = response.uaid;
        }
        return response;
      },
    },
    {
      name: 'hol.waitForRegistrationCompletion',
      run: async ({ context }) => {
        if (!context.attemptId) throw new Error('Registration attemptId missing.');
        const result = await waitForRegistrationCompletion(context.attemptId);
        context.progress = result;
        if (result && typeof result === 'object' && 'result' in result) {
          const progress = result as { result?: Record<string, unknown> };
          const maybeUaid = progress.result?.uaid;
          if (typeof maybeUaid === 'string') {
            context.uaid = maybeUaid;
          }
        }
        return result;
      },
    },
    {
      name: 'workflow.registerAgentAdvanced.update',
      skip: ({ input }) => input.skipUpdate || !input.updateAdditionalRegistries?.length,
      run: async ({ input, context }) => {
        if (!context.uaid) throw new Error('UAID missing for update.');
        const resolved = input.updateAdditionalRegistries ?? [];
        const updatePayload: AgentRegistrationRequest = {
          ...context.payload,
          additionalRegistries: resolved,
        };
        const response = await withBroker((client) => client.updateAgent(context.uaid!, updatePayload));
        context.updateResult = response;
        return response;
      },
    },
  ],
};

export const registerAgentAdvancedPipeline = scaffoldWorkflow(registerAgentAdvancedDefinition);

function resolveAdditionalSelections(selections: string[], catalog: AdditionalRegistryCatalogResponse) {
  if (!catalog.registries || catalog.registries.length === 0) {
    return { resolved: [], missing: selections };
  }
  const resolved = new Set<string>();
  const missing: string[] = [];
  for (const selection of selections) {
    const matches = collectMatches(selection, catalog);
    if (matches.length === 0) {
      missing.push(selection);
    } else {
      matches.forEach((key) => resolved.add(key));
    }
  }
  return { resolved: Array.from(resolved), missing };
}

function collectMatches(selection: string, catalog: AdditionalRegistryCatalogResponse) {
  const target = selection.trim().toLowerCase();
  if (!target) return [];
  const matches: string[] = [];
  for (const registry of catalog.registries ?? []) {
    const registryId = registry.id?.toLowerCase();
    const networks = registry.networks ?? [];
    if (!registryId || networks.length === 0) continue;
    if (registryId === target) {
      networks.forEach((network) => {
        if (network?.key) {
          matches.push(network.key);
        }
      });
      continue;
    }
    for (const network of networks) {
      if (!network?.key) continue;
      const keyLower = network.key.toLowerCase();
      const networkIdLower = network.networkId?.toLowerCase();
      const labelLower = network.label?.toLowerCase();
      const nameLower = network.name?.toLowerCase();
      if (
        target === keyLower ||
        (networkIdLower && target === networkIdLower) ||
        (labelLower && target === labelLower) ||
        (nameLower && target === nameLower) ||
        target === `${registryId}:${networkIdLower}`
      ) {
        matches.push(network.key);
      }
    }
  }
  return matches;
}

async function purchaseCreditsWithHbar(config: CreditTopUpConfig, summary: CreditShortfallSummary) {
  const hbarAmount = config.hbarAmount ?? Math.max(0.25, (summary.shortfallCredits ?? 1) / 100);
  await withBroker((client) =>
    client.purchaseCreditsWithHbar({
      accountId: config.accountId,
      privateKey: config.privateKey,
      hbarAmount,
      memo: config.memo ?? 'workflow.registerAgentAdvanced:topup',
      metadata: {
        shortfall: summary.shortfallCredits,
        requiredCredits: summary.requiredCredits,
      },
    }),
  );
}
