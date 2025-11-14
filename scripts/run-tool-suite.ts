#!/usr/bin/env tsx
import 'dotenv/config';
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
if (options.mock) {
  options.spawn = false;
  options.endpoint = `http://127.0.0.1:${options.mockPort}/mcp/stream`;
}

const palette = {
  green: (text: string) => `\u001b[32m${text}\u001b[0m`,
  yellow: (text: string) => `\u001b[33m${text}\u001b[0m`,
  magenta: (text: string) => `\u001b[35m${text}\u001b[0m`,
  red: (text: string) => `\u001b[31m${text}\u001b[0m`,
  cyan: (text: string) => `\u001b[36m${text}\u001b[0m`,
};
const truncateLimit = Number(process.env.TOOL_SUITE_LOG_LIMIT ?? '2000');

interface ScenarioContext {
  chatSessionId?: string;
  discoveredUaid?: string;
  registeredUaid?: string;
  latestAttemptId?: string;
  registrationPayload?: typeof agentPayload;
}

interface Scenario {
  tool: string;
  description: string;
  requiresEnv?: string[];
  needsContext?: (ctx: ScenarioContext) => boolean;
  payload: (ctx: ScenarioContext) => unknown;
  onResult?: (result: any, ctx: ScenarioContext) => void;
  skipIf?: (ctx: ScenarioContext) => string | undefined;
}

function getEnv(name: string) {
  return process.env[name];
}

const agentPayload = JSON.parse(
  readFileSync(path.join(projectRoot, 'examples/agent-registration-request.json'), 'utf8'),
);
function buildRegistrationPayload() {
  const clone = JSON.parse(JSON.stringify(agentPayload));
  const suffix = Date.now().toString(36);
  clone.profile = clone.profile ?? {};
  clone.profile.display_name = `${clone.profile.display_name ?? 'Hashnet MCP'} ${suffix}`;
  clone.profile.alias = `${clone.profile.alias ?? 'hashnet-mcp'}-${suffix}`;
  return clone;
}

