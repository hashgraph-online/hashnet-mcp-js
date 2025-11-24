import { randomUUID } from 'node:crypto';
import { AgentAuthConfig, LedgerChallengeRequest, LedgerVerifyRequest, RegistryBrokerClient, RegistryBrokerError } from '@hashgraphonline/standards-sdk';
import { FastMCP } from 'fastmcp';
import type { Context, Content } from 'fastmcp';
import { z } from 'zod';
import { getCreditBalance, withBroker } from './broker';
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
import type { PipelineRunResult } from './workflows/types';
import { memoryService } from './memory';
import type { MemoryScope } from './memory';

type AgentRegistrationRequest = Parameters<RegistryBrokerClient['registerAgent']>[0];
type ChatCreateSessionPayload = Parameters<RegistryBrokerClient['chat']['createSession']>[0];
type ChatSendMessagePayload = Parameters<RegistryBrokerClient['chat']['sendMessage']>[0];
type ChatCompactPayload = Parameters<RegistryBrokerClient['chat']['compactHistory']>[0];
type UpdateAgentPayload = Parameters<RegistryBrokerClient['updateAgent']>[1];
type RegistrySearchNamespaceArgs = Parameters<RegistryBrokerClient['registrySearchByNamespace']>;
type PurchaseHbarPayload = Parameters<RegistryBrokerClient['purchaseCreditsWithHbar']>[0];
type BuyX402Payload = Parameters<RegistryBrokerClient['buyCreditsWithX402']>[0];

const connectionInstructions = [
  'You expose the Hashgraph Online Registry Broker via hol.* primitives and workflow.* pipelines. Prefer workflow.* when possible—they bundle common steps and return a pipeline summary plus full results.',
  'Discovery: use workflow.discovery (or hol.search / hol.vectorSearch) to find UAIDs/agents/MCP servers; pass q/query and optional filters like capabilities, metadata, or type=ai-agents|mcp-servers.',
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

const chatMessageSchema: z.ZodType<ChatSendMessagePayload> = z
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
  }) as z.ZodType<ChatSendMessagePayload>;

const chatCompactSchema: z.ZodType<ChatCompactPayload> = z.object({
  sessionId: z.string().min(1),
  preserveEntries: z.number().int().min(0).default(4),
  auth: agentAuthSchema.optional(),
}) as z.ZodType<ChatCompactPayload>;

const searchInput = z.object({
  q: z.string().optional(),
  limit: z.number().int().min(1).max(50).default(10),
  capabilities: z.array(z.string()).optional(),
  registries: z.array(z.string()).optional(),
  minTrust: z.number().int().min(0).max(100).optional(),
  verified: z.boolean().optional(),
  online: z.boolean().optional(),
  sortBy: z.enum(['trust', 'latency', 'most-recent']).optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
  metadata: z.record(z.string(), z.array(z.string())).optional(),
  type: z.enum(['ai-agents', 'mcp-servers']).optional(),
});

