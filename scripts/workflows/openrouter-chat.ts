#!/usr/bin/env tsx
import { ask, runWorkflow } from './run-generic';

async function prompt() {
  const modelId = await ask('Model ID [anthropic/claude-3.5-sonnet]: ', 'anthropic/claude-3.5-sonnet');
  const registry = await ask('Registry [openrouter]: ', 'openrouter');
  const message = await ask('Message [Describe capabilities]: ', 'Describe capabilities');
  const authToken = await ask('OpenRouter API token (leave blank to skip auth): ');
  return { modelId, registry, message, authToken: authToken || undefined };
}

runWorkflow('workflow.openrouterChat', { modelId: '', message: '' }, prompt);
