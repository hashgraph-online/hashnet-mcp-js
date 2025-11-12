#!/usr/bin/env tsx
import { ask, runWorkflow } from './run-generic';

async function prompt() {
  const query = await ask('ERC-8004 query [erc]: ', 'erc');
  const limit = Number(await ask('Limit [5]: ', '5'));
  return { query, limit };
}

runWorkflow('workflow.erc8004Discovery', { query: 'erc', limit: 5 }, prompt);
