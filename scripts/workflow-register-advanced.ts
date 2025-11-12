#!/usr/bin/env tsx
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import type { AgentRegistrationRequest } from '@hashgraphonline/standards-sdk';
import type { RegisterAgentAdvancedInput } from '../src/workflows/register-advanced';
import { registerAgentAdvancedPipeline } from '../src/workflows/register-advanced';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

interface Answers {
  additionalRegistries: string;
  updateRegistries: string;
  skipUpdate: boolean;
  autoTopUp: boolean;
  hbarAmount?: number;
  accountId?: string;
  privateKey?: string;
  localAgentMode: 'none' | 'local' | 'external';
  localAgentPort?: string;
  externalEndpoint?: string;
  reportPath: string;
}

async function main() {
  const payload = await loadTemplate();
  const answers = await collectAnswers();

  decorateMetadata(payload, answers);

  const advancedInput: RegisterAgentAdvancedInput = {
    payload,
    additionalRegistrySelections: parseList(answers.additionalRegistries),
    updateAdditionalRegistries: parseList(answers.updateRegistries),
    skipUpdate: answers.skipUpdate,
    creditTopUp: answers.autoTopUp
      ? {
          accountId: answers.accountId!,
          privateKey: answers.privateKey!,
          hbarAmount: answers.hbarAmount,
        }
      : undefined,
  };

  const result = await registerAgentAdvancedPipeline.run(advancedInput);
  await writeFile(path.resolve(answers.reportPath), JSON.stringify(result, null, 2));
  console.log(`Workflow complete. Report written to ${answers.reportPath}`);
}

async function collectAnswers(): Promise<Answers> {
  const rl = readline.createInterface({ input, output });
  const additionalRegistries = await rl.question('Additional registries (comma separated, leave blank for none): ');
  const updateRegistries = await rl.question('Update registries after registration (comma separated, blank to skip): ');
  const skipUpdate = (await rl.question('Skip update step? (y/N): ')).trim().toLowerCase().startsWith('y');
  const autoTopUp = (await rl.question('Auto purchase credits with HBAR if needed? (y/N): ')).trim().toLowerCase().startsWith('y');
  let accountId: string | undefined;
  let privateKey: string | undefined;
  let hbarAmount: number | undefined;
  if (autoTopUp) {
    accountId = (await rl.question('Hedera account ID for top-up: ')).trim();
    privateKey = (await rl.question('Hedera private key: ')).trim();
    const amount = (await rl.question('HBAR amount per purchase [0.25]: ')).trim();
    hbarAmount = amount ? Number(amount) : undefined;
  }
  const agentModeAnswer = (await rl.question('Use local A2A agent? (none/local/external) [none]: ')).trim().toLowerCase();
  const localAgentMode = agentModeAnswer === 'local' ? 'local' : agentModeAnswer === 'external' ? 'external' : 'none';
  let localAgentPort: string | undefined;
  let externalEndpoint: string | undefined;
  if (localAgentMode === 'local') {
    localAgentPort = (await rl.question('Local agent port [9000]: ')).trim() || '9000';
  } else if (localAgentMode === 'external') {
    externalEndpoint = await rl.question('External agent endpoint URL: ');
  }
  const reportPath = (await rl.question('Report path [workflow-register-advanced-report.json]: ')).trim() || 'workflow-register-advanced-report.json';
  rl.close();

  return {
    additionalRegistries,
    updateRegistries,
    skipUpdate,
    autoTopUp,
    hbarAmount,
    accountId,
    privateKey,
    localAgentMode,
    localAgentPort,
    externalEndpoint,
    reportPath,
  };
}

function parseList(value?: string) {
  if (!value) return [];
  return value
    .split(/[\s,]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function decorateMetadata(payload: AgentRegistrationRequest, answers: Answers) {
  payload.metadata = payload.metadata ?? {};
  if (answers.localAgentMode === 'local') {
    payload.metadata.localAgent = { mode: 'local', port: answers.localAgentPort };
  } else if (answers.localAgentMode === 'external') {
    payload.metadata.localAgent = { mode: 'external', endpoint: answers.externalEndpoint };
  }
}

async function loadTemplate() {
  const templatePath = path.join(projectRoot, 'examples', 'agent-registration-request.json');
  const raw = await readFile(templatePath, 'utf8');
  return JSON.parse(raw);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
