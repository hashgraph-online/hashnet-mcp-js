import { randomUUID } from 'node:crypto';
import {
  type AcceptConversationOptions,
  AgentAuthConfig,
  type ConversationEncryptionOptions,
  type EncryptedChatSendOptions,
  type EnsureAgentKeyOptions,
  type LedgerChallengeRequest,
  type LedgerVerifyRequest,
  RegistryBrokerClient,
  RegistryBrokerError,
  type StartConversationOptions,
} from '@hashgraphonline/standards-sdk';
import { FastMCP } from 'fastmcp';
import type { Context, Content } from 'fastmcp';
import { z } from 'zod';
import { cacheConversationHandle, getCachedConversationHandle, getCreditBalance, requestBrokerJson, withBroker, withEncryptedBroker } from './broker';
import { config } from './config';
import { logger } from './logger';
import { agentRegistrationSchema } from './schemas/agent';
import { discoveryPipeline } from './workflows/discovery';
import { registrationPipeline } from './workflows/registration';
import { chatPipeline } from './workflows/chat';
import { opsPipeline } from './workflows/ops';
import { fullWorkflowPipeline } from './workflows/combined';
import { openRouterChatWorkflow } from './workflows/openrouter-chat';
import { registryBrokerShowcaseWorkflow } from './workflows/registry-showcase';
import { agentverseBridgeWorkflow } from './workflows/agentverse-bridge';
import { erc8004DiscoveryWorkflow } from './workflows/erc8004-discovery';
import { erc8004X402Workflow } from './workflows/erc8004-x402';
import { x402RegistrationWorkflow } from './workflows/x402-registration';
import { encryptedChatWorkflow } from './workflows/encrypted-chat';
import type { PipelineRunResult } from './workflows/types';
import { memoryService } from './memory';
import type { MemoryScope } from './memory';

function isSemverVersion(value: string): value is `${number}.${number}.${number}` {
  return /^\d+\.\d+\.\d+$/.test(value);
}

function resolveEnsureOption(
  uaid: string,
  ensureEncryptionKey?: boolean | EnsureAgentKeyOptions,
): boolean | EnsureAgentKeyOptions | undefined {
  if (ensureEncryptionKey === undefined) return undefined;
  if (typeof ensureEncryptionKey === 'boolean') return ensureEncryptionKey;
  return { ...ensureEncryptionKey, uaid };
}

type AgentRegistrationRequest = Parameters<RegistryBrokerClient['registerAgent']>[0];
type ChatCreateSessionPayload = Parameters<RegistryBrokerClient['chat']['createSession']>[0];
type ChatSendMessagePayload = Parameters<RegistryBrokerClient['chat']['sendMessage']>[0];
type ChatCompactPayload = Parameters<RegistryBrokerClient['chat']['compactHistory']>[0];
type UpdateAgentPayload = Parameters<RegistryBrokerClient['updateAgent']>[1];
type RegistrySearchNamespaceArgs = Parameters<RegistryBrokerClient['registrySearchByNamespace']>;
type PurchaseHbarPayload = Parameters<RegistryBrokerClient['purchaseCreditsWithHbar']>[0];
type BuyX402Payload = Parameters<RegistryBrokerClient['buyCreditsWithX402']>[0];

type StartEncryptedConversationInput = {
  uaid: string;
  senderUaid: string;
  historyTtlSeconds?: number;
  auth?: AgentAuthConfig;
  encryption?: ConversationEncryptionOptions;
  ensureEncryptionKey?: boolean | EnsureAgentKeyOptions;
};

type AcceptEncryptedConversationInput = {
  sessionId: string;
  responderUaid: string;
  encryption?: ConversationEncryptionOptions;
  ensureEncryptionKey?: boolean | EnsureAgentKeyOptions;
};

type EncryptedSendInputShape = {
  sessionId: string;
  uaid: string;
  plaintext: string;
  message?: string;
  streaming?: boolean;
  auth?: AgentAuthConfig;
  decryptHistory?: boolean;
  ensureEncryptionKey?: boolean | EnsureAgentKeyOptions;
};

const connectionInstructions = [
  'When the user asks you to solve a task, prefer delegating narrow subtasks to specialized registry agents: use hol.delegate.suggest to shortlist candidates, then hol.chat.sendMessage to ask for a focused deliverable and bring the result back.',
  'If you want to enlist help immediately, use workflow.delegate { task } (it discovers a top candidate and messages them automatically). Use hol.delegate.suggest when the user explicitly wants to choose the agent first.',
  'You expose the Hashgraph Online Registry Broker via hol.* primitives and workflow.* pipelines. Prefer workflow.* when possible—they bundle common steps and return a pipeline summary plus full results.',
  'Discovery: use workflow.discovery (or hol.search / hol.vectorSearch / hol.agenticSearch) to find UAIDs/agents/MCP servers; pass q/query and optional filters like capabilities, metadata, or type=ai-agents|mcp-servers.',
  'Registration: workflow.registerMcp (quote → register → wait) is the default; workflow.fullRegistration adds discovery/chat/ops. hol.registerAgent + hol.waitForRegistrationCompletion are the lower-level primitives.',
  'Chat: call hol.resolveUaid if the UAID is unverified, then hol.chat.createSession (uaid + optional auth) followed by hol.chat.sendMessage (sessionId or uaid). Use hol.chat.history/compact/end to manage the session.',
  'Operations: workflow.opsCheck or hol.stats/hol.metricsSummary/hol.dashboardStats show registry health; hol.listProtocols + hol.detectProtocol help route third-party requests.',
  'Credits: check hol.credits.balance before purchases. Use hol.purchaseCredits.hbar or hol.x402.buyCredits only with explicit user approval (X402 requires an EVM key); hol.x402.minimums provides thresholds.',
  'Always include UAIDs/sessionIds exactly as given and echo any auth headers/tokens the user supplies. If required fields are missing (UAID, payload, accountId), ask for them before calling tools.',
  'Additional help resources: help://rb/search documents hol.search filters; help://hol/usage lists common recipes.',
].join('\n');

const agentAuthSchema: z.ZodType<AgentAuthConfig> = z
  .object({
    type: z.enum(['bearer', 'basic', 'header', 'apiKey']).optional(),
    token: z.string().optional(),
    username: z.string().optional(),
    password: z.string().optional(),
    headerName: z.string().optional(),
    headerValue: z.string().optional(),
    headers: z.record(z.string(), z.string()).optional(),
  })
  .partial() as z.ZodType<AgentAuthConfig>;

const chatSessionSchema: z.ZodType<ChatCreateSessionPayload> = z.object({
  uaid: z.string().min(1),
  historyTtlSeconds: z.number().int().positive().optional(),
  auth: agentAuthSchema.optional(),
  senderUaid: z.string().min(1).optional(),
  encryptionRequested: z.boolean().optional(),
}) as z.ZodType<ChatCreateSessionPayload>;

const chatMessageSchema = z
  .object({
    sessionId: z.string().min(1).optional(),
    uaid: z.string().min(1).optional(),
    message: z.string().min(1),
    streaming: z.boolean().optional(),
    auth: agentAuthSchema.optional(),
  })
  .superRefine((value, ctx) => {
    if (!value.sessionId && !value.uaid) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Provide sessionId for existing chats or uaid to start a new one.' });
    }
  });

const chatCompactSchema: z.ZodType<ChatCompactPayload> = z.object({
  sessionId: z.string().min(1),
  preserveEntries: z.number().int().min(0).default(4),
  auth: agentAuthSchema.optional(),
}) as z.ZodType<ChatCompactPayload>;

const conversationEncryptionSchema: z.ZodType<ConversationEncryptionOptions> = z
  .object({
    preference: z.enum(['preferred', 'required', 'disabled']).optional(),
    handshakeTimeoutMs: z.number().int().positive().optional(),
    pollIntervalMs: z.number().int().positive().optional(),
  })
  .partial() as z.ZodType<ConversationEncryptionOptions>;

const ensureEncryptionKeySchema: z.ZodType<EnsureAgentKeyOptions> = z.object({
  uaid: z.string().min(1),
  keyType: z.enum(['secp256k1']).optional(),
  publicKey: z.string().optional(),
  privateKey: z.string().optional(),
  envVar: z.string().optional(),
  envPath: z.string().optional(),
  generateIfMissing: z.boolean().optional(),
  overwriteEnv: z.boolean().optional(),
  ledgerAccountId: z.string().optional(),
  ledgerNetwork: z.string().optional(),
  email: z.string().email().optional(),
  label: z.string().optional(),
}) as z.ZodType<EnsureAgentKeyOptions>;

const startConversationSchema: z.ZodType<StartEncryptedConversationInput> = z.object({
  uaid: z.string().min(1),
  senderUaid: z.string().min(1),
  historyTtlSeconds: z.number().int().positive().optional(),
  auth: agentAuthSchema.optional(),
  encryption: conversationEncryptionSchema.optional(),
  ensureEncryptionKey: z.union([z.boolean(), ensureEncryptionKeySchema]).optional(),
});

