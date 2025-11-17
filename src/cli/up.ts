import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(dirname, '../..');

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
const transport = (flags.transport ?? 'stdio').toLowerCase();
const installOnly = Boolean(flags['install-only']);
const preferStderr = transport === 'stdio';
const logInfo = (...messages: any[]) => (preferStderr ? console.error(...messages) : console.log(...messages));
const logWarn = (...messages: any[]) => (preferStderr ? console.error(...messages) : console.warn(...messages));

try {
  ensureNodeVersion();
  const packageManager = detectPackageManager(preferStderr);
  ensurePnpmConfig();
  installDependencies(packageManager, preferStderr);
  ensureEnvFile();

  if (installOnly) {
    logInfo('Dependencies installed. Skipping server launch (--install-only set).');
    process.exit(0);
  }

  runServer(packageManager, transport, preferStderr);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

function printHelp() {
  console.log(`Usage: npx @hol-org/hashnet-mcp up [options]\n\nOptions:\n  --transport <stdio|sse>  Choose the transport to start (default: stdio)\n  --install-only          Install deps and sync .env, then exit\n  -h, --help              Show this help message`);
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

function ensureNodeVersion() {
  const major = Number(process.versions.node.split('.')[0]);
  if (Number.isNaN(major) || major < 18) {
    throw new Error(`Node.js 18+ is required (detected ${process.versions.node}).`);
  }
}

function detectPackageManager(preferStderr: boolean): 'pnpm' | 'npm' {
  if (commandExists('pnpm')) {
    return 'pnpm';
  }

  logWarn('pnpm not detected. Attempting to enable via corepack...');
  const enabled = spawnSync('corepack', ['enable', 'pnpm'], {
    stdio: preferStderr ? ['ignore', 'pipe', 'inherit'] : 'inherit',
  });
  if (preferStderr && enabled.stdout?.length) {
    process.stderr.write(enabled.stdout);
  }
  if (enabled.status === 0 && commandExists('pnpm')) {
    return 'pnpm';
  }

  logWarn('Falling back to npm. Install pnpm globally for faster installs.');
  return 'npm';
}

function commandExists(bin: string) {
  try {
    const result = spawnSync(bin, ['--version'], { stdio: 'ignore' });
    return result.status === 0;
  } catch {
    return false;
  }
}

function installDependencies(pm: 'pnpm' | 'npm', preferStderr: boolean) {
  logInfo(`Installing dependencies with ${pm}...`);
  const baseEnv = {
    ...process.env,
    NODE_OPTIONS: process.env.NODE_OPTIONS ?? '--max-old-space-size=8192',
  };

  const npmArgs = ['install', '--legacy-peer-deps'];

  const installResult = spawnSync(pm, pm === 'pnpm' ? ['install'] : npmArgs, {
    cwd: projectRoot,
    stdio: preferStderr ? ['ignore', 'pipe', 'inherit'] : 'inherit',
    env: baseEnv,
  });
  if (preferStderr && installResult.stdout?.length) {
    process.stderr.write(installResult.stdout);
  }
  if (installResult.status !== 0) {
    throw new Error(`${pm} install failed.`);
  }
}

function ensurePnpmConfig() {
  const npmrcPath = path.join(projectRoot, '.npmrc');
  if (existsSync(npmrcPath)) {
    return;
  }

  const content = [
    'node-linker=isolated',
    'shamefully-hoist=false',
    'strict-peer-dependencies=false',
    'auto-install-peers=false',
    'resolution-mode=lowest-direct',
    'node-options=--max-old-space-size=8192',
    'child-concurrency=4',
  ].join('\n');

  writeFileSync(npmrcPath, content);
}

function ensureEnvFile() {
  const envPath = path.join(projectRoot, '.env');
  const examplePath = path.join(projectRoot, '.env.example');
  if (!existsSync(envPath) && existsSync(examplePath)) {
    copyFileSync(examplePath, envPath);
    logInfo('Created .env from .env.example. Remember to fill in your credentials.');
  }
}

function runServer(pm: 'pnpm' | 'npm', transport: string, preferStderr: boolean) {
  if (!['stdio', 'sse'].includes(transport)) {
    throw new Error(`Unsupported transport "${transport}". Use stdio or sse.`);
  }
  const distEntry = path.join(projectRoot, 'dist', 'index.js');
  const env = { ...process.env, MCP_TRANSPORT: transport };

  if (!existsSync(distEntry)) {
    logInfo('dist/index.js not found. Building project before start...');
    const buildResult = spawnSync(pm, ['run', 'build'], {
      cwd: projectRoot,
      stdio: preferStderr ? ['ignore', 'pipe', 'inherit'] : 'inherit',
      env,
    });
    if (preferStderr && buildResult.stdout?.length) {
      process.stderr.write(buildResult.stdout);
    }
    if (buildResult.status !== 0) {
      throw new Error(`${pm} run build exited with code ${buildResult.status}`);
    }
  }

  logInfo(`Starting ${transport} transport via ${pm} run start...`);
  const child = spawnSync(pm, ['run', 'start'], {
    cwd: projectRoot,
    stdio: 'inherit',
    env,
  });
  if (child.status !== 0) {
    throw new Error(`${pm} run start exited with code ${child.status}`);
  }
}
