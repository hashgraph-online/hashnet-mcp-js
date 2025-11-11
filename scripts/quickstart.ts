#!/usr/bin/env tsx
import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { stdin as input, stdout as output } from 'node:process';
import readline from 'node:readline/promises';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const envPath = path.join(projectRoot, '.env');
const envExamplePath = path.join(projectRoot, '.env.example');
const palette = {
  cyan: (text: string) => `\u001b[36m${text}\u001b[0m`,
  magenta: (text: string) => `\u001b[35m${text}\u001b[0m`,
  yellow: (text: string) => `\u001b[33m${text}\u001b[0m`,
  green: (text: string) => `\u001b[32m${text}\u001b[0m`,
  gray: (text: string) => `\u001b[90m${text}\u001b[0m`,
};

const banner = `
${palette.cyan('╔══════════════════════════════════════════════════════════════╗')}
${palette.cyan('║')}  ${palette.magenta('Hashnet MCP DX Quickstart')}                             ${palette.cyan('║')}
${palette.cyan('║')}  ${palette.gray('Zero-friction setup for the Registry Broker MCP server')}    ${palette.cyan('║')}
${palette.cyan('╚══════════════════════════════════════════════════════════════╝')}
`;

async function main() {
  console.log(banner);
  ensureNodeVersion();
  await ensureEnv();
  const rl = readline.createInterface({ input, output });
  const key = await rl.question(`${palette.yellow('→')} Enter your ${palette.magenta('REGISTRY_BROKER_API_KEY')} (press enter to skip): `);
  if (key.trim()) {
    setEnvValue('REGISTRY_BROKER_API_KEY', key.trim());
    console.log(`${palette.green('✓')} Saved API key to .env`);
  }
  const transportAnswer = await rl.question(`${palette.yellow('→')} Preferred transport [${palette.cyan('sse/stdio')} default sse]: `);
  const transport = transportAnswer.trim().toLowerCase() === 'stdio' ? 'stdio' : 'sse';
  rl.close();

  await runStep('sync dependencies', ['pnpm', ['install']]);
  await runStep('build server & cli', ['pnpm', ['build']]);
  await runStep('run smoke tests', ['pnpm', ['test:run']]);

  console.log(`\n${palette.green('All systems go!')} 🚀`);
  console.log(`${palette.gray('Launching dev server in 3 seconds. Hit Ctrl+C to exit when done.')}`);
  await delay(3000);
  const script = transport === 'stdio' ? 'dev:stdio' : 'dev:sse';
  const child = spawn('pnpm', ['run', script], {
    cwd: projectRoot,
    stdio: 'inherit',
    env: { ...process.env, MCP_TRANSPORT: transport },
  });
  child.on('exit', (code) => {
    if (code === 0) {
      console.log(`${palette.green('✔')} Dev server stopped gracefully.`);
    } else {
      console.error(`${palette.magenta('!')} Dev server exited with code ${code}`);
    }
  });
}

function ensureNodeVersion() {
  const major = Number(process.versions.node.split('.')[0]);
  if (Number.isNaN(major) || major < 18) {
    console.error('Node.js 18+ is required.');
    process.exit(1);
  }
  console.log(`${palette.green('✓')} Node ${process.versions.node} detected`);
}

async function ensureEnv() {
  if (!existsSync(envPath)) {
    if (!existsSync(envExamplePath)) {
      mkdirSync(path.dirname(envPath), { recursive: true });
      writeFileSync(envPath, '', 'utf8');
      return;
    }
    copyFileSync(envExamplePath, envPath);
    console.log(`${palette.green('✓')} Generated .env from template`);
  } else {
    console.log(`${palette.green('✓')} Found existing .env`);
  }
}

function setEnvValue(key: string, value: string) {
  const lines = existsSync(envPath) ? readFileSync(envPath, 'utf8').split(/\r?\n/) : [];
  const updated = [] as string[];
  let replaced = false;
  for (const line of lines) {
    if (line.startsWith(`${key}=`)) {
      updated.push(`${key}=${value}`);
      replaced = true;
    } else if (line.trim().length) {
      updated.push(line);
    }
  }
  if (!replaced) {
    updated.push(`${key}=${value}`);
  }
  writeFileSync(envPath, updated.join('\n') + '\n', 'utf8');
}

async function runStep(label: string, command: [string, string[]]) {
  console.log(`\n${palette.cyan('➤')} ${palette.magenta(label)}`);
  return new Promise<void>((resolve, reject) => {
    const proc = spawn(command[0], command[1], { cwd: projectRoot, stdio: 'inherit' });
    proc.on('exit', (code) => {
      if (code === 0) {
        console.log(`${palette.green('✓')} ${label}`);
        resolve();
      } else {
        reject(new Error(`${label} failed with code ${code}`));
      }
    });
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