const acceptConversationSchema: z.ZodType<AcceptEncryptedConversationInput> = z.object({
  sessionId: z.string().min(1),
  responderUaid: z.string().min(1),
  encryption: conversationEncryptionSchema.optional(),
  ensureEncryptionKey: z.union([z.boolean(), ensureEncryptionKeySchema]).optional(),
});

const encryptedSendSchema: z.ZodType<EncryptedSendInputShape> = z.object({
  sessionId: z.string().min(1),
  uaid: z.string().min(1),
  plaintext: z.string().min(1),
  message: z.string().optional(),
  streaming: z.boolean().optional(),
  auth: agentAuthSchema.optional(),
  decryptHistory: z.boolean().optional(),
  ensureEncryptionKey: z.union([z.boolean(), ensureEncryptionKeySchema]).optional(),
});

const searchInput = z.object({
  q: z.string().optional(),
  query: z.string().optional(),
  page: z.number().int().min(1).optional(),
  limit: z.number().int().min(1).max(50).default(10),
  registry: z.string().optional(),
  registries: z.array(z.string()).optional(),
  capabilities: z.array(z.string()).optional(),
  protocols: z.array(z.string()).optional(),
  adapters: z.array(z.string()).optional(),
  minTrust: z.number().int().min(0).max(100).optional(),
  verified: z.boolean().optional(),
  online: z.boolean().optional(),
  sortBy: z.string().optional(),
  sortOrder: z.string().optional(),
  metadata: z.record(z.string(), z.array(z.union([z.string(), z.number(), z.boolean()]))).optional(),
  type: z.union([z.enum(['ai-agents', 'mcp-servers', 'all']), z.string().min(1)]).optional(),
});

const vectorSearchInput = z.object({
  query: z.string().min(1),
  limit: z.number().int().min(1).max(20).default(5),
});

const agenticSearchFilterInput = z
  .object({
    registry: z.string().min(1).optional(),
    registries: z.array(z.string().min(1)).optional(),
    protocols: z.array(z.string().min(1)).optional(),
    adapter: z.array(z.string().min(1)).optional(),
    adapters: z.array(z.string().min(1)).optional(),
    capabilities: z.array(z.string().min(1)).optional(),
    type: z.enum(['ai-agents', 'mcp-servers']).optional(),
  })
  .optional();

const agenticSearchInput = z.object({
  query: z.string().min(1),
  limit: z.number().int().min(1).max(20).default(5),
  offset: z.number().int().min(0).default(0),
  debug: z.boolean().optional(),
  filter: agenticSearchFilterInput,
});

const uaidInput = z.object({ uaid: z.string().min(1) });

const registrationPayload = z.object({
  payload: agentRegistrationSchema,
});

const workflowDiscoveryInput = z.object({
  query: z.string().optional(),
  limit: z.number().int().min(1).max(50).optional(),
});

const workflowRegistrationInput = z.object({
  payload: agentRegistrationSchema,
});

const workflowChatInput = z.object({
  uaid: z.string().min(1),
  message: z.string().optional(),
  disableMemory: z.boolean().optional(),
});

const workflowEncryptedChatInput = z.object({
  requesterUaid: z.string().min(1),
  responderUaid: z.string().min(1),
  requesterAuth: agentAuthSchema.optional(),
  responderAuth: agentAuthSchema.optional(),
  requesterMessage: z.string().optional(),
  responderMessage: z.string().optional(),
  disableMemory: z.boolean().optional(),
});

const workflowOpsInput = z.object({});

const workflowFullInput = z.object({
  registrationPayload: agentRegistrationSchema,
  discoveryQuery: z.string().optional(),
  chatMessage: z.string().optional(),
  disableMemory: z.boolean().optional(),
});

const workflowDelegateInput = z.object({
  task: z.string().min(1),
  query: z.string().optional(),
  uaid: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(3).default(1),
  type: z.enum(['ai-agents', 'mcp-servers']).optional(),
  registries: z.array(z.string().min(1)).optional(),
  capabilities: z.array(z.string().min(1)).optional(),
  protocols: z.array(z.string().min(1)).optional(),
  adapters: z.array(z.string().min(1)).optional(),
  minTrust: z.number().int().min(0).max(100).optional(),
  verified: z.boolean().optional(),
  online: z.boolean().optional(),
  message: z.string().min(1).optional(),
  streaming: z.boolean().optional(),
});
const openRouterChatToolSchema = z.object({
  modelId: z.string().min(1),
  registry: z.string().optional(),
  message: z.string(),
  authToken: z.string().optional(),
  disableMemory: z.boolean().optional(),
});
const registryShowcaseToolSchema = z.object({
  query: z.string().optional(),
  uaid: z.string().optional(),
  message: z.string().optional(),
  performCreditCheck: z.boolean().optional(),
  disableMemory: z.boolean().optional(),
});
const erc8004DiscoveryToolSchema = z.object({ query: z.string().optional(), limit: z.number().int().positive().optional() });
const bridgePayloadSchema = z.object({
  uaid: z.string().min(1),
  agentverseUaid: z.string().min(1),
  localMessage: z.string().min(1),
  agentverseMessage: z.string().min(1),
  iterations: z.number().int().positive().optional(),
});
const erc8004X402ToolSchema = z.object({
  payload: agentRegistrationSchema,
  erc8004Networks: z.array(z.string()).optional(),
  chatMessage: z.string().optional(),
});
const x402RegistrationToolSchema = z.object({
  payload: agentRegistrationSchema,
    x402: z.object({
      accountId: z.string().min(1),
      credits: z.number().positive(),
      evmPrivateKey: z.string().min(1),
      ledgerVerification: z
        .object({
          challengeId: z.string().min(1),
          accountId: z.string().min(1),
          network: z.enum(['mainnet', 'testnet']),
          signature: z.string().min(1),
          signatureKind: z.enum(['raw', 'map']).optional(),
          publicKey: z.string().optional(),
          expiresInMinutes: z.number().int().positive().optional(),
        })
        .optional(),
    }),
  chatMessage: z.string().optional(),
});

type SearchInput = z.infer<typeof searchInput>;
type VectorSearchInput = z.infer<typeof vectorSearchInput>;
type AgenticSearchInput = z.infer<typeof agenticSearchInput>;
type UaidInput = z.infer<typeof uaidInput>;
type SessionAuth = Record<string, unknown> | undefined;
type RegistrationInput = z.infer<typeof registrationPayload>;
type WaitForRegistrationInput = z.infer<typeof waitForRegistrationInput>;
type UpdateAgentInput = z.infer<typeof updateAgentInput>;
type RegistryNamespaceInput = z.infer<typeof registryNamespaceInput>;
type ChatSessionInput = z.infer<typeof chatSessionSchema>;
type ChatMessageInput = z.infer<typeof chatMessageSchema>;
type ChatCompactInput = z.infer<typeof chatCompactSchema>;
type EnsureKeyInput = z.infer<typeof ensureEncryptionKeySchema>;
type StartConversationInput = z.infer<typeof startConversationSchema>;
type AcceptConversationInput = z.infer<typeof acceptConversationSchema>;
type EncryptedSendInput = z.infer<typeof encryptedSendSchema>;
type CreditBalanceInput = z.infer<typeof creditBalanceInput>;
type LedgerChallengeInput = z.infer<typeof ledgerChallengeInput>;
type LedgerVerifyInput = z.infer<typeof ledgerVerifyInput>;
type PurchaseHbarInput = z.infer<typeof purchaseHbarInput>;
type BuyX402Input = z.infer<typeof buyX402Input>;
type BridgePayload = z.infer<typeof bridgePayloadSchema>;
type Erc8004X402Input = z.infer<typeof erc8004X402ToolSchema>;
type X402RegistrationInput = z.infer<typeof x402RegistrationToolSchema>;
type FullWorkflowInput = z.infer<typeof workflowFullInput>;
type DelegateWorkflowInput = z.infer<typeof workflowDelegateInput>;
const memoryScopeSchema = z
  .object({
    uaid: z.string().min(1).optional(),
    sessionId: z.string().min(1).optional(),
    namespace: z.string().min(1).optional(),
    userId: z.string().min(1).optional(),
  })
  .refine((value) => Boolean(value.uaid || value.sessionId || value.namespace || value.userId), {
    message: 'Provide at least one scope identifier (uaid, sessionId, namespace, or userId).',
  });

const memoryContextSchema = z.object({
  scope: memoryScopeSchema,
  limit: z.number().int().positive().max(200).optional(),
  includeSummary: z.boolean().optional(),
});

const memoryNoteSchema = z.object({
  scope: memoryScopeSchema,
  content: z.string().min(1),
});

const memoryClearSchema = z.object({
  scope: memoryScopeSchema,
});

