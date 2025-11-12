#!/usr/bin/env tsx
import { ask, runWorkflow } from './run-generic';

async function prompt() {
  const query = await ask('Discovery query [hashnet]: ', 'hashnet');
  const message = await ask('Chat message (optional): ');
  const performCreditCheck = (await ask('Perform credit quote? (y/N): ')).toLowerCase().startsWith('y');
  return { query, message: message || undefined, performCreditCheck };
}

runWorkflow('workflow.registryBrokerShowcase', { query: 'hashnet' }, prompt);
