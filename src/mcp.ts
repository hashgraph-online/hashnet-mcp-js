import { randomUUID } from 'node:crypto';
import {
  AgentAuthConfig,
  LedgerChallengeRequest,
  LedgerVerifyRequest,
  PurchaseCreditsWithHbarParams,
  RegistryBrokerClient,
  RegistryBrokerError,
} from '@hashgraphonline/standards-sdk';
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

type AgentRegistrationRequest = Parameters<RegistryBrokerClient['registerAgent']>[0];
type ChatCreateSessionPayload = Parameters<RegistryBrokerClient['chat']['createSession']>[0];
type ChatSendMessagePayload = Parameters<RegistryBrokerClient['chat']['sendMessage']>[0];
type ChatCompactPayload = Parameters<RegistryBrokerClient['chat']['compactHistory']>[0];
type UpdateAgentPayload = Parameters<RegistryBrokerClient['updateAgent']>[1];
type RegistrySearchNamespaceArgs = Parameters<RegistryBrokerClient['registrySearchByNamespace']>;
type PurchaseHbarPayload = PurchaseCreditsWithHbarParams;

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
}) as z.ZodType<ChatCreateSessionPayload>;

const chatMessageSchema: z.ZodType<ChatSendMessagePayload> = z.object({
  sessionId: z.string().min(1),
  message: z.string().min(1),
  auth: agentAuthSchema.optional(),
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
});

const workflowOpsInput = z.object({});