const memorySearchSchema = z.object({
  scope: memoryScopeSchema,
  query: z.string().min(1),
  limit: z.number().int().positive().max(200).optional(),
});

const waitForRegistrationInput = z.object({
  attemptId: z.string(),
  intervalMs: z.number().int().positive().default(2_000),
  timeoutMs: z.number().int().positive().default(5 * 60 * 1000),
});

const detectProtocolInput = z.object({
  headers: z.record(z.string(), z.string()),
  body: z.string().optional(),
});

const delegateSuggestInput = z.object({
  task: z.string().min(1),
  query: z.string().optional(),
  limit: z.number().int().min(1).max(10).default(5),
  type: z.enum(['ai-agents', 'mcp-servers']).optional(),
  registries: z.array(z.string()).optional(),
  capabilities: z.array(z.string()).optional(),
  protocols: z.array(z.string()).optional(),
  adapters: z.array(z.string()).optional(),
  minTrust: z.number().int().min(0).max(100).optional(),
  verified: z.boolean().optional(),
  online: z.boolean().optional(),
});

const sessionIdInput = z.object({ sessionId: z.string().min(1) });

const emptyObject = z.object({});

const updateAgentInput = z.object({
  uaid: z.string().min(1),
  payload: agentRegistrationSchema,
});

const registryNamespaceInput = z.object({
  registry: z.string().min(1),
  query: z.string().optional(),
});

const creditBalanceInput = z.object({
  hederaAccountId: z.string().min(1).optional(),
  x402AccountId: z.string().min(1).optional(),
});

const ledgerNetworkEnum = z.enum(['mainnet', 'testnet']);

const ledgerChallengeInput = z.object({
  accountId: z.string().min(1),
  network: ledgerNetworkEnum,
});

const ledgerVerifyInput = z.object({
  challengeId: z.string().min(1),
  accountId: z.string().min(1),
  network: ledgerNetworkEnum,
  signature: z.string().min(1),
  signatureKind: z.enum(['raw', 'map']).optional(),
  publicKey: z.string().optional(),
  expiresInMinutes: z.number().int().positive().optional(),
});

const purchaseHbarInput: z.ZodType<PurchaseHbarPayload> = z.object({
  accountId: z.string().min(1),
  privateKey: z.string().min(1),
  hbarAmount: z.number().positive(),
  memo: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
}) as z.ZodType<PurchaseHbarPayload>;

const buyX402Input: z.ZodType<BuyX402Payload> = z.object({
  accountId: z.string().min(1),
  credits: z.number().positive(),
  usdAmount: z.number().positive().optional(),
  description: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  evmPrivateKey: z.string().min(1),
  network: z.enum(['base', 'base-sepolia']).optional(),
  rpcUrl: z.string().url().optional(),
}) as z.ZodType<BuyX402Payload>;

export const mcp = new FastMCP({
  name: process.env.MCP_SERVER_NAME?.trim() || '@hol-org/hashnet-mcp',
  version: (() => {
    const raw = process.env.npm_package_version?.trim();
    return raw && isSemverVersion(raw) ? raw : '0.0.0';
  })(),
  instructions: connectionInstructions,
  logger: {
    debug: (...args: unknown[]) => logger.debug(args),
    info: (...args: unknown[]) => logger.info(args),
    warn: (...args: unknown[]) => logger.warn(args),
    error: (...args: unknown[]) => logger.error(args),
    log: (...args: unknown[]) => logger.info(args),
  },
});

type ToolDefinition<Schema extends z.ZodTypeAny = z.ZodTypeAny> = {
  name: string;
  description: string;
  schema: Schema;
  handler: (input: z.infer<Schema>) => Promise<unknown>;
};