const vectorSearchInput = z.object({
  query: z.string().min(1),
  limit: z.number().int().min(1).max(20).default(5),
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

const workflowOpsInput = z.object({});

const workflowFullInput = z.object({
  registrationPayload: agentRegistrationSchema,
  discoveryQuery: z.string().optional(),
  chatMessage: z.string().optional(),
  disableMemory: z.boolean().optional(),
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
type UaidInput = z.infer<typeof uaidInput>;
type SessionAuth = Record<string, unknown> | undefined;
type RegistrationInput = z.infer<typeof registrationPayload>;
type WaitForRegistrationInput = z.infer<typeof waitForRegistrationInput>;
type UpdateAgentInput = z.infer<typeof updateAgentInput>;
type RegistryNamespaceInput = z.infer<typeof registryNamespaceInput>;
type ChatSessionInput = z.infer<typeof chatSessionSchema>;
type ChatMessageInput = z.infer<typeof chatMessageSchema>;
type ChatCompactInput = z.infer<typeof chatCompactSchema>;
type CreditBalanceInput = z.infer<typeof creditBalanceInput>;
type LedgerChallengeInput = z.infer<typeof ledgerChallengeInput>;
type LedgerVerifyInput = z.infer<typeof ledgerVerifyInput>;
type PurchaseHbarInput = z.infer<typeof purchaseHbarInput>;
type BuyX402Input = z.infer<typeof buyX402Input>;
type BridgePayload = z.infer<typeof bridgePayloadSchema>;
type Erc8004X402Input = z.infer<typeof erc8004X402ToolSchema>;
type X402RegistrationInput = z.infer<typeof x402RegistrationToolSchema>;
type FullWorkflowInput = z.infer<typeof workflowFullInput>;
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
  metadata: z.record(z.string(), z.any()).optional(),
}) as z.ZodType<PurchaseHbarPayload>;

const buyX402Input: z.ZodType<BuyX402Payload> = z.object({
  accountId: z.string().min(1),
  credits: z.number().positive(),
  usdAmount: z.number().positive().optional(),
  description: z.string().optional(),
  metadata: z.record(z.string(), z.any()).optional(),
  evmPrivateKey: z.string().min(1),
  network: z.enum(['base', 'base-sepolia']).optional(),
  rpcUrl: z.string().url().optional(),
}) as z.ZodType<BuyX402Payload>;

export const mcp = new FastMCP({
  name: 'hashgraph-standards',
  version: '1.0.0',
  instructions: connectionInstructions,
  // Route FastMCP logging to our pino logger (stderr) to keep stdio transport clean.
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
    handler: (input: SearchInput) => withBroker((client) => client.search(input), 'hol.search'),
  },
  {
    name: 'hol.vectorSearch',
    description: 'Vector similarity search across registered agents.',
    schema: vectorSearchInput,
    handler: (input: VectorSearchInput) => withBroker((client) => client.vectorSearch(input), 'hol.vectorSearch'),
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
      }, 'hol.resolveUaid'),
  },
  {
    name: 'hol.closeUaidConnection',
    description: 'Force-close any open UAID connection.',
    schema: uaidInput,
    handler: ({ uaid }: UaidInput) => withBroker((client) => client.closeUaidConnection(uaid), 'hol.closeUaidConnection'),
  },
  {
    name: 'hol.getRegistrationQuote',
    description: 'Estimate fees for a given agent registration payload.',
    schema: registrationPayload,
    handler: ({ payload }: RegistrationInput) => withBroker((client) => client.getRegistrationQuote(payload), 'hol.getRegistrationQuote'),
  },
  {
    name: 'hol.registerAgent',
    description: 'Submit an HCS-11-compatible agent registration.',
    schema: registrationPayload,
    handler: ({ payload }: RegistrationInput) => withBroker((client) => client.registerAgent(payload), 'hol.registerAgent'),
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
      ),
  },
  {
    name: 'hol.updateAgent',
    description: 'Update an existing agent registration payload.',
    schema: updateAgentInput,
    handler: ({ uaid, payload }: UpdateAgentInput) =>
      withBroker((client) => client.updateAgent(uaid, payload as UpdateAgentPayload), 'hol.updateAgent'),
  },
  {
    name: 'hol.additionalRegistries',
    description: 'Retrieve the catalog of additional registries and networks.',
    schema: emptyObject,
    handler: () => withBroker((client) => client.getAdditionalRegistries(), 'hol.additionalRegistries'),
  },
  {
    name: 'hol.registrySearchByNamespace',
    description: 'Search within a specific registry namespace.',
    schema: registryNamespaceInput,
    handler: ({ registry, query }: RegistryNamespaceInput) =>
      withBroker((client) => client.registrySearchByNamespace(registry, query), 'hol.registrySearchByNamespace'),
  },
  {
    name: 'hol.chat.createSession',
    description: 'Open a chat session linked to a UAID.',
    schema: chatSessionSchema,
    handler: (input: ChatSessionInput) => withBroker((client) => client.chat.createSession(input), 'hol.chat.createSession'),
  },
  {
    name: 'hol.chat.sendMessage',
    description: 'Send a message to an active chat session.',
    schema: chatMessageSchema,
    handler: (input: ChatMessageInput) =>
      withBroker(async (client) => {
        const { sessionId, uaid, message, auth, streaming } = input;
        const scopeForMemory: MemoryScope = { sessionId: sessionId ?? undefined, uaid: uaid ?? undefined };
        if (sessionId) {
          const payload: ChatSendMessagePayload = { sessionId, message, auth, streaming };
          await recordMemory(scopeForMemory, 'user', message, 'hol.chat.sendMessage');
          const response = await client.chat.sendMessage(payload);
          await recordMemory(scopeForMemory, 'assistant', stringifyForMemory(response), 'hol.chat.sendMessage');
          return response;
        }

        if (!uaid) {
          throw new Error('sessionId missing; provide uaid so a session can be created before sending.');
        }

        // Auto-create a session when callers only supply a UAID.
        const session = await client.chat.createSession({ uaid, auth });
        const derivedSessionId = session.sessionId;
        if (!derivedSessionId) {
          throw new Error('Unable to determine sessionId from broker response when auto-creating chat session.');
        }

        const payload: ChatSendMessagePayload = {
          sessionId: derivedSessionId,
          message,
          auth,
          streaming,
        };

        scopeForMemory.sessionId = derivedSessionId;

        await recordMemory(scopeForMemory, 'user', message, 'hol.chat.sendMessage');

        const response = await client.chat.sendMessage(payload);

        await recordMemory(scopeForMemory, 'assistant', stringifyForMemory(response), 'hol.chat.sendMessage');

        return response;
      }, 'hol.chat.sendMessage'),
  },
  {
    name: 'hol.chat.history',
    description: 'Retrieve the message history for a chat session.',
    schema: sessionIdInput,
    handler: ({ sessionId }: z.infer<typeof sessionIdInput>) =>
      withBroker((client) => client.chat.getHistory(sessionId), 'hol.chat.history'),
  },
  {
    name: 'hol.chat.compact',
    description: 'Compact chat history while preserving the latest entries.',
    schema: chatCompactSchema,
    handler: (input: ChatCompactInput) => withBroker((client) => client.chat.compactHistory(input), 'hol.chat.compact'),
  },
  {
    name: 'hol.chat.end',
    description: 'End a chat session and release broker resources.',
    schema: sessionIdInput,
    handler: ({ sessionId }: z.infer<typeof sessionIdInput>) =>
      withBroker((client) => client.chat.endSession(sessionId), 'hol.chat.end'),
  },
  {
    name: 'hol.stats',
    description: 'High-level registry statistics and usage metrics.',
    schema: emptyObject,
    handler: () => withBroker((client) => client.stats(), 'hol.stats'),
  },
  {
    name: 'hol.metricsSummary',
    description: 'Aggregated broker metrics suitable for dashboards.',
    schema: emptyObject,
    handler: () => withBroker((client) => client.metricsSummary(), 'hol.metricsSummary'),
  },
  {
    name: 'hol.dashboardStats',
    description: 'Detailed dashboard statistics from the broker.',
    schema: emptyObject,
    handler: () => withBroker((client) => client.dashboardStats(), 'hol.dashboardStats'),
  },
  {
    name: 'hol.websocketStats',
    description: 'Retrieve websocket connection counts and throughput.',
    schema: emptyObject,
    handler: () => withBroker((client) => client.websocketStats(), 'hol.websocketStats'),
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
];