const workflowFullInput = z.object({
  registrationPayload: agentRegistrationSchema,
  discoveryQuery: z.string().optional(),
  chatMessage: z.string().optional(),
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

const buyX402Input = z.object({
  accountId: z.string().min(1),
  credits: z.number().positive(),
  usdAmount: z.number().positive().optional(),
  description: z.string().optional(),
  metadata: z.record(z.string(), z.any()).optional(),
  evmPrivateKey: z.string().min(1),
  network: z.enum(['base', 'base-sepolia']).optional(),
  rpcUrl: z.string().url().optional(),
});

export const mcp = new FastMCP({
  name: 'hashgraph-standards',
  version: '1.0.0',
  description: 'MCP tools exposing Hashgraph Online Registry Broker via standards-sdk',
});

type ToolDefinition<Schema extends z.ZodTypeAny = z.ZodTypeAny> = {
  name: string;
  description: string;
  schema: Schema;
  handler: (input: z.infer<Schema>) => Promise<unknown>;
};

export const toolDefinitions: ToolDefinition[] = [
  {
    name: 'hol.search',
    description: 'Keyword search for agents or MCP servers with filtering controls.',
    schema: searchInput,
    handler: (input) => withBroker((client) => client.search(input)),
  },
  {
    name: 'hol.vectorSearch',
    description: 'Vector similarity search across registered agents.',
    schema: vectorSearchInput,
    handler: (input) => withBroker((client) => client.vectorSearch(input)),
  },
  {
    name: 'hol.resolveUaid',
    description: 'Resolve, validate, and check the status of a UAID in one call.',
    schema: uaidInput,
    handler: ({ uaid }) =>
      withBroker(async (client) => {
        const [resolved, validation, status] = await Promise.all([
          client.resolveUaid(uaid),
          client.validateUaid(uaid),
          client.getUaidConnectionStatus(uaid),
        ]);
        return { resolved, validation, status };
      }),
  },
  {
    name: 'hol.closeUaidConnection',
    description: 'Force-close any open UAID connection.',
    schema: uaidInput,
    handler: ({ uaid }) => withBroker((client) => client.closeUaidConnection(uaid)),
  },
  {
    name: 'hol.getRegistrationQuote',
    description: 'Estimate fees for a given agent registration payload.',
    schema: registrationPayload,
    handler: ({ payload }) => withBroker((client) => client.getRegistrationQuote(payload)),
  },
  {
    name: 'hol.registerAgent',
    description: 'Submit an HCS-11-compatible agent registration.',
    schema: registrationPayload,
    handler: ({ payload }) => withBroker((client) => client.registerAgent(payload)),
  },
  {
    name: 'hol.waitForRegistrationCompletion',
    description: 'Poll the registry broker until a registration attempt resolves.',
    schema: waitForRegistrationInput,
    handler: ({ attemptId, intervalMs, timeoutMs }) =>
      withBroker((client) =>
        client.waitForRegistrationCompletion(attemptId, {
          intervalMs,
          timeoutMs,
        }),
      ),
  },
  {
    name: 'hol.updateAgent',
    description: 'Update an existing agent registration payload.',
    schema: updateAgentInput,
    handler: ({ uaid, payload }) => withBroker((client) => client.updateAgent(uaid, payload as UpdateAgentPayload)),
  },
  {
    name: 'hol.additionalRegistries',
    description: 'Retrieve the catalog of additional registries and networks.',
    schema: emptyObject,
    handler: () => withBroker((client) => client.getAdditionalRegistries()),
  },
  {
    name: 'hol.registrySearchByNamespace',
    description: 'Search within a specific registry namespace.',
    schema: registryNamespaceInput,
    handler: ({ registry, query }) =>
      withBroker((client) => client.registrySearchByNamespace(registry, query)),
  },
  {
    name: 'hol.chat.createSession',
    description: 'Open a chat session linked to a UAID.',
    schema: chatSessionSchema,
    handler: (input) => withBroker((client) => client.chat.createSession(input)),
  },
  {
    name: 'hol.chat.sendMessage',
    description: 'Send a message to an active chat session.',
    schema: chatMessageSchema,
    handler: (input) => withBroker((client) => client.chat.sendMessage(input)),
  },
  {
    name: 'hol.chat.history',
    description: 'Retrieve the message history for a chat session.',
    schema: sessionIdInput,
    handler: ({ sessionId }) => withBroker((client) => client.chat.getHistory(sessionId)),
  },
  {
    name: 'hol.chat.compact',
    description: 'Compact chat history while preserving the latest entries.',
    schema: chatCompactSchema,
    handler: (input) => withBroker((client) => client.chat.compactHistory(input)),
  },
  {
    name: 'hol.chat.end',
    description: 'End a chat session and release broker resources.',
    schema: sessionIdInput,
    handler: ({ sessionId }) => withBroker((client) => client.chat.endSession(sessionId)),
  },
  {
    name: 'hol.listProtocols',
    description: 'List all registered protocols/adapters known to the broker.',
    schema: emptyObject,
    handler: () => runBrokerCall('hol.listProtocols', () => withBroker((client) => client.listProtocols())),
  },
  {
    name: 'hol.detectProtocol',
    description: 'Detect the expected protocol for an inbound request payload.',
    schema: detectProtocolInput,
    handler: (input) =>
      runBrokerCall('hol.detectProtocol', () => withBroker((client) => client.detectProtocol(input as any))),
  },
  {
    name: 'hol.stats',
    description: 'High-level registry statistics and usage metrics.',
    schema: emptyObject,
    handler: () => withBroker((client) => client.stats()),
  },
  {
    name: 'hol.metricsSummary',
    description: 'Aggregated broker metrics suitable for dashboards.',
    schema: emptyObject,
    handler: () => withBroker((client) => client.metricsSummary()),
  },
  {
    name: 'hol.dashboardStats',
    description: 'Detailed dashboard statistics from the broker.',
    schema: emptyObject,
    handler: () => withBroker((client) => client.dashboardStats()),
  },
  {
    name: 'hol.websocketStats',
    description: 'Retrieve websocket connection counts and throughput.',
    schema: emptyObject,
    handler: () => withBroker((client) => client.websocketStats()),
  },
  {
    name: 'hol.ledger.challenge',
    description: 'Create a ledger challenge message for account verification.',
    schema: ledgerChallengeInput,
    handler: (input) => withBroker((client) => client.createLedgerChallenge(input as LedgerChallengeRequest)),
  },
  {
    name: 'hol.ledger.authenticate',
    description: 'Verify a signed ledger challenge (sets ledger API key).',
    schema: ledgerVerifyInput,
    handler: (input) => withBroker((client) => client.verifyLedgerChallenge(input as LedgerVerifyRequest)),
  },
  {
    name: 'hol.purchaseCredits.hbar',
    description: 'Purchase registry credits using HBAR funds.',
    schema: purchaseHbarInput,
    handler: (input) => withBroker((client) => client.purchaseCreditsWithHbar(input)),
  },
  {
    name: 'hol.credits.balance',
    description: 'Fetch credit balances for the current API key and optional Hedera/X402 accounts.',
    schema: creditBalanceInput,
    handler: async (input) => {
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
    handler: () => withBroker((client) => client.getX402Minimums()),
  },
  {
    name: 'hol.x402.buyCredits',
    description: 'Buy registry credits via X402 using an EVM private key.',
    schema: buyX402Input,
    handler: (input) => withBroker((client) => client.buyCreditsWithX402(input)),
  },
  {
    name: 'workflow.discovery',
    description: 'Pipeline: hol.search + hol.vectorSearch',
    schema: workflowDiscoveryInput,
    handler: async (input) => formatPipelineResult(await discoveryPipeline.run(input)),
  },
  {
    name: 'workflow.registerMcp',
    description: 'Pipeline: get quote, register agent, wait for completion',
    schema: workflowRegistrationInput,
    handler: async ({ payload }) => formatPipelineResult(await registrationPipeline.run({ payload })),
  },
  {
    name: 'workflow.chatSmoke',
    description: 'Pipeline: chat session smoke test for UAID',
    schema: workflowChatInput,
    handler: async (input) => formatPipelineResult(await chatPipeline.run(input)),
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
    schema: z.object({ modelId: z.string().min(1), registry: z.string().optional(), message: z.string(), authToken: z.string().optional() }),
    handler: async (input) => formatPipelineResult(await openRouterChatWorkflow.run(input)),
  },
  {
    name: 'workflow.registryBrokerShowcase',
    description: 'Pipeline: discovery, analytics, UAID validation, chat',
    schema: z.object({ query: z.string().optional(), uaid: z.string().optional(), message: z.string().optional(), performCreditCheck: z.boolean().optional() }),
    handler: async (input) => formatPipelineResult(await registryBrokerShowcaseWorkflow.run(input)),
  },
  {
    name: 'workflow.agentverseBridge',
    description: 'Pipeline: relay chat between local UAID and Agentverse UAID',
    schema: z.object({
      uaid: z.string().min(1),
      agentverseUaid: z.string().min(1),
      localMessage: z.string().min(1),
      agentverseMessage: z.string().min(1),
      iterations: z.number().int().positive().optional(),
    }),
    handler: async (input) => formatPipelineResult(await agentverseBridgeWorkflow.run(input)),
  },
  {
    name: 'workflow.erc8004Discovery',
    description: 'Pipeline: search ERC-8004 registries',
    schema: z.object({ query: z.string().optional(), limit: z.number().int().positive().optional() }),
    handler: async (input) => formatPipelineResult(await erc8004DiscoveryWorkflow.run(input)),
  },
  {
    name: 'workflow.erc8004X402',
    description: 'Pipeline: ERC-8004 registration funded via X402 credits',
    schema: z.object({
      payload: agentRegistrationSchema,
      erc8004Networks: z.array(z.string()).optional(),
      chatMessage: z.string().optional(),
    }),
    handler: async (input) => formatPipelineResult(await erc8004X402Workflow.run(input)),
  },
  {
    name: 'workflow.x402Registration',
    description: 'Pipeline: register agent using X402 payments + chat smoke test',
    schema: z.object({
      payload: agentRegistrationSchema,
      chatMessage: z.string().optional(),
    }),
    handler: async (input) => formatPipelineResult(await x402RegistrationWorkflow.run(input)),
  },
  {
    name: 'workflow.fullRegistration',
    description: 'Pipeline: discovery → register → chat → ops',
    schema: workflowFullInput,
    handler: async (input) => formatPipelineResult(await fullWorkflowPipeline.run(input)),
  },
];

function formatPipelineResult(result: PipelineRunResult<unknown>) {
  const summaryLines = [
    `Workflow: ${result.pipeline}`,
    result.dryRun ? '(dry-run)' : undefined,
    result.context?.uaid ? `UAID: ${result.context.uaid}` : undefined,
    `Steps executed: ${result.steps.length}`,
  ].filter(Boolean) as string[];

  return {
    content: [
      { type: 'text', text: summaryLines.join('\n') },
      buildObjectContent('pipeline.result', result),
    ],
    structuredContent: result,
  };
}

export function buildLoggedTool<S extends z.ZodTypeAny>(definition: ToolDefinition<S>) {
  return {
    name: definition.name,
    description: definition.description,
    parameters: definition.schema,
    execute: async (args: z.input<S>, context?: Context) => {
      const requestId = context?.requestId ?? randomUUID();
      const started = Date.now();
      try {
        const parsedInput = definition.schema.parse(args);
        logger.debug({ requestId, tool: definition.name }, 'tool.invoke');
        const result = await definition.handler(parsedInput as z.infer<S>);
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
      structuredContent: isPlainObject(record.structuredContent) ? (record.structuredContent as Record<string, unknown>) : undefined,
      isError: typeof record.isError === 'boolean' ? (record.isError as boolean) : undefined,
    };
  }
  if (isPlainObject(value)) {
    return {
      content: [buildObjectContent('tool.result', value as Record<string, unknown>)],
      structuredContent: value as Record<string, unknown>,
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
