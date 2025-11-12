#!/usr/bin/env tsx
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const defaultEndpoint = 'http://localhost:3333/mcp/stream';

const args = process.argv.slice(2);
const options = parseArgs(args);

const palette = {
  green: (text: string) => `\u001b[32m${text}\u001b[0m`,
  yellow: (text: string) => `\u001b[33m${text}\u001b[0m`,
  magenta: (text: string) => `\u001b[35m${text}\u001b[0m`,
  red: (text: string) => `\u001b[31m${text}\u001b[0m`,
  cyan: (text: string) => `\u001b[36m${text}\u001b[0m`,
};

interface ScenarioContext {
  chatSessionId?: string;
}

interface Scenario {
  tool: string;
  description: string;
  requiresEnv?: string[];
  needsContext?: (ctx: ScenarioContext) => boolean;
  payload: (ctx: ScenarioContext) => unknown;
  onResult?: (result: any, ctx: ScenarioContext) => void;
}

function getEnv(name: string) {
  return process.env[name];
}

const agentPayload = JSON.parse(
  readFileSync(path.join(projectRoot, 'examples/agent-registration-request.json'), 'utf8'),
);

const scenarios: Scenario[] = [
  {
    tool: 'hol.search',
    description: 'Keyword search',
    payload: () => ({ q: 'hashgraph', limit: 2 }),
  },
  {
    tool: 'hol.vectorSearch',
    description: 'Vector search',
    payload: () => ({ query: 'registry broker', limit: 2 }),
  },
  {
    tool: 'hol.resolveUaid',
    description: 'Resolve UAID',
    requiresEnv: ['TEST_UAID'],
    payload: () => ({ uaid: getEnv('TEST_UAID')! }),
  },
  {
    tool: 'hol.closeUaidConnection',
    description: 'Close UAID connection',
    requiresEnv: ['TEST_UAID'],
    payload: () => ({ uaid: getEnv('TEST_UAID')! }),
  },
  {
    tool: 'hol.getRegistrationQuote',
    description: 'Registration quote',
    payload: () => ({ payload: agentPayload }),
  },
  {
    tool: 'hol.registerAgent',
    description: 'Register agent (dry run)',
    payload: () => ({ payload: agentPayload }),
  },
  {
    tool: 'hol.waitForRegistrationCompletion',
    description: 'Wait for registration attempt',
    requiresEnv: ['TEST_REGISTRATION_ATTEMPT_ID'],
    payload: () => ({
      attemptId: getEnv('TEST_REGISTRATION_ATTEMPT_ID')!,
      intervalMs: 1000,
      timeoutMs: 10_000,
    }),
  },
  {
    tool: 'hol.chat.createSession',
    description: 'Create chat session',
    requiresEnv: ['TEST_CHAT_UAID'],
    payload: () => ({ uaid: getEnv('TEST_CHAT_UAID')!, historyTtlSeconds: 60 }),
    onResult: (result, ctx) => {
      ctx.chatSessionId = result?.sessionId;
    },
  },
  {
    tool: 'hol.chat.sendMessage',
    description: 'Send chat message',
    requiresEnv: ['TEST_CHAT_UAID'],
    needsContext: (ctx) => Boolean(ctx.chatSessionId),
    payload: (ctx) => ({ sessionId: ctx.chatSessionId!, message: 'ping' }),
  },
  {
    tool: 'hol.chat.history',
    description: 'Chat history',
    requiresEnv: ['TEST_CHAT_UAID'],
    needsContext: (ctx) => Boolean(ctx.chatSessionId),
    payload: (ctx) => ({ sessionId: ctx.chatSessionId! }),
  },
  {
    tool: 'hol.chat.compact',
    description: 'Compact chat history',
    requiresEnv: ['TEST_CHAT_UAID'],
    needsContext: (ctx) => Boolean(ctx.chatSessionId),
    payload: (ctx) => ({ sessionId: ctx.chatSessionId!, preserveEntries: 2 }),
  },
  {
    tool: 'hol.chat.end',
    description: 'End chat session',
    requiresEnv: ['TEST_CHAT_UAID'],
    needsContext: (ctx) => Boolean(ctx.chatSessionId),
    payload: (ctx) => ({ sessionId: ctx.chatSessionId! }),
  },
  {
    tool: 'hol.listProtocols',
    description: 'List protocols',
    payload: () => ({}),
  },
  {
    tool: 'hol.detectProtocol',
    description: 'Detect protocol',
    payload: () => ({ headers: { 'content-type': 'application/json' }, body: '{}' }),
  },
  {
    tool: 'hol.stats',
    description: 'Broker stats',
    payload: () => ({}),
  },
  {
    tool: 'hol.metricsSummary',
    description: 'Metrics summary',
    payload: () => ({}),
  },
  {
    tool: 'hol.dashboardStats',
    description: 'Dashboard stats',
    payload: () => ({}),
  },
  {
    tool: 'hol.credits.balance',
    description: 'Credit balances (API key + optional Hedera/X402 accounts)',
    payload: () => {
      const payload: Record<string, string> = {};
      const hederaAccount = getEnv('HEDERA_ACCOUNT_ID');
      const x402Account = getEnv('X402_ACCOUNT_ID');
      if (hederaAccount) {
        payload.hederaAccountId = hederaAccount;
      }
      if (x402Account) {
        payload.x402AccountId = x402Account;
      }
      return payload;
    },
  },
];