export const toolDefinitions: ToolDefinition[] = rawToolDefinitions as unknown as ToolDefinition[];

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
        '- `q`: keyword search',
        '- `capabilities`: filter by declared skills',
        '- `metadata`: pass `{ \"region\": [\"na\"] }` style filters',
        '- `type`: limit results to `ai-agents` or `mcp-servers`',
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
        '- Discovery: workflow.discovery { query?, limit? } (or hol.search / hol.vectorSearch).',
        '- Registration: workflow.registerMcp { payload } (quote → register → wait) or workflow.fullRegistration to add discovery/chat/ops.',
        '- Chat: hol.chat.createSession { uaid, auth?, historyTtlSeconds? } → hol.chat.sendMessage { sessionId OR uaid, message, auth?, streaming? } → hol.chat.history/compact/end.',
        '- UAID validation/resets: hol.resolveUaid { uaid }, hol.closeUaidConnection { uaid }.',
        '- Ops/metrics: workflow.opsCheck or hol.stats / hol.metricsSummary / hol.dashboardStats.',
        '- Credits: hol.credits.balance first, then hol.purchaseCredits.hbar or hol.x402.buyCredits (X402 requires evmPrivateKey; call hol.x402.minimums to inspect limits).',
        '- Protocols: hol.listProtocols and hol.detectProtocol when inspecting inbound requests.',
        '',
        'Ask the user for any missing UAID, registration payload fields, accountId, or auth tokens before calling tools. Keep sessionId/uaid strings verbatim.',
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
