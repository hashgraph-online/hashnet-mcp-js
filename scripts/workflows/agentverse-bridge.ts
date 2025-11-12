#!/usr/bin/env tsx
import { ask, runWorkflow } from './run-generic';

async function prompt() {
  const uaid = await ask('Local UAID: ');
  const agentverseUaid = await ask('Agentverse UAID: ');
  const localMessage = await ask('Message to local UAID [Hello local]: ', 'Hello local');
  const agentverseMessage = await ask('Message to Agentverse UAID [Hello agentverse]: ', 'Hello agentverse');
  const iterations = Number(await ask('Iterations [1]: ', '1'));
  return { uaid, agentverseUaid, localMessage, agentverseMessage, iterations };
}

runWorkflow('workflow.agentverseBridge', { uaid: '', agentverseUaid: '', localMessage: '', agentverseMessage: '' }, prompt);
