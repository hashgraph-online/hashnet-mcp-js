#!/usr/bin/env tsx
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

interface CursorServer {
  name: string;
  transport?: {
    type: 'http';
    url: string;
  };
  command?: string;
  args?: string[];
  env?: Record<string, string>;
}

interface CursorSettings {
  [key: string]: unknown;
  'modelContextProtocol.servers'?: CursorServer[];
}

interface CliOptions {
  name: string;
  endpoint: string;
  configPath?: string;
  force: boolean;
  dryRun: boolean;
}

const DEFAULT_NAME = 'hashnet-mcp';
const DEFAULT_ENDPOINT = 'http://localhost:3333/mcp/stream';

async function main() {
  const options = parseArgs(process.argv.slice(2));
  validateEndpoint(options.endpoint);
  const configPath = resolveConfigPath(options.configPath);
  const settings = await readSettings(configPath);
  const servers = readServerArray(settings);
  const existingIndex = servers.findIndex((server) => server.name === options.name);
  if (existingIndex >= 0 && !options.force) {
    throw new Error(
      `Cursor already has an MCP server named "${options.name}" in ${configPath}. Re-run with --force to replace it.`,
    );
  }

  const server: CursorServer = {
    name: options.name,
    transport: {
      type: 'http',
      url: options.endpoint,
    },
  };

  if (existingIndex >= 0) {
    servers.splice(existingIndex, 1, server);
  } else {
    servers.push(server);
  }

  settings['modelContextProtocol.servers'] = servers;

  if (options.dryRun) {
    console.log('# Dry run — no files modified.');
    console.log(`Target file: ${configPath}`);
    console.log(JSON.stringify(settings, null, 2));
    return;
  }

  await ensureParent(configPath);
  await writeFile(configPath, `${JSON.stringify(settings, null, 2)}\n`);
  console.log(`Installed "${options.name}" into Cursor settings at ${configPath}`);
  console.log('Restart Cursor so the MCP catalog refreshes.');
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    name: DEFAULT_NAME,
    endpoint: DEFAULT_ENDPOINT,
    configPath: undefined,
    force: false,
    dryRun: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case '--name':
      case '-n':
        options.name = argv[++i] ?? options.name;
        break;
      case '--endpoint':
      case '--url':
      case '-u':
        options.endpoint = argv[++i] ?? options.endpoint;
        break;
      case '--config':
        options.configPath = argv[++i];
        break;
      case '--force':
        options.force = true;
        break;
      case '--dry-run':
        options.dryRun = true;
        break;
      default:
        if (arg.startsWith('-')) {
          console.warn(`Unknown option: ${arg}`);
        }
    }
  }

  return options;
}

async function readSettings(filePath: string): Promise<CursorSettings> {
  try {
    const raw = await readFile(filePath, 'utf8');
    if (!raw.trim()) {
      return {};
    }
    return JSON.parse(raw) as CursorSettings;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return {};
    }
    throw new Error(`Failed to read ${filePath}: ${(error as Error).message}`);
  }
}

function readServerArray(settings: CursorSettings): CursorServer[] {
  const value = settings['modelContextProtocol.servers'];
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error(
      'Cursor setting "modelContextProtocol.servers" exists but is not an array. Edit the file manually to unblock automation.',
    );
  }
  return [...value];
}

function resolveConfigPath(override?: string): string {
  if (override) {
    return expandPath(override);
  }
  const home = os.homedir();
  if (process.platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', 'Cursor', 'User', 'settings.json');
  }
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA ?? path.join(home, 'AppData', 'Roaming');
    return path.join(appData, 'Cursor', 'User', 'settings.json');
  }
  return path.join(home, '.config', 'Cursor', 'User', 'settings.json');
}

function expandPath(input: string): string {
  if (!input.startsWith('~')) {
    return path.resolve(input);
  }
  if (input === '~') {
    return os.homedir();
  }
  if (input.startsWith('~/')) {
    return path.join(os.homedir(), input.slice(2));
  }
  return path.join(os.homedir(), input.slice(1));
}

function validateEndpoint(endpoint: string) {
  try {
    const url = new URL(endpoint);
    if (!url.protocol.startsWith('http')) {
      throw new Error('Endpoint must use HTTP or HTTPS.');
    }
  } catch (error) {
    throw new Error(`Invalid endpoint "${endpoint}": ${(error as Error).message}`);
  }
}

async function ensureParent(filePath: string) {
  const dir = path.dirname(filePath);
  await mkdir(dir, { recursive: true });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
