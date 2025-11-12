#!/usr/bin/env tsx
import { ask, runWorkflow } from './run-generic';

async function prompt() {
  const payloadPath = await ask('Registration payload path [examples/agent-registration-request.json]: ', 'examples/agent-registration-request.json');
  const ercNetworks = await ask('ERC-8004 networks (comma separated): ');
  const accountId = await ask('X402 account ID: ');
  const credits = Number(await ask('Credits to purchase [25]: ', '25'));
  const evmPrivateKey = await ask('EVM private key: ');
  const chatMessage = await ask('Chat message after registration (optional): ');
  const payload = JSON.parse(await Bun.file(payloadPath).text());
  return {
    payload,
    erc8004Networks: ercNetworks ? ercNetworks.split(',').map((s) => s.trim()) : undefined,
    creditPurchase: { accountId, credits, evmPrivateKey },
    chatMessage: chatMessage || undefined,
  };
}

runWorkflow('workflow.erc8004X402', { payload: {} as any, creditPurchase: { accountId: '', credits: 0, evmPrivateKey: '' } }, prompt);