const rawToolDefinitions = [
  {
    name: 'hol.search',
    description: 'Keyword search for agents or MCP servers with filtering controls.',
    schema: searchInput,
    handler: (input: SearchInput) => {
      const { query, q, ...rest } = input;
      const payload = { ...rest, q: q ?? query };
      return withBroker((client) => client.search(payload), 'hol.search', { requireApiKey: false });
    },
  },
  {
    name: 'hol.vectorSearch',
    description: 'Vector similarity search across registered agents.',
    schema: vectorSearchInput,
    handler: async (input: VectorSearchInput) => {
      try {
        return await withBroker((client) => client.vectorSearch(input), 'hol.vectorSearch', { requireApiKey: false });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (/Failed to parse vector search response/i.test(message)) {
          return requestBrokerJson('/search', {
            method: 'POST',
            body: input,
            headers: { 'content-type': 'application/json' },
            requireApiKey: false,
          });
        }
        throw error;
      }
    },
  },
  {
    name: 'hol.agenticSearch',
    description: 'Hybrid agentic search (semantic + lexical) across registered agents or MCP servers.',
    schema: agenticSearchInput,
    handler: async (input: AgenticSearchInput) => {
      const filter = normalizeAgenticFilter(input.filter);
      return requestBrokerJson('/search/agentic', {
        method: 'POST',
        body: {
          query: input.query,
          limit: input.limit,
          offset: input.offset,
          ...(filter ? { filter } : {}),
          ...(input.debug ? { debug: true } : {}),
        },
        headers: { 'content-type': 'application/json' },
        requireApiKey: false,
      });
    },
  },
  {
    name: 'hol.delegate.suggest',
    description: 'Suggest registry agents to delegate a subtask to (shortlist + message templates).',
    schema: delegateSuggestInput,
    handler: async (input: z.infer<typeof delegateSuggestInput>) => {
      const query = input.query ?? input.task;
      const delegationType = input.type ?? inferDelegationType(`${input.task}\n${query}`);
      const filter = omitUndefined({
        registries: input.registries,
        capabilities: input.capabilities,
        protocols: input.protocols,
        adapters: input.adapters,
        minTrust: input.minTrust,
        verified: input.verified,
        online: input.online,
        type: delegationType,
      });

      const [agenticSearch, vectorSearch, keywordSearch] = await Promise.all([
        safeToolCall('hol.agenticSearch', () =>
          requestBrokerJson('/search/agentic', {
            method: 'POST',
            body: {
              query,
              limit: Math.min(20, Math.max(input.limit * 4, input.limit)),
              offset: 0,
              filter: normalizeAgenticFilter({
                registry: input.registries?.length === 1 ? input.registries[0] : undefined,
                protocols: input.protocols,
                adapter: input.adapters,
                capabilities: input.capabilities,
                type: delegationType,
              }),
            },
            headers: { 'content-type': 'application/json' },
            requireApiKey: false,
          }),
        ),
        safeToolCall('hol.vectorSearch', () =>
          withBroker((client) => client.vectorSearch({ query, limit: input.limit }), 'hol.delegate.suggest hol.vectorSearch', { requireApiKey: false }),
        ),
        safeToolCall('hol.search', () =>
          withBroker(
            (client) =>
              client.search({
                q: query,
                limit: Math.min(50, input.limit * 4),
                ...filter,
              }),
            'hol.delegate.suggest hol.search',
            { requireApiKey: false },
          ),
        ),
      ]);

      const candidates = pickDelegateCandidates(
        [agenticSearch.value, vectorSearch.value, keywordSearch.value],
        {
          limit: input.limit,
          minTrust: input.minTrust,
          verified: input.verified,
          online: input.online,
          registries: input.registries,
        },
      ).map((candidate) => ({
        ...candidate,
        suggestedMessage: buildDelegateMessage(input.task, candidate),
      }));

      const suggestedNextCalls = candidates.map((candidate) => ({
        tool: 'hol.chat.sendMessage',
        arguments: {
          uaid: candidate.uaid,
          message: candidate.suggestedMessage,
        },
      }));

      const summary = [
        `Delegate suggestions (query: ${JSON.stringify(query)})`,
        candidates.length
          ? candidates.map((candidate, idx) => `${idx + 1}. ${candidate.label} — ${candidate.uaid}`).join('\n')
          : 'No candidates discovered from the broker response.',
        '',
        'Next: pick a UAID and call hol.chat.sendMessage { uaid, message }.',
      ].join('\n');

      return {
        content: [
          { type: 'text', text: summary },
          buildObjectContent('delegate.suggest', {
            query,
            task: input.task,
            candidates,
            suggestedNextCalls,
            sources: {
              agenticSearch: agenticSearch.error ? { error: agenticSearch.error } : agenticSearch.value,
              keywordSearch: keywordSearch.error ? { error: keywordSearch.error } : keywordSearch.value,
              vectorSearch: vectorSearch.error ? { error: vectorSearch.error } : vectorSearch.value,
            },
          }),
        ],
      };
    },
  },
  {
    name: 'hol.resolveUaid',
    description: 'Resolve, validate, and check the status of a UAID in one call.',
    schema: uaidInput,
    handler: ({ uaid }: UaidInput) =>
      withBroker(async (client) => {
        const [resolved, validation, status] = await Promise.all([
          client.resolveUaid(uaid),
          client.validateUaid(uaid),
          client.getUaidConnectionStatus(uaid),
        ]);
        return { resolved, validation, status };
      }, 'hol.resolveUaid', { requireApiKey: false }),
  },
  {
    name: 'hol.closeUaidConnection',
    description: 'Force-close any open UAID connection.',
    schema: uaidInput,
    handler: ({ uaid }: UaidInput) => withBroker((client) => client.closeUaidConnection(uaid), 'hol.closeUaidConnection', { requireApiKey: false }),
  },
  {
    name: 'hol.getRegistrationQuote',
    description: 'Estimate fees for a given agent registration payload.',
    schema: registrationPayload,
    handler: ({ payload }: RegistrationInput) => withBroker((client) => client.getRegistrationQuote(payload), 'hol.getRegistrationQuote', { requireApiKey: false }),
  },
  {
    name: 'hol.registerAgent',
    description: 'Submit an HCS-11-compatible agent registration.',
    schema: registrationPayload,
    handler: ({ payload }: RegistrationInput) => withBroker((client) => client.registerAgent(payload), 'hol.registerAgent', { requireApiKey: false }),
  },
  {
    name: 'hol.waitForRegistrationCompletion',
    description: 'Poll the registry broker until a registration attempt resolves.',
    schema: waitForRegistrationInput,
    handler: ({ attemptId, intervalMs, timeoutMs }: WaitForRegistrationInput) =>
      withBroker((client) =>
        client.waitForRegistrationCompletion(attemptId, {
          intervalMs,
          timeoutMs,
        }),
        'hol.waitForRegistrationCompletion',
        { requireApiKey: false },
      ),
  },
  {
    name: 'hol.updateAgent',
    description: 'Update an existing agent registration payload.',
    schema: updateAgentInput,
    handler: ({ uaid, payload }: UpdateAgentInput) =>
      withBroker((client) => client.updateAgent(uaid, payload as UpdateAgentPayload), 'hol.updateAgent', { requireApiKey: false }),
  },
  {
    name: 'hol.additionalRegistries',
    description: 'Retrieve the catalog of additional registries and networks.',
    schema: emptyObject,
    handler: () => withBroker((client) => client.getAdditionalRegistries(), 'hol.additionalRegistries', { requireApiKey: false }),
  },
  {
    name: 'hol.registrySearchByNamespace',
    description: 'Search within a specific registry namespace.',
    schema: registryNamespaceInput,
    handler: ({ registry, query }: RegistryNamespaceInput) =>
      withBroker((client) => client.registrySearchByNamespace(registry, query), 'hol.registrySearchByNamespace', { requireApiKey: false }),
  },
  {
    name: 'hol.chat.createSession',
    description: 'Open a chat session linked to a UAID.',
    schema: chatSessionSchema,
    handler: (input: ChatSessionInput) => withBroker((client) => client.chat.createSession(input), 'hol.chat.createSession', { requireApiKey: false }),
  },
  {
    name: 'hol.chat.sendMessage',
    description: 'Send a message to an active chat session.',
    schema: chatMessageSchema,
    handler: (input: ChatMessageInput) => sendChatMessageWithMemory(input, 'hol.chat.sendMessage'),
  },
  {
    name: 'hol.chat.history',
    description: 'Retrieve the message history for a chat session.',
    schema: sessionIdInput,
    handler: ({ sessionId }: z.infer<typeof sessionIdInput>) =>
      withBroker((client) => client.chat.getHistory(sessionId), 'hol.chat.history', { requireApiKey: false }),
  },
  {
    name: 'hol.chat.compact',
    description: 'Compact chat history while preserving the latest entries.',
    schema: chatCompactSchema,
    handler: (input: ChatCompactInput) =>
      withBroker((client) => client.chat.compactHistory(chatCompactSchema.parse(input)), 'hol.chat.compact', { requireApiKey: false }),
  },
  {
    name: 'hol.chat.end',
    description: 'End a chat session and release broker resources.',
    schema: sessionIdInput,
    handler: ({ sessionId }: z.infer<typeof sessionIdInput>) =>
      withBroker((client) => client.chat.endSession(sessionId), 'hol.chat.end', { requireApiKey: false }),
  },
  {
    name: 'hol.chat.ensureEncryptionKey',
    description: 'Ensure an encryption key exists for a UAID (generate if missing).',
    schema: ensureEncryptionKeySchema,
    handler: (input: EnsureKeyInput) =>
      withEncryptedBroker(
        { uaid: input.uaid, ensureEncryptionKey: input },
        (client) => client.encryption.ensureAgentKey(input),
        'hol.chat.ensureEncryptionKey',
      ),
  },
  {
    name: 'hol.chat.startEncryptedConversation',
    description: 'Start an encrypted chat conversation with a target UAID.',
    schema: startConversationSchema,
    handler: (input: StartConversationInput) =>
      withEncryptedBroker(
        { uaid: input.senderUaid, ensureEncryptionKey: resolveEnsureOption(input.senderUaid, input.ensureEncryptionKey), encryption: { autoDecryptHistory: true } },
        async (client) => {
          let derivedSessionId: string | undefined;
          const conversation = await client.chat.startConversation({
            uaid: input.uaid,
            senderUaid: input.senderUaid,
            historyTtlSeconds: input.historyTtlSeconds,
            auth: input.auth,
            encryption: input.encryption ?? { preference: 'required' },
            onSessionCreated: (sessionId) => {
              derivedSessionId = sessionId;
            },
          });
          const sessionId = derivedSessionId ?? conversation.sessionId;
          if (sessionId) {
            cacheConversationHandle(sessionId, input.senderUaid, conversation);
          }
          return conversation;
        },
        'hol.chat.startEncryptedConversation',
      ),
  },
  {
    name: 'hol.chat.acceptEncryptedConversation',
    description: 'Accept an encrypted chat conversation as the responder.',
    schema: acceptConversationSchema,
    handler: (input: AcceptConversationInput) =>
      withEncryptedBroker(
        { uaid: input.responderUaid, ensureEncryptionKey: resolveEnsureOption(input.responderUaid, input.ensureEncryptionKey), encryption: { autoDecryptHistory: true } },
        async (client) => {
          const conversation = await client.chat.acceptConversation({
            sessionId: input.sessionId,
            responderUaid: input.responderUaid,
            encryption: input.encryption ?? { preference: 'required' },
          });
          cacheConversationHandle(conversation.sessionId, input.responderUaid, conversation);
          return conversation;
        },
        'hol.chat.acceptEncryptedConversation',
      ),
  },
  {
    name: 'hol.chat.sendEncrypted',
    description: 'Send an encrypted message in an existing conversation and optionally fetch decrypted history.',
    schema: encryptedSendSchema,
    handler: (input: EncryptedSendInput) =>
      withEncryptedBroker(
        {
          uaid: input.uaid,
          ensureEncryptionKey: resolveEnsureOption(input.uaid, input.ensureEncryptionKey),
          encryption: input.decryptHistory === false ? undefined : { autoDecryptHistory: true },
        },
        async (client) => {
          const cached = getCachedConversationHandle(input.sessionId, input.uaid);
          const conversation =
            cached ??
            (await client.chat.acceptConversation({
              sessionId: input.sessionId,
              responderUaid: input.uaid,
              encryption: { preference: 'required' },
            }));
          cacheConversationHandle(input.sessionId, input.uaid, conversation);
          const response = await conversation.send({
            plaintext: input.plaintext,
            message: input.message,
            streaming: input.streaming,
            auth: input.auth,
          });
          if (input.decryptHistory === false) {
            return response;
          }
          const history = await client.chat.getHistory(input.sessionId, { decrypt: true });
          return { response, history };
        },
        'hol.chat.sendEncrypted',
      ),
  },
  {
    name: 'hol.stats',
    description: 'High-level registry statistics and usage metrics.',
    schema: emptyObject,
    handler: () => withBroker((client) => client.stats(), 'hol.stats', { requireApiKey: false }),
  },
  {
    name: 'hol.metricsSummary',
    description: 'Aggregated broker metrics suitable for dashboards.',
    schema: emptyObject,
    handler: () => withBroker((client) => client.metricsSummary(), 'hol.metricsSummary', { requireApiKey: false }),
  },
  {
    name: 'hol.dashboardStats',
    description: 'Detailed dashboard statistics from the broker.',
    schema: emptyObject,
    handler: () => withBroker((client) => client.dashboardStats(), 'hol.dashboardStats', { requireApiKey: false }),
  },
  {
    name: 'hol.websocketStats',
    description: 'Retrieve websocket connection counts and throughput.',
    schema: emptyObject,
    handler: () => withBroker((client) => client.websocketStats(), 'hol.websocketStats', { requireApiKey: false }),
  },
  {
    name: 'hol.listProtocols',
    description: 'List protocols supported by the current broker.',
    schema: emptyObject,
    handler: () => withBroker((client) => client.listProtocols(), 'hol.listProtocols', { requireApiKey: false }),
  },
  {
    name: 'hol.detectProtocol',
    description: 'Detect which protocol an inbound request/message matches (best-effort).',
    schema: detectProtocolInput,
    handler: (input: z.infer<typeof detectProtocolInput>) =>
      withBroker((client) => client.detectProtocol(input), 'hol.detectProtocol', { requireApiKey: false }),
  },
  {
    name: 'hol.ledger.challenge',
    description: 'Create a ledger challenge message for account verification.',
    schema: ledgerChallengeInput,
    handler: (input: LedgerChallengeInput) =>
      withBroker((client) => client.createLedgerChallenge(input as LedgerChallengeRequest), 'hol.ledger.challenge'),
  },
  {
    name: 'hol.ledger.authenticate',
    description: 'Verify a signed ledger challenge (sets ledger API key).',
    schema: ledgerVerifyInput,
    handler: (input: LedgerVerifyInput) =>
      withBroker((client) => client.verifyLedgerChallenge(input as LedgerVerifyRequest), 'hol.ledger.authenticate'),
  },
  {
    name: 'hol.purchaseCredits.hbar',
    description: 'Purchase registry credits using HBAR funds.',
    schema: purchaseHbarInput,
    handler: (input: PurchaseHbarInput) =>
      withBroker((client) => client.purchaseCreditsWithHbar(input), 'hol.purchaseCredits.hbar'),
  },
  {
    name: 'hol.credits.balance',
    description: 'Fetch credit balances for the current API key and optional Hedera/X402 accounts.',
    schema: creditBalanceInput,
    handler: async (input: CreditBalanceInput) => {
      const hederaAccountId = input.hederaAccountId;
      const [apiKeyBalance, hederaBalance, x402Balance] = await Promise.all([
        getCreditBalance(),
        hederaAccountId ? safeBalanceLookup('hedera', hederaAccountId) : Promise.resolve(null),
        input.x402AccountId ? safeBalanceLookup('x402', input.x402AccountId) : Promise.resolve(null),
      ]);
      return {
        apiKey: apiKeyBalance,
        hedera: hederaBalance,
        x402: x402Balance,
      };
    },
  },
  {
    name: 'hol.x402.minimums',
    description: 'Fetch the minimum credit purchase requirements for X402.',
    schema: emptyObject,
    handler: () => withBroker((client) => client.getX402Minimums(), 'hol.x402.minimums'),
  },
  {
    name: 'hol.x402.buyCredits',
    description: 'Buy registry credits via X402 using an EVM private key.',
    schema: buyX402Input,
    handler: (input: BuyX402Input) => withBroker((client) => client.buyCreditsWithX402(input), 'hol.x402.buyCredits'),
  },
  {
    name: 'hol.memory.context',
    description: 'Fetch recent memory entries and optional summary for a scope.',
    schema: memoryContextSchema,
    handler: async (input: z.infer<typeof memoryContextSchema>) => {
      const service = ensureMemoryEnabled();
      return service.getContext({
        scope: input.scope,
        limit: input.limit,
        includeSummary: input.includeSummary ?? true,
      });
    },
  },
  {
    name: 'hol.memory.note',
    description: 'Save a free-form note into memory for the given scope.',
    schema: memoryNoteSchema,
    handler: async (input: z.infer<typeof memoryNoteSchema>) => {
      const service = ensureMemoryEnabled();
      return service.note(input.scope, input.content);
    },
  },
  {
    name: 'hol.memory.clear',
    description: 'Clear memory entries and summaries for the given scope.',
    schema: memoryClearSchema,
    handler: async (input: z.infer<typeof memoryClearSchema>) => {
      const service = ensureMemoryEnabled();
      const removed = await service.clear(input.scope);
      return { removed };
    },
  },
  {
    name: 'hol.memory.search',
    description: 'Keyword search across stored memory for a scope.',
    schema: memorySearchSchema,
    handler: async (input: z.infer<typeof memorySearchSchema>) => {
      const service = ensureMemoryEnabled();
      return service.search({ scope: input.scope, query: input.query, limit: input.limit });
    },
  },
  {
    name: 'workflow.discovery',
    description: 'Pipeline: hol.search + hol.vectorSearch',
    schema: workflowDiscoveryInput,
    handler: async (input: z.infer<typeof workflowDiscoveryInput>) =>
      formatPipelineResult(await discoveryPipeline.run(input)),
  },
  {
    name: 'workflow.registerMcp',
    description: 'Pipeline: get quote, register agent, wait for completion',
    schema: workflowRegistrationInput,
    handler: async ({ payload }: z.infer<typeof workflowRegistrationInput>) =>
      formatPipelineResult(await registrationPipeline.run({ payload })),
  },
  {
    name: 'workflow.chatSmoke',
    description: 'Pipeline: chat session smoke test for UAID',
    schema: workflowChatInput,
    handler: async (input: z.infer<typeof workflowChatInput>) =>
      formatPipelineResult(await chatPipeline.run(input)),
  },
  {
    name: 'workflow.encryptedChat',
    description: 'Pipeline: encrypted chat handshake + bidirectional message exchange between two UAIDs.',
    schema: workflowEncryptedChatInput,
    handler: async (input: z.infer<typeof workflowEncryptedChatInput>) =>
      formatPipelineResult(await encryptedChatWorkflow.run(input)),
  },
  {
    name: 'workflow.opsCheck',
    description: 'Pipeline: stats, metrics, dashboard, protocols',
    schema: workflowOpsInput,
    handler: async () => formatPipelineResult(await opsPipeline.run({})),
  },
  {
    name: 'workflow.openrouterChat',
    description: 'Pipeline: discover OpenRouter model and run a chat message',
    schema: openRouterChatToolSchema,
    handler: async (input: z.infer<typeof openRouterChatToolSchema>) =>
      formatPipelineResult(await openRouterChatWorkflow.run(input)),
  },
  {
    name: 'workflow.registryBrokerShowcase',
    description: 'Pipeline: discovery, analytics, UAID validation, chat',
    schema: registryShowcaseToolSchema,
    handler: async (input: z.infer<typeof registryShowcaseToolSchema>) =>
      formatPipelineResult(await registryBrokerShowcaseWorkflow.run(input)),
  },
  {
    name: 'workflow.agentverseBridge',
    description: 'Pipeline: relay chat between local UAID and Agentverse UAID',
    schema: bridgePayloadSchema,
    handler: async (input: BridgePayload) =>
      formatPipelineResult(await agentverseBridgeWorkflow.run(input)),
  },
  {
    name: 'workflow.erc8004Discovery',
    description: 'Pipeline: search ERC-8004 registries',
    schema: erc8004DiscoveryToolSchema,
    handler: async (input: z.infer<typeof erc8004DiscoveryToolSchema>) =>
      formatPipelineResult(await erc8004DiscoveryWorkflow.run(input)),
  },
  {
    name: 'workflow.erc8004X402',
    description: 'Pipeline: ERC-8004 registration funded via X402 credits',
    schema: erc8004X402ToolSchema,
    handler: async (input: Erc8004X402Input) => formatPipelineResult(await erc8004X402Workflow.run(input)),
  },
  {
    name: 'workflow.x402Registration',
    description: 'Pipeline: register agent using X402 payments + chat smoke test',
    schema: x402RegistrationToolSchema,
    handler: async (input: X402RegistrationInput) => formatPipelineResult(await x402RegistrationWorkflow.run(input)),
  },
  {
    name: 'workflow.fullRegistration',
    description: 'Pipeline: discovery → register → chat → ops',
    schema: workflowFullInput,
    handler: async (input: FullWorkflowInput) => formatPipelineResult(await fullWorkflowPipeline.run(input)),
  },
  {
    name: 'workflow.delegate',
    description: 'Pipeline: discover → pick top candidate → message immediately (unless uaid is provided).',
    schema: workflowDelegateInput,
    handler: async (input: DelegateWorkflowInput) => {
      const query = input.query ?? input.task;
      const delegationType = input.type ?? inferDelegationType(`${input.task}\n${query}`);

      if (input.uaid) {
        const response = await sendChatMessageWithMemory(
          {
            uaid: input.uaid,
            message: input.message ?? input.task,
            streaming: input.streaming,
          },
          'workflow.delegate hol.chat.sendMessage',
        );

        return {
          content: [
            { type: 'text', text: `Delegation enlisted (uaid: ${input.uaid})` },
            buildObjectContent('workflow.delegate', {
              task: input.task,
              query,
              uaid: input.uaid,
              response,
            }),
          ],
        };
      }

      const [agenticSearch, vectorSearch, keywordSearch] = await Promise.all([
        safeToolCall('hol.agenticSearch', () =>
          requestBrokerJson('/search/agentic', {
            method: 'POST',
            body: {
              query,
              limit: Math.min(20, Math.max(input.limit * 4, input.limit)),
              offset: 0,
              filter: normalizeAgenticFilter({
                registry: input.registries?.length === 1 ? input.registries[0] : undefined,
                protocols: input.protocols,
                adapter: input.adapters,
                capabilities: input.capabilities,
                type: delegationType,
              }),
            },
            headers: { 'content-type': 'application/json' },
            requireApiKey: false,
          }),
        ),
        safeToolCall('hol.vectorSearch', () =>
          withBroker((client) => client.vectorSearch({ query, limit: input.limit }), 'workflow.delegate hol.vectorSearch', { requireApiKey: false }),
        ),
        safeToolCall('hol.search', () =>
          withBroker(
            (client) =>
              client.search({
                q: query,
                limit: Math.min(50, input.limit * 4),
                ...omitUndefined({
                  registries: input.registries,
                  capabilities: input.capabilities,
                  protocols: input.protocols,
                  adapters: input.adapters,
                  minTrust: input.minTrust,
                  verified: input.verified,
                  online: input.online,
                  type: delegationType,
                }),
              }),
            'workflow.delegate hol.search',
            { requireApiKey: false },
          ),
        ),
      ]);

      const candidates = pickDelegateCandidates(
        [agenticSearch.value, vectorSearch.value, keywordSearch.value],
        {
          limit: input.limit,
          minTrust: input.minTrust,
          verified: input.verified,
          online: input.online,
          registries: input.registries,
        },
      );

      if (!candidates.length) {
        return {
          content: [
            { type: 'text', text: `No delegation candidates found for ${JSON.stringify(query)}.` },
            buildObjectContent('workflow.delegate', {
              task: input.task,
              query,
              candidates: [],
              sources: {
                agenticSearch: agenticSearch.error ? { error: agenticSearch.error } : agenticSearch.value,
                vectorSearch: vectorSearch.error ? { error: vectorSearch.error } : vectorSearch.value,
                keywordSearch: keywordSearch.error ? { error: keywordSearch.error } : keywordSearch.value,
              },
            }),
          ],
        };
      }

      const enlisted: Array<{
        uaid: string;
        label: string;
        message: string;
        response: unknown;
        status: 'ok' | 'error';
      }> = [];
      let authBlocked = false;

      for (const candidate of candidates) {
        const message = input.message ?? buildDelegateMessage(input.task, candidate);
        const response = await safeToolCall('hol.chat.sendMessage', () =>
          sendChatMessageWithMemory(
            {
              uaid: candidate.uaid,
              message,
              streaming: input.streaming,
            },
            'workflow.delegate hol.chat.sendMessage',
          ),
        );

        enlisted.push({
          uaid: candidate.uaid,
          label: candidate.label,
          message,
          response: response.error ? { error: response.error } : response.value,
          status: response.error ? 'error' : 'ok',
        });

        if (response.error && isBrokerAuthError(response.error)) {
          authBlocked = true;
          break;
        }
      }

      const successCount = enlisted.filter((entry) => entry.status === 'ok').length;
      const summary = [
        `Delegation attempted (query: ${JSON.stringify(query)})`,
        `Messages sent: ${enlisted.length}, succeeded: ${successCount}, failed: ${enlisted.length - successCount}`,
        authBlocked
          ? 'Auth required: set REGISTRY_BROKER_API_KEY (or use hol.ledger.challenge + hol.ledger.authenticate) then retry workflow.delegate.'
          : undefined,
        ...enlisted.map((entry, idx) => `${idx + 1}. ${entry.label} — ${entry.uaid} (${entry.status})`),
      ].filter(Boolean).join('\n');

      return {
        content: [
          { type: 'text', text: summary },
          buildObjectContent('workflow.delegate', {
            task: input.task,
            query,
            candidates,
            enlisted,
            sources: {
              agenticSearch: agenticSearch.error ? { error: agenticSearch.error } : agenticSearch.value,
              vectorSearch: vectorSearch.error ? { error: vectorSearch.error } : vectorSearch.value,
              keywordSearch: keywordSearch.error ? { error: keywordSearch.error } : keywordSearch.value,
            },
          }),
        ],
      };
    },
  },
];

