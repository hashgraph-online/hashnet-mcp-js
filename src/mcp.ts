import { randomUUID } from 'node:crypto';
import type { RegistryBrokerClient } from '@hashgraphonline/standards-sdk';
import { FastMCP } from 'fastmcp';
import type { Content } from 'fastmcp';
import type { Context } from 'fastmcp';
import { z } from 'zod';
import { withBroker } from './broker';
import { logger } from './logger';
import { agentRegistrationSchema } from './schemas/agent';

type AgentRegistrationRequest = Parameters<RegistryBrokerClient['registerAgent']>[0];
type ChatCreateSessionPayload = Parameters<RegistryBrokerClient['chat']['createSession']>[0];
type ChatSendMessagePayload = Parameters<RegistryBrokerClient['chat']['sendMessage']>[0];
type ChatCompactPayload = Parameters<RegistryBrokerClient['chat']['compactHistory']>[0];

const chatSessionSchema: z.ZodType<ChatCreateSessionPayload> = z.object({
  uaid: z.string().min(1),
  historyTtlSeconds: z.number().int().positive().optional(),
}) as z.ZodType<ChatCreateSessionPayload>;

const chatMessageSchema: z.ZodType<ChatSendMessagePayload> = z.object({
  sessionId: z.string().min(1),
  message: z.string().min(1),
}) as z.ZodType<ChatSendMessagePayload>;

const chatCompactSchema: z.ZodType<ChatCompactPayload> = z.object({
  sessionId: z.string().min(1),
  preserveEntries: z.number().int().min(0).default(4),
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
    name: 'rb.search',
    description: 'Keyword search for agents or MCP servers with filtering controls.',
    schema: searchInput,
    handler: (input) => withBroker((client) => client.search(input)),
  },
  {
    name: 'rb.vectorSearch',
    description: 'Vector similarity search across registered agents.',
    schema: vectorSearchInput,
    handler: (input) => withBroker((client) => client.vectorSearch(input)),
  },
  {
    name: 'rb.resolveUaid',
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
    name: 'rb.closeUaidConnection',
    description: 'Force-close any open UAID connection.',
    schema: uaidInput,
    handler: ({ uaid }) => withBroker((client) => client.closeUaidConnection(uaid)),
  },
  {
    name: 'rb.getRegistrationQuote',
    description: 'Estimate fees for a given agent registration payload.',
    schema: registrationPayload,
    handler: ({ payload }) => withBroker((client) => client.getRegistrationQuote(payload)),
  },
  {
    name: 'rb.registerAgent',
    description: 'Submit an HCS-11-compatible agent registration.',
    schema: registrationPayload,
    handler: ({ payload }) => withBroker((client) => client.registerAgent(payload)),
  },
  {
    name: 'rb.waitForRegistrationCompletion',
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
    name: 'rb.chat.createSession',
    description: 'Open a chat session linked to a UAID.',
    schema: chatSessionSchema,
    handler: (input) => withBroker((client) => client.chat.createSession(input)),
  },
  {
    name: 'rb.chat.sendMessage',
    description: 'Send a message to an active chat session.',
    schema: chatMessageSchema,
    handler: (input) => withBroker((client) => client.chat.sendMessage(input)),
  },
  {
    name: 'rb.chat.history',
    description: 'Retrieve the message history for a chat session.',
    schema: sessionIdInput,
    handler: ({ sessionId }) => withBroker((client) => client.chat.getHistory(sessionId)),
  },
  {
    name: 'rb.chat.compact',
    description: 'Compact chat history while preserving the latest entries.',
    schema: chatCompactSchema,
    handler: (input) => withBroker((client) => client.chat.compactHistory(input)),
  },
  {
    name: 'rb.chat.end',
    description: 'End a chat session and release broker resources.',
    schema: sessionIdInput,
    handler: ({ sessionId }) => withBroker((client) => client.chat.endSession(sessionId)),
  },
  {
    name: 'rb.listProtocols',
    description: 'List all registered protocols/adapters known to the broker.',
    schema: emptyObject,
    handler: () => withBroker((client) => client.listProtocols()),
  },
  {
    name: 'rb.detectProtocol',
    description: 'Detect the expected protocol for an inbound request payload.',
    schema: detectProtocolInput,
    handler: (input) => withBroker((client) => client.detectProtocol(input as any)),
  },
  {
    name: 'rb.stats',
    description: 'High-level registry statistics and usage metrics.',
    schema: emptyObject,
    handler: () => withBroker((client) => client.stats()),
  },
  {
    name: 'rb.metricsSummary',
    description: 'Aggregated broker metrics suitable for dashboards.',
    schema: emptyObject,
    handler: () => withBroker((client) => client.metricsSummary()),
  },
  {
    name: 'rb.dashboardStats',
    description: 'Detailed dashboard statistics from the broker.',
    schema: emptyObject,
    handler: () => withBroker((client) => client.dashboardStats()),
  },
];

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
        return coerceToContent(result);
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

function coerceToContent(result: unknown): Content[] {
  if (Array.isArray(result) && result.every((item) => isContent(item))) {
    return result as Content[];
  }
  if (typeof result === 'string') {
    return [{ type: 'text', text: result }];
  }
  return [{ type: 'text', text: JSON.stringify(result, null, 2) }];
}

function isContent(value: unknown): value is Content {
  return Boolean(
    value &&
    typeof value === 'object' &&
    'type' in value &&
    typeof (value as { type: unknown }).type === 'string',
  );
}

for (const definition of toolDefinitions) {
  mcp.addTool(buildLoggedTool(definition));
}

export const registeredTools = toolDefinitions;

mcp.addResource({
  name: 'rb.search.help',
  uri: 'help://rb/search',
  mimeType: 'text/markdown',
  load: async () => [
    {
      text: [
        '# rb.search',
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