async function main() {
  let child: ReturnType<typeof spawn> | undefined;
  try {
    if (options.spawn) {
      child = spawn('pnpm', ['run', 'dev:sse'], {
        cwd: projectRoot,
        env: { ...process.env, PORT: options.port?.toString() ?? '3333' },
        stdio: 'inherit',
      });
      await waitForHealth(options.endpoint);
    }

    const client = await connect(options.endpoint);
    const ctx: ScenarioContext = {};
    for (const scenario of scenarios) {
      const skipReason = evaluateSkip(scenario, ctx);
      if (skipReason) {
        console.log(`${palette.yellow('↷')} Skipping ${scenario.tool}: ${skipReason}`);
        continue;
      }
      try {
        const payload = scenario.payload(ctx);
        console.log(`${palette.cyan('→')} ${scenario.tool} — ${scenario.description}`);
        const params = {
          name: scenario.tool,
          arguments: payload,
        };
        const result = await client.callTool(params);
        console.log(`${palette.green('✓')} ${scenario.tool}: ${truncate(JSON.stringify(result, null, 2))}`);
        scenario.onResult?.(result, ctx);
      } catch (error) {
        console.error(`${palette.red('✗')} ${scenario.tool}: ${(error as Error).message}`);
      }
    }
    await client.close();
  } finally {
    if (child) {
      child.kill('SIGINT');
    }
  }
}

function evaluateSkip(scenario: Scenario, ctx: ScenarioContext) {
  if (scenario.requiresEnv) {
    const missing = scenario.requiresEnv.filter((key) => !getEnv(key));
    if (missing.length) {
      return `missing env vars ${missing.join(', ')}`;
    }
  }
  if (scenario.needsContext && !scenario.needsContext(ctx)) {
    return 'dependent context not satisfied';
  }
  return undefined;
}

async function connect(endpoint: string) {
  const client = new Client({ name: 'tool-suite', version: '1.0.0' }, { capabilities: {} });
  const transport = new StreamableHTTPClientTransport(new URL(endpoint));
  await client.connect(transport);
  return client;
}

async function waitForHealth(endpoint: string, timeoutMs = 10_000) {
  const url = new URL(endpoint);
  url.pathname = '/healthz';
  const start = Date.now();
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // ignore
    }
    if (Date.now() - start > timeoutMs) {
      throw new Error('Server health check timed out');
    }
    await delay(500);
  }
}

function truncate(text: string, max = 200) {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function parseArgs(argv: string[]) {
  const opts: { endpoint: string; spawn: boolean; port?: number } = {
    endpoint: defaultEndpoint,
    spawn: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i];
    if (value === '--endpoint') {
      opts.endpoint = argv[i + 1] ?? defaultEndpoint;
      i += 1;
    } else if (value === '--spawn') {
      opts.spawn = true;
    } else if (value === '--port') {
      opts.port = Number(argv[i + 1]);
      i += 1;
    }
  }
  if (!opts.endpoint) {
    opts.endpoint = defaultEndpoint;
  }
  return opts;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
