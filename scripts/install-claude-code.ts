#!/usr/bin/env tsx
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

interface ClaudeHttpTransport {
  type: 'http';
  url: string;
}

interface ClaudeServerConfig {
  transport?: ClaudeHttpTransport;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  metadata?: {
    description?: string;
    icon?: string;
  };
}

interface ClaudeConfigFile {
  mcpServers?: Record<string, ClaudeServerConfig>;
  experimental?: Record<string, unknown>;
}

interface CliOptions {
  name: string;
  endpoint: string;
  description?: string;
  configPath?: string;
  force: boolean;
  dryRun: boolean;
  skipBackup: boolean;
}

const DEFAULT_SERVER_NAME = 'hashnet-mcp';
const DEFAULT_ENDPOINT = 'http://localhost:3333/mcp/stream';
const DEFAULT_DESCRIPTION = 'Hashnet MCP (Registry Broker via FastMCP HTTP transport)';

async function main() {
  const options = parseArgs(process.argv.slice(2));
  validateEndpoint(options.endpoint);
  const configPath = resolveConfigPath(options.configPath);
  const config = await readConfig(configPath);
  config.mcpServers ??= {};
  if (config.mcpServers[options.name] && !options.force) {
    console.error(
      `An MCP server named "${options.name}" already exists in ${configPath}. Re-run with --force to replace it.`,
    );
    process.exit(1);
  }

  const brokerUrl = process.env.REGISTRY_BROKER_API_URL ?? 'https://hol.org/registry/api/v1';
  const brokerKey = process.env.REGISTRY_BROKER_API_KEY;

  const env: Record<string, string> = {
    REGISTRY_BROKER_API_URL: brokerUrl,
  };

  if (brokerKey) {
    env.REGISTRY_BROKER_API_KEY = brokerKey;
  }

  const serverConfig: ClaudeServerConfig = {
    command: 'npx',
    args: ['@hol-org/hashnet-mcp@1.0.19', 'up', '--transport', 'sse'],
    env,
    metadata: options.description ? { description: options.description } : undefined,
  };

  config.mcpServers[options.name] = serverConfig;

  if (options.dryRun) {
    console.log(`# Dry run — no files were modified.`);
    console.log(`Target config: ${configPath}`);
    console.log(JSON.stringify(config, null, 2));
    return;
  }

  await ensureParentDir(configPath);
  if (!options.skipBackup && existsSync(configPath)) {
    const backupPath = `${configPath}.bak.${Date.now()}`;
    await copyFile(configPath, backupPath);
    console.log(`Created backup at ${backupPath}`);
  }
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
  console.log(`Installed "${options.name}" into Claude Code config at ${configPath}`);
  console.log('Restart Claude Code to pick up the new MCP server.');
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    name: DEFAULT_SERVER_NAME,
    endpoint: DEFAULT_ENDPOINT,
    description: DEFAULT_DESCRIPTION,
    configPath: undefined,
    force: false,
    dryRun: false,
    skipBackup: false,
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
      case '-e':
        options.endpoint = argv[++i] ?? options.endpoint;
        break;
      case '--description':
      case '-d':
        options.description = argv[++i] ?? options.description;
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
      case '--skip-backup':
        options.skipBackup = true;
        break;
      default:
        if (arg.startsWith('-')) {
          console.warn(`Unknown option: ${arg}`);
        }
    }
  }

  return options;
}

async function readConfig(filePath: string): Promise<ClaudeConfigFile> {
  try {
    const raw = await readFile(filePath, 'utf8');
    if (!raw.trim()) {
      return {};
    }
    return JSON.parse(raw) as ClaudeConfigFile;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return {};
    }
    throw new Error(`Failed to read ${filePath}: ${(error as Error).message}`);
  }
}

function resolveConfigPath(override?: string): string {
  if (override) {
    return expandPath(override);
  }
  const candidates = getDefaultConfigCandidates();
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return candidates[0];
}

function getDefaultConfigCandidates(): string[] {
  const home = os.homedir();
  if (process.platform === 'darwin') {
    return [
      path.join(home, 'Library', 'Application Support', 'Claude', 'claude_code_config.json'),
      path.join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json'),
    ];
  }
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA ?? path.join(home, 'AppData', 'Roaming');
    return [path.join(appData, 'Claude', 'claude_code_config.json')];
  }
  return [
    path.join(home, '.config', 'Claude', 'claude_code_config.json'),
    path.join(home, '.config', 'Claude', 'claude_desktop_config.json'),
  ];
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
      throw new Error('Endpoint must be HTTP or HTTPS');
    }
  } catch (error) {
    throw new Error(`Invalid endpoint "${endpoint}": ${(error as Error).message}`);
  }
}

async function ensureParentDir(targetPath: string) {
  const dir = path.dirname(targetPath);
  await mkdir(dir, { recursive: true });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