export const toolDefinitions: ToolDefinition[] = rawToolDefinitions as unknown as ToolDefinition[];

type SafeToolCallResult<T> = {
  value: T | null;
  error?: string;
};

async function safeToolCall<T>(label: string, fn: () => Promise<T>): Promise<SafeToolCallResult<T>> {
  try {
    return { value: await fn() };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { value: null, error: `${label} failed: ${message}` };
  }
}

async function sendChatMessageWithMemory(
  input: {
    sessionId?: string;
    uaid?: string;
    message: string;
    auth?: AgentAuthConfig;
    streaming?: boolean;
  },
  label: string,
) {
  return withBroker(async (client) => {
    const { sessionId, uaid, message, auth, streaming } = input;
    const scopeForMemory: MemoryScope = { sessionId: sessionId ?? undefined, uaid: uaid ?? undefined };

    if (sessionId) {
      const payload: ChatSendMessagePayload = { sessionId, message, auth, streaming };
      await recordMemory(scopeForMemory, 'user', message, label);
      const response = await client.chat.sendMessage(payload);
      const nextSessionId = isPlainObject(response) ? readString(response.sessionId) : undefined;
      if (nextSessionId) {
        scopeForMemory.sessionId = nextSessionId;
      }
      await recordMemory(scopeForMemory, 'assistant', stringifyForMemory(response), label);
      return response;
    }

    if (!uaid) {
      throw new Error('sessionId missing; provide uaid so a session can be created before sending.');
    }

    const session = await client.chat.createSession({ uaid, auth });
    const derivedSessionId = session.sessionId;
    if (!derivedSessionId) {
      throw new Error('Unable to determine sessionId from broker response when auto-creating chat session.');
    }

    scopeForMemory.sessionId = derivedSessionId;

    const payload: ChatSendMessagePayload = {
      sessionId: derivedSessionId,
      message,
      auth,
      streaming,
    };

    await recordMemory(scopeForMemory, 'user', message, label);
    const response = await client.chat.sendMessage(payload);
    await recordMemory(scopeForMemory, 'assistant', stringifyForMemory(response), label);
    return response;
  }, label, { requireApiKey: false });
}

