import { runSSE, runStdio } from '../transports';
import { logger } from '../logger';

type Transport = 'stdio' | 'sse';

const args = process.argv.slice(2);
const command = args[0];

if (!command || command === '--help' || command === '-h') {
  printHelp();
  process.exit(0);
}

if (command !== 'up') {
  console.error(`Unknown command: ${command}`);
  printHelp();
  process.exit(1);
}

const flags = parseFlags(args.slice(1));
const transport = normalizeTransport(flags.transport);

if (!transport) {
  console.error('Unsupported transport. Use --transport stdio|sse (default stdio).');
  process.exit(1);
}

ensureNodeVersion();

void startServer(transport);

function printHelp() {
  console.log(`Usage: npx @hol-org/hashnet-mcp up [options]

Options:
  --transport <stdio|sse>  Choose the transport to start (default: stdio)
  -h, --help              Show this help message`);
}

function parseFlags(values: string[]) {
  const cloned = [...values];
  return cloned.reduce<Record<string, any>>((acc, entry, index) => {
    if (entry.startsWith('--')) {
      const [key, inlineValue] = entry.split('=');
      const normalized = key.replace(/^--/, '');
      if (inlineValue !== undefined) {
        acc[normalized] = inlineValue;
      } else {
        const next = cloned[index + 1];
        if (next && !next.startsWith('--')) {
          acc[normalized] = next;
          cloned.splice(index + 1, 1);
        } else {
          acc[normalized] = true;
        }
      }
    }
    return acc;
  }, {});
}

function normalizeTransport(value: unknown): Transport | null {
  const normalized = String(value ?? 'stdio').toLowerCase();
  return normalized === 'stdio' || normalized === 'sse' ? normalized : null;
}

function ensureNodeVersion() {
  const major = Number(process.versions.node.split('.')[0]);
  if (Number.isNaN(major) || major < 18) {
    console.error(`Node.js 18+ is required (detected ${process.versions.node}).`);
    process.exit(1);
  }
}

async function startServer(transport: Transport) {
  try {
    process.env.MCP_TRANSPORT = transport;
    logger.info({ transport }, 'Starting hashnet-mcp server');
    if (transport === 'stdio') {
      await runStdio();
    } else {
      await runSSE();
    }
  } catch (error) {
    logger.error({ error }, 'Failed to start hashnet-mcp server');
    process.exit(1);
  }
}
