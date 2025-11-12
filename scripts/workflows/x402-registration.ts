#!/usr/bin/env tsx
import { ask, runWorkflow } from './run-generic';

async function prompt() {
  const payloadPath = await ask('Registration payload path [examples/agent-registration-request.json]: ', 'examples/agent-registration-request.json');
  const accountId = await ask('X402 account ID: ');
  const credits = Number(await ask('Credits [50]: ', '50'));
  const evmPrivateKey = await ask('EVM private key: ');
  const chatMessage = await ask('Chat message after registration (optional): ');
  const payload = JSON.parse(await Bun.file(payloadPath).text());
  return {
    payload,
    x402: { accountId, credits, evmPrivateKey },
    chatMessage: chatMessage || undefined,
  };
}

runWorkflow('workflow.x402Registration', { payload: {} as any, x402: { accountId: '', credits: 0, evmPrivateKey: '' } }, prompt);
