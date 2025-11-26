import { defineConfig } from 'tsup';

const shared = {
  bundle: true,
  splitting: false,
  treeshake: true,
  minify: true,
  platform: 'node',
  format: ['cjs'],
  target: 'node18',
  sourcemap: false,
  outExtension() {
    return { js: '.cjs' };
  },
  noExternal: [
    '@hashgraphonline/standards-sdk',
    '@hono/node-server',
    '@modelcontextprotocol/sdk',
    'bottleneck',
    'dotenv',
    'fastmcp',
    'hono',
    'ioredis',
    'pino',
    'undici',
    'zod',
  ],
  external: ['better-sqlite3', 'effect', 'sury', '@valibot/to-json-schema'],
} as const;

export default defineConfig([
  {
    ...shared,
    entry: ['src/index.ts'],
    outDir: 'dist',
    dts: true,
    clean: true,
  },
  {
    ...shared,
    entry: { up: 'src/cli/up.ts' },
    outDir: 'dist/cli',
    dts: false,
    banner: { js: '#!/usr/bin/env node' },
    clean: false,
  },
]);