type DelegateCandidate = {
  uaid: string;
  label: string;
  registry?: string;
  endpoint?: string;
  protocol?: string;
  trustScore?: number;
  verified?: boolean;
  avgLatency?: number;
  available?: boolean;
  score?: number;
  communicationSupported?: boolean;
};

type DelegateCandidateFilters = {
  limit: number;
  minTrust?: number;
  verified?: boolean;
  online?: boolean;
  registries?: string[];
};

function pickDelegateCandidates(results: unknown[], filters: DelegateCandidateFilters): DelegateCandidate[] {
  const seen = new Set<string>();
  const pool: Array<DelegateCandidate & { sourceIndex: number; position: number }> = [];

  results.forEach((result, sourceIndex) => {
    const extracted = extractDelegateCandidates(result);
    extracted.forEach((candidate, position) => {
      if (seen.has(candidate.uaid)) return;
      if (!candidatePassesFilters(candidate, filters)) return;
      seen.add(candidate.uaid);
      pool.push({ ...candidate, sourceIndex, position });
    });
  });

  pool.sort((a, b) => {
    const scoreDiff = scoreDelegateCandidate(b) - scoreDelegateCandidate(a);
    if (scoreDiff !== 0) return scoreDiff;
    const trustDiff = (b.trustScore ?? -1) - (a.trustScore ?? -1);
    if (trustDiff !== 0) return trustDiff;
    const verifiedDiff = Number(Boolean(b.verified)) - Number(Boolean(a.verified));
    if (verifiedDiff !== 0) return verifiedDiff;
    const availabilityDiff = Number(Boolean(b.available)) - Number(Boolean(a.available));
    if (availabilityDiff !== 0) return availabilityDiff;
    const sourceDiff = a.sourceIndex - b.sourceIndex;
    if (sourceDiff !== 0) return sourceDiff;
    return a.position - b.position;
  });

  return pool.slice(0, filters.limit).map(({ sourceIndex: _sourceIndex, position: _position, ...candidate }) => candidate);
}

