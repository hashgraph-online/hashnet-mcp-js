#!/usr/bin/env tsx
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { getPipeline } from '../src/workflows';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

interface Options {
  endpoint?: string;
  payloadPath?: string;
  reuseServer?: boolean;
}

function parseArgs() {
  const positional: string[] = [];
  const opts: Options = {};
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i += 1) {
    const value = args[i];
    if (value === '--endpoint') {
      opts.endpoint = args[++i];
    } else if (value === '--payload') {
      opts.payloadPath = args[++i];
    } else if (value === '--reuse-server') {
      opts.reuseServer = true;
    } else {
      positional.push(value);
    }
  }
  return { pipelineName: positional[0], opts };
}

const { pipelineName, opts } = parseArgs();

if (!pipelineName) {
  console.error('Usage: pnpm workflow:run <pipeline> [--payload file.json] [--endpoint url] [--reuse-server]');
  process.exit(1);
}

async function main() {
  if (opts.endpoint) {
    await runRemoteWorkflow(pipelineName, opts);
  } else {
    await runLocalPipeline(pipelineName, opts);
  }
}

async function runLocalPipeline(name: string, options: Options) {
  const pipeline = getPipeline(name);
  if (!pipeline) throw new Error(`Pipeline ${name} not found.`);
  const input = options.payloadPath ? await loadJson(options.payloadPath) : {};
  const result = await pipeline.run(input);
  console.log(JSON.stringify(result, null, 2));
}

async function runRemoteWorkflow(name: string, options: Options) {
  let child: ReturnType<typeof spawn> | undefined;
  const endpoint = options.endpoint ?? 'http://localhost:3333/mcp/stream';
  const shouldSpawn = !options.reuseServer && isLocalEndpoint(endpoint);

  try {
    if (shouldSpawn) {
      child = spawn('pnpm', ['run', 'dev:sse'], {
        cwd: projectRoot,
        stdio: 'inherit',
        env: process.env,
      });
      await wait(4000);
    }

    const client = new Client({ name: 'workflow-cli', version: '1.0.0' }, { capabilities: {} });
    const transport = new StreamableHTTPClientTransport(new URL(endpoint));
    await client.connect(transport);
    const args = options.payloadPath ? await loadJson(options.payloadPath) : {};
    const response = await client.callTool({ name, arguments: args });
    console.log(JSON.stringify(response, null, 2));
    await client.close();
  } finally {
    child?.kill('SIGINT');
  }
}

function isLocalEndpoint(url: string) {
  try {
    const parsed = new URL(url);
    return parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
  } catch {
    return false;
  }
}

function wait(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

async function loadJson(filePath?: string) {
  if (!filePath) return {};
  const raw = await readFile(path.resolve(filePath), 'utf8');
  return JSON.parse(raw);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