const scenarios: Scenario[] = [
  {
    tool: 'hol.search',
    description: 'Keyword search',
    payload: () => ({ q: 'hashgraph', limit: 2 }),
    onResult: (result, ctx) => {
      const structured = getStructured(result);
      const firstHit = structured?.hits?.[0];
      if (firstHit?.uaid) {
        ctx.discoveredUaid = firstHit.uaid;
      }
    },
  },
  {
    tool: 'hol.vectorSearch',
    description: 'Vector search',
    payload: () => ({ query: 'registry broker', limit: 2 }),
  },
  {
    tool: 'hol.resolveUaid',
    description: 'Resolve UAID',
    skipIf: (ctx) => (!getEnv('TEST_UAID') && !ctx.discoveredUaid ? 'no UAID available (set TEST_UAID or rely on hol.search results)' : undefined),
    payload: (ctx) => {
      const uaid = getEnv('TEST_UAID') ?? ctx.discoveredUaid;
      if (!uaid) throw new Error('UAID not available');
      return { uaid };
    },
  },
  {
    tool: 'hol.closeUaidConnection',
    description: 'Close UAID connection',
    skipIf: (ctx) =>
      !getEnv('TEST_UAID') && !ctx.discoveredUaid && !ctx.registeredUaid ? 'no UAID available to close' : undefined,
    payload: (ctx) => {
      const uaid = getEnv('TEST_UAID') ?? ctx.discoveredUaid ?? ctx.registeredUaid;
      if (!uaid) throw new Error('Missing UAID');
      return { uaid };
    },
  },
  {
    tool: 'hol.getRegistrationQuote',
    description: 'Registration quote',
    payload: (ctx) => {
      ctx.registrationPayload = ctx.registrationPayload ?? buildRegistrationPayload();
      return { payload: ctx.registrationPayload };
    },
  },
  {
    tool: 'hol.registerAgent',
    description: 'Register agent (dry run)',
    payload: (ctx) => ({ payload: ctx.registrationPayload ?? buildRegistrationPayload() }),
    onResult: (result, ctx) => {
      const structured = getStructured(result);
      if (structured?.attemptId) {
        ctx.latestAttemptId = structured.attemptId;
      }
      if (structured?.uaid) {
        ctx.registeredUaid = structured.uaid;
      }
    },
  },
  {
    tool: 'hol.waitForRegistrationCompletion',
    description: 'Wait for registration attempt',
    skipIf: (ctx) =>
      !ctx.latestAttemptId && !getEnv('TEST_REGISTRATION_ATTEMPT_ID')
        ? 'no registration attemptId available (set TEST_REGISTRATION_ATTEMPT_ID or rely on hol.registerAgent)'
        : undefined,
    payload: (ctx) => {
      const attemptId = ctx.latestAttemptId ?? getEnv('TEST_REGISTRATION_ATTEMPT_ID');
      if (!attemptId) throw new Error('Missing attemptId');
      return {
        attemptId,
        intervalMs: 1000,
        timeoutMs: 20_000,
      };
    },
    onResult: (result, ctx) => {
      const structured = getStructured(result);
      const uaid = structured?.result?.uaid;
      if (uaid) {
        ctx.registeredUaid = uaid;
      }
    },
  },
  {
    tool: 'hol.chat.createSession',
    description: 'Create chat session',
    skipIf: (ctx) =>
      !getEnv('TEST_CHAT_UAID') && !ctx.registeredUaid && !ctx.discoveredUaid
        ? 'no UAID available for chat (set TEST_CHAT_UAID or rely on workflow output)'
        : undefined,
    payload: (ctx) => {
      const uaid = getEnv('TEST_CHAT_UAID') ?? ctx.registeredUaid ?? ctx.discoveredUaid;
      if (!uaid) throw new Error('Missing chat UAID');
      return { uaid, historyTtlSeconds: 60 };
    },
    onResult: (result, ctx) => {
      ctx.chatSessionId = result?.sessionId;
    },
  },
  {
    tool: 'hol.chat.sendMessage',
    description: 'Send chat message',
    skipIf: (ctx) =>
      !ctx.chatSessionId ? 'chat session unavailable (hol.chat.createSession failed or skipped)' : undefined,
    needsContext: (ctx) => Boolean(ctx.chatSessionId),
    payload: (ctx) => ({ sessionId: ctx.chatSessionId!, message: 'ping' }),
  },
  {
    tool: 'hol.chat.history',
    description: 'Chat history',
    skipIf: (ctx) =>
      !ctx.chatSessionId ? 'chat session unavailable (hol.chat.createSession failed or skipped)' : undefined,
    needsContext: (ctx) => Boolean(ctx.chatSessionId),
    payload: (ctx) => ({ sessionId: ctx.chatSessionId! }),
  },
  {
    tool: 'hol.chat.compact',
    description: 'Compact chat history',
    skipIf: (ctx) =>
      !ctx.chatSessionId ? 'chat session unavailable (hol.chat.createSession failed or skipped)' : undefined,
    needsContext: (ctx) => Boolean(ctx.chatSessionId),
    payload: (ctx) => ({ sessionId: ctx.chatSessionId!, preserveEntries: 2 }),
  },
  {
    tool: 'hol.chat.end',
    description: 'End chat session',
    skipIf: (ctx) =>
      !ctx.chatSessionId ? 'chat session unavailable (hol.chat.createSession failed or skipped)' : undefined,
    needsContext: (ctx) => Boolean(ctx.chatSessionId),
    payload: (ctx) => ({ sessionId: ctx.chatSessionId! }),
  },
  {
    tool: 'hol.listProtocols',
    description: 'List protocols',
    skipIf: () => ((process.env.BROKER_PROTOCOL_TOOLS ?? '').trim() !== '1' ? 'set BROKER_PROTOCOL_TOOLS=1 to enable protocol tools' : undefined),
    payload: () => ({}),
  },
  {
    tool: 'hol.detectProtocol',
    description: 'Detect protocol',
    skipIf: () => ((process.env.BROKER_PROTOCOL_TOOLS ?? '').trim() !== '1' ? 'set BROKER_PROTOCOL_TOOLS=1 to enable protocol tools' : undefined),
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
  let mock: ReturnType<typeof spawn> | undefined;
  try {
    if (options.mock) {
      mock = spawn(getTsxBinary(), [path.join(projectRoot, 'scripts', 'mock-broker.ts')], {
        cwd: projectRoot,
        env: { ...process.env, MOCK_BROKER_PORT: String(options.mockPort) },
        stdio: 'inherit',
      });
      await delay(500);
    }
    if (options.spawn) {
      child = spawn(getTsxBinary(), [path.join(projectRoot, 'src', 'index.ts')], {
        cwd: projectRoot,
        env: { ...process.env, PORT: options.port?.toString() ?? '3333', MCP_TRANSPORT: 'sse' },
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
    await stopProcess(child, 'SIGINT');
    await stopProcess(mock, 'SIGINT');
  }
}

function evaluateSkip(scenario: Scenario, ctx: ScenarioContext) {
  if (scenario.requiresEnv) {
    const missing = scenario.requiresEnv.filter((key) => !getEnv(key));
    if (missing.length) {
      return `missing env vars ${missing.join(', ')}`;
    }
  }
  if (scenario.skipIf) {
    const message = scenario.skipIf(ctx);
    if (message) {
      return message;
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

function truncate(text: string, max = truncateLimit) {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function parseArgs(argv: string[]) {
  const opts: { endpoint: string; spawn: boolean; port?: number; mock?: boolean; mockPort: number } = {
    endpoint: defaultEndpoint,
    spawn: false,
    mock: false,
    mockPort: Number(process.env.MOCK_BROKER_PORT ?? 4545),
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
    } else if (value === '--mock') {
      opts.mock = true;
    } else if (value === '--mock-port') {
      opts.mockPort = Number(argv[i + 1]);
      i += 1;
    }
  }
  if (!opts.endpoint) {
    opts.endpoint = defaultEndpoint;
  }
  return opts;
}

function getTsxBinary() {
  const bin = process.platform === 'win32' ? 'tsx.cmd' : 'tsx';
  return path.join(projectRoot, 'node_modules', '.bin', bin);
}

async function stopProcess(proc: ReturnType<typeof spawn> | undefined, signal: NodeJS.Signals = 'SIGINT') {
  if (!proc) return;
  await new Promise<void>((resolve) => {
    proc.once('exit', () => resolve());
    proc.kill(signal);
  });
}

function getStructured(result: any) {
  if (result && typeof result === 'object' && result.structuredContent && typeof result.structuredContent === 'object') {
    return result.structuredContent as Record<string, any>;
  }
  const textBlock = Array.isArray(result?.content)
    ? result.content.find((entry: any) => entry?.type === 'text' && typeof entry.text === 'string' && entry.text.includes('{'))
    : undefined;
  if (textBlock) {
    const [, ...jsonLines] = textBlock.text.split('\n');
    const candidate = jsonLines.join('\n').trim();
    if (candidate) {
      try {
        return JSON.parse(candidate);
      } catch {
        // ignore parse errors
      }
    }
  }
  return undefined;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