function extractDelegateCandidates(result: unknown): DelegateCandidate[] {
  if (!isPlainObject(result)) return [];
  const hitsValue = result.hits;
  if (!Array.isArray(hitsValue)) return [];
  const candidates: DelegateCandidate[] = [];
  for (const hit of hitsValue) {
    if (!isPlainObject(hit)) continue;
    const agent = isPlainObject(hit.agent) ? hit.agent : hit;
    const uaid = readString(agent.uaid) ?? readString(agent.id) ?? readString(hit.uaid);
    if (!uaid) continue;
    const registry = readString(agent.registry) ?? readString(hit.registry);
    const endpoint = readString(hit.endpoint) ?? readAgentEndpoint(agent);
    const protocol = readString(hit.protocol) ?? readAgentProtocol(agent);
    const trustScore = readNumber(hit.trustScore) ?? readAgentTrustScore(agent);
    const verified = readBoolean(hit.verified) ?? readAgentVerified(agent);
    const avgLatency = readNumber(hit.avgLatency) ?? readNumber(agent.avgLatency);
    const score = readNumber(hit.score);
    const available = readBoolean(hit.online) ?? readAgentAvailable(agent);
    const communicationSupported = readBoolean(agent.communicationSupported);

    const profile = isPlainObject(agent.profile) ? agent.profile : isPlainObject(hit.profile) ? hit.profile : undefined;
    const displayName = profile ? readString(profile.display_name) : undefined;
    const alias = profile ? readString(profile.alias) : undefined;
    const label = displayName ?? alias ?? registry ?? 'agent';

    candidates.push({
      uaid,
      label,
      registry,
      endpoint,
      protocol,
      trustScore,
      verified,
      avgLatency,
      available,
      score,
      communicationSupported,
    });
  }
  return candidates;
}

function buildDelegateMessage(task: string, candidate: DelegateCandidate): string {
  const header = candidate.label && candidate.label !== 'agent' ? `${candidate.label} (${candidate.uaid})` : candidate.uaid;
  return [
    `Hi ${header},`,
    '',
    'Can you help with this focused subtask?',
    '',
    task,
    '',
    'Please respond with: (1) approach, (2) key pitfalls/edge cases, (3) any concrete steps or snippets.',
  ].join('\n');
}

function inferDelegationType(text: string): 'ai-agents' | 'mcp-servers' {
  const normalized = text.toLowerCase();
  const mentionsMcp = normalized.includes('mcp');
  const mentionsServer = normalized.includes('server') || normalized.includes('stdio') || normalized.includes('sse');
  if (mentionsMcp && mentionsServer) {
    return 'mcp-servers';
  }
  return 'ai-agents';
}

function isBrokerAuthError(message: string): boolean {
  return (
    /\b401\b/.test(message) ||
    /\b403\b/.test(message) ||
    /\bauthorization required\b/i.test(message) ||
    /\bREGISTRY_BROKER_API_KEY\b/i.test(message)
  );
}

function scoreDelegateCandidate(candidate: DelegateCandidate): number {
  const trustScore = typeof candidate.trustScore === 'number' ? candidate.trustScore : 0;
  const verifiedBonus = candidate.verified ? 30 : 0;
  const availabilityBonus = candidate.available === true ? 50 : candidate.available === false ? -10 : 0;
  const communicationBonus =
    candidate.communicationSupported === true ? 200 : candidate.communicationSupported === false ? -200 : 0;
  const agenticScoreBonus =
    typeof candidate.score === 'number' && Number.isFinite(candidate.score) ? Math.min(100, candidate.score * 1000) : 0;

  const protocol = candidate.protocol?.toLowerCase();
  const protocolBonus =
    protocol === 'xmtp' || protocol === 'a2a' || protocol === 'mcp'
      ? 50
      : protocol === 'rest' || protocol === 'http'
        ? -100
        : 0;

  return trustScore + verifiedBonus + availabilityBonus + communicationBonus + agenticScoreBonus + protocolBonus;
}

function readString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : undefined;
}

function readNumber(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return value;
}

function readBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function readAgentEndpoint(agent: Record<string, unknown>): string | undefined {
  const direct = readString(agent.endpoint);
  if (direct) return direct;

  const endpoints = agent.endpoints;
  if (Array.isArray(endpoints)) {
    for (const entry of endpoints) {
      if (!isPlainObject(entry)) continue;
      const endpoint = readString(entry.endpoint) ?? readString(entry.url);
      if (endpoint) return endpoint;
    }
  }

  const profile = isPlainObject(agent.profile) ? agent.profile : undefined;
  const mcpServer = profile && isPlainObject(profile.mcpServer) ? profile.mcpServer : undefined;
  const connectionInfo = mcpServer && isPlainObject(mcpServer.connectionInfo) ? mcpServer.connectionInfo : undefined;
  const url = connectionInfo ? readString(connectionInfo.url) : undefined;
  return url;
}

function readAgentProtocol(agent: Record<string, unknown>): string | undefined {
  const direct = readString(agent.protocol);
  if (direct) return direct;
  const metadata = isPlainObject(agent.metadata) ? agent.metadata : undefined;
  return metadata ? readString(metadata.protocol) : undefined;
}

function readAgentTrustScore(agent: Record<string, unknown>): number | undefined {
  const direct = readNumber(agent.trustScore);
  if (direct !== undefined) return direct;
  const trustScores = isPlainObject(agent.trustScores) ? agent.trustScores : undefined;
  const total = trustScores ? readNumber(trustScores.total) : undefined;
  return total;
}

function readAgentVerified(agent: Record<string, unknown>): boolean | undefined {
  const direct = readBoolean(agent.verified);
  if (direct !== undefined) return direct;
  const metadata = isPlainObject(agent.metadata) ? agent.metadata : undefined;
  return metadata ? readBoolean(metadata.verified) : undefined;
}

function readAgentAvailable(agent: Record<string, unknown>): boolean | undefined {
  const direct = readBoolean(agent.available);
  if (direct !== undefined) return direct;
  const metadata = isPlainObject(agent.metadata) ? agent.metadata : undefined;
  return metadata ? readBoolean(metadata.available) : undefined;
}

function candidatePassesFilters(candidate: DelegateCandidate, filters: DelegateCandidateFilters): boolean {
  if (filters.registries?.length) {
    const registry = candidate.registry;
    if (!registry || !filters.registries.includes(registry)) {
      return false;
    }
  }

  if (typeof filters.minTrust === 'number') {
    if (typeof candidate.trustScore !== 'number' || candidate.trustScore < filters.minTrust) {
      return false;
    }
  }

  if (filters.verified === true) {
    if (candidate.verified !== true) {
      return false;
    }
  }

  if (filters.online === true) {
    if (candidate.available !== true) {
      return false;
    }
  }

  return true;
}

function normalizeAgenticFilter(input: AgenticSearchInput['filter']): Record<string, unknown> | undefined {
  if (!input) return undefined;
  const record: Record<string, unknown> = {};

  const registry = input.registry ?? (Array.isArray(input.registries) ? input.registries[0] : undefined);
  if (registry) {
    record.registry = registry;
  }
  if (Array.isArray(input.protocols) && input.protocols.length) {
    record.protocols = input.protocols;
  }
  const adapter = Array.isArray(input.adapter) && input.adapter.length ? input.adapter : Array.isArray(input.adapters) ? input.adapters : undefined;
  if (Array.isArray(adapter) && adapter.length) {
    record.adapter = adapter;
  }
  if (Array.isArray(input.capabilities) && input.capabilities.length) {
    record.capabilities = input.capabilities;
  }
  if (input.type) {
    record.type = input.type;
  }

  return Object.keys(record).length ? record : undefined;
}

function omitUndefined(value: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry !== undefined) {
      result[key] = entry;
    }
  }
  return result;
}

function ensureMemoryEnabled() {
  if (!memoryService || !memoryService.isEnabled()) {
    throw new Error('Memory is disabled or unavailable. Set MEMORY_ENABLED=1 and ensure the configured backend is installed.');
  }
  return memoryService;
}

function formatPipelineResult(result: PipelineRunResult<unknown>) {
  const contextRecord =
    result.context && typeof result.context === 'object' ? (result.context as Record<string, unknown>) : {};
  const contextUaid = typeof contextRecord.uaid === 'string' ? (contextRecord.uaid as string) : undefined;
  const summaryLines = [
    `Workflow: ${result.pipeline}`,
    result.dryRun ? '(dry-run)' : undefined,
    contextUaid ? `UAID: ${contextUaid}` : undefined,
    `Steps executed: ${result.steps.length}`,
  ].filter(Boolean) as string[];

  return {
    content: [
      { type: 'text', text: summaryLines.join('\n') },
      buildObjectContent('pipeline.result', result as unknown as Record<string, unknown>),
    ],
  };
}

export function buildLoggedTool<S extends z.ZodTypeAny>(definition: ToolDefinition<S>) {
  return {
    name: definition.name,
    description: definition.description,
    parameters: definition.schema,
    execute: async (args: z.input<S>, context?: Context<SessionAuth>) => {
      const requestId = context?.requestId ?? randomUUID();
      const started = Date.now();
      try {
        const parsedInput = definition.schema.parse(args);
        logger.debug({ requestId, tool: definition.name }, 'tool.invoke');
        const result = await definition.handler(parsedInput as z.infer<S>);
        if (memoryService && memoryService.isEnabled()) {
          const scopeForMemory = deriveScopeFromArgs(parsedInput);
          if (hasScope(scopeForMemory)) {
            void memoryService
              .recordToolEvent(definition.name, scopeForMemory, { input: parsedInput, result })
              .catch((error) => logger.warn({ requestId, tool: definition.name, error }, 'memory.capture.failed'));
          }
        }
        logger.info(
          {
            requestId,
            tool: definition.name,
            durationMs: Date.now() - started,
          },
          'tool.success',
        );
        return normalizeResult(result);
      } catch (error) {
        logger.error(
          {
            requestId,
            tool: definition.name,
            durationMs: Date.now() - started,
            error: error instanceof Error ? error.message : String(error),
          },
          'tool.failure',
        );
        throw error;
      }
    },
  };
}

