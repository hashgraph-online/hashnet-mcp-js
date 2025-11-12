#!/usr/bin/env tsx
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { registrationPipeline } from '../src/workflows/registration';
import { chatPipeline } from '../src/workflows/chat';
import { opsPipeline } from '../src/workflows/ops';

if (!process.env.BROKER_E2E) {
  console.log('BROKER_E2E not set. Skipping agent workflow test.');
  process.exit(0);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

async function main() {
  const payload = await loadTemplate();
  const registration = await registrationPipeline.run({ payload });
  if (!registration.context.uaid) {
    throw new Error('Registration pipeline did not yield a UAID.');
  }
  const chat = await chatPipeline.run({ uaid: registration.context.uaid, message: 'Hello from workflow:e2e' });
  const ops = await opsPipeline.run({});

  const report = {
    uaid: registration.context.uaid,
    steps: {
      registration,
      chat,
      ops,
    },
  };
  console.log(JSON.stringify(report, null, 2));
}

async function loadTemplate() {
  const filePath = path.join(projectRoot, 'examples', 'agent-registration-request.json');
  const raw = await readFile(filePath, 'utf8');
  return JSON.parse(raw);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