for (const definition of toolDefinitions) {
  mcp.addTool(buildLoggedTool(definition));
}

export const registeredTools = toolDefinitions;

function isContentValue(value: unknown): value is Content {
  return Boolean(
    value &&
    typeof value === 'object' &&
    'type' in (value as Record<string, unknown>) &&
    typeof (value as Record<string, unknown>).type === 'string',
  );
}

function normalizeResult(value: unknown): { content: Content[]; structuredContent?: Record<string, unknown>; isError?: boolean } {
  if (isResultShape(value)) {
    const record = value as Record<string, unknown>;
    return {
      content: normalizeContent(record.content),
      isError: typeof record.isError === 'boolean' ? (record.isError as boolean) : undefined,
    };
  }
  if (isPlainObject(value)) {
    return {
      content: [buildObjectContent('tool.result', value as Record<string, unknown>)],
    };
  }
  return { content: normalizeContent(value) };
}

function normalizeContent(result: unknown): Content[] {
  if (Array.isArray(result) && result.every(isContentValue)) {
    return result;
  }
  if (isContentValue(result)) {
    return [result];
  }
  if (result === undefined || result === null) {
    return [{ type: 'text', text: 'ok' }];
  }
  if (typeof result === 'string' || typeof result === 'number' || typeof result === 'boolean') {
    return [{ type: 'text', text: String(result) }];
  }
  if (isPlainObject(result)) {
    return [buildObjectContent('tool.result', result as Record<string, unknown>)];
  }
  return [{ type: 'text', text: JSON.stringify(result) }];
}

function buildObjectContent(name: string, value: Record<string, unknown>): Content {
  return {
    type: 'text',
    text: `${name}:\n${JSON.stringify(value, null, 2)}`,
  };
}

function isResultShape(value: unknown): value is { content?: unknown; structuredContent?: unknown; isError?: boolean } {
  return Boolean(value && typeof value === 'object' && ('content' in (value as Record<string, unknown>) || 'structuredContent' in (value as Record<string, unknown>)));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

async function runBrokerCall<T>(label: string, fn: () => Promise<T>) {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof RegistryBrokerError) {
      const body = typeof error.body === 'object' ? JSON.stringify(error.body) : String(error.body);
      throw new Error(`${label} failed (${error.status} ${error.statusText ?? ''}): ${body}`);
    }
    throw error;
  }
}

async function safeBalanceLookup(label: 'hedera' | 'x402', accountId: string) {
  try {
    return await getCreditBalance(accountId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { error: `${label} balance unavailable: ${message}`, accountId };
  }
}

function deriveScopeFromArgs(args: unknown): MemoryScope {
  if (!args || typeof args !== 'object') return {};
  const record = args as Record<string, unknown>;
  const scope: MemoryScope = {};
  // We keep this loose: whichever identifiers the tool provides, we pass along for scoping.
  if (typeof record.sessionId === 'string') scope.sessionId = record.sessionId;
  if (typeof record.uaid === 'string') scope.uaid = record.uaid;
  if (typeof record.namespace === 'string') scope.namespace = record.namespace;
  if (typeof record.userId === 'string') scope.userId = record.userId;
  return scope;
}

function hasScope(scope: MemoryScope) {
  return Boolean(scope.sessionId || scope.uaid || scope.namespace || scope.userId);
}

function stringifyForMemory(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === undefined || value === null) return '';
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

async function recordMemory(scope: MemoryScope, role: 'user' | 'assistant' | 'note' | 'tool', content: string, toolName: string) {
  if (!memoryService || !memoryService.isEnabled()) return;
  try {
    await memoryService.recordEntry({ scope, role, content, toolName });
  } catch (error) {
    // Do not fail tool execution if memory capture fails.
    logger.warn({ scope, toolName, error }, 'memory.record.failed');
  }
}

mcp.addResource({
  name: 'hol.search.help',
  uri: 'help://rb/search',
  mimeType: 'text/markdown',
  load: async () => [
    {
      text: [
        '# hol.search',
        '',
        'Discover registered agents or MCP servers.',
        '',
        '- `q` / `query`: keyword search',
        '- `capabilities`: filter by declared skills',
        '- `protocols`: filter by supported protocols',
        '- `registry` / `registries`: limit to a specific registry (or list)',
        '- `metadata`: pass `{ \"region\": [\"na\"] }` style filters',
        '- `type`: limit results to `ai-agents` or `mcp-servers`',
        '- `sortBy`: broker-defined sort key (example: `trust-score`)',
        '',
        'Related: `hol.agenticSearch` offers a hybrid semantic+lexical search endpoint when supported by the broker.',
      ].join('\n'),
    },
  ],
});

mcp.addResource({
  name: 'hol.tools.guide',
  uri: 'help://hol/usage',
  mimeType: 'text/markdown',
  load: async () => [
    {
      text: [
        '# Hashnet MCP quick usage',
        '',
        'Prefer workflow.* pipelines when available—they run multiple broker calls and return both a text summary and structured results:',
        '- Delegation (default): workflow.delegate { task } (auto-discover + message).',
        '- Delegation (pick-first): hol.delegate.suggest { task } → hol.chat.sendMessage { uaid, message }.',
        '- Discovery: workflow.discovery { query?, limit? } (or hol.search / hol.vectorSearch / hol.agenticSearch).',
        '- Registration: workflow.registerMcp { payload } (quote → register → wait) or workflow.fullRegistration to add discovery/chat/ops.',
        '- Chat: hol.chat.createSession { uaid, auth?, historyTtlSeconds? } → hol.chat.sendMessage { sessionId OR uaid, message, auth?, streaming? } → hol.chat.history/compact/end.',
        '- UAID validation/resets: hol.resolveUaid { uaid }, hol.closeUaidConnection { uaid }.',
        '- Ops/metrics: workflow.opsCheck or hol.stats / hol.metricsSummary / hol.dashboardStats.',
        '- Credits: hol.credits.balance first, then hol.purchaseCredits.hbar or hol.x402.buyCredits (X402 requires evmPrivateKey; call hol.x402.minimums to inspect limits).',
        '- Protocols: hol.listProtocols and hol.detectProtocol when inspecting inbound requests.',
        '',
        'Read-only broker endpoints (search/stats/protocols) often work without an API key. For write operations (registration/chat/credits), set REGISTRY_BROKER_API_KEY.',
        '',
        'Ask the user for any missing UAID, registration payload fields, accountId, or auth tokens before calling tools. Keep sessionId/uaid strings verbatim.',
      ].join('\n'),
    },
  ],
});

mcp.addResource({
  name: 'hol.delegation.guide',
  uri: 'help://hol/delegation',
  mimeType: 'text/markdown',
  load: async () => [
    {
      text: [
        '# Delegation (best practice)',
        '',
        'When you need help on a narrow subtask, prefer delegating it to a specialized agent from the registry:',
        '',
        '- One-shot (default): `workflow.delegate { task }` discovers a top candidate and messages them immediately.',
        '  - If chat is protected on this broker, set `REGISTRY_BROKER_API_KEY` or authenticate with the ledger first.',
        '- Pick-first: `hol.delegate.suggest { task }` to get a shortlist + message templates, then `hol.chat.sendMessage { uaid, message }`.',
        '',
        'Tips: ask for a concrete deliverable (plan, edge cases, code snippets, commands). Keep the scope focused and time-boxed.',
      ].join('\n'),
    },
  ],
});

mcp.addResource({
  name: 'hol.memory.guide',
  uri: 'help://hol/memory',
  mimeType: 'text/markdown',
  load: async () => [
    {
      text: [
        '# Memory tools',
        '',
        'Memory is optional and disabled by default. Enable with `MEMORY_ENABLED=1` (defaults to SQLite at `MEMORY_STORAGE_PATH`).',
        '',
        '- `hol.memory.context { scope, limit?, includeSummary? }`: recent entries plus optional summary for a UAID/session/namespace.',
        '- `hol.memory.note { scope, content }`: store a note in the scope.',
        '- `hol.memory.search { scope, query, limit? }`: keyword search within scoped memory.',
        '- `hol.memory.clear { scope }`: drop entries + summary for the scope.',
        '',
        'Scopes: supply at least one of `uaid`, `sessionId`, `namespace`, or `userId`. The service bounds responses to avoid overwhelming clients.',
      ].join('\n'),
    },
  ],
});
