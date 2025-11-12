#!/usr/bin/env tsx
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import type { AgentRegistrationRequest, LedgerVerifyRequest } from '@hashgraphonline/standards-sdk';
import { registerAgentErc8004Pipeline } from '../src/workflows/register-erc8004';
import type { RegisterAgentErc8004Input } from '../src/workflows/register-erc8004';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

interface Answers {
  networks: string;
  updateNetworks: string;
  skipUpdate: boolean;
  creditTopUp: boolean;
  accountId?: string;
  privateKey?: string;
  hbarAmount?: number;
  ledgerVerify?: LedgerVerifyRequest;
  reportPath: string;
}

async function main() {
  const payload = await loadTemplate();
  const answers = await collectAnswers();
  const ercInput: RegisterAgentErc8004Input = {
    payload,
    erc8004Networks: parseList(answers.networks),
    updateAdditionalRegistries: parseList(answers.updateNetworks),
    skipUpdate: answers.skipUpdate,
    creditTopUp: answers.creditTopUp
      ? {
          accountId: answers.accountId!,
          privateKey: answers.privateKey!,
          hbarAmount: answers.hbarAmount,
        }
      : undefined,
    ledgerVerification: answers.ledgerVerify,
  };

  const result = await registerAgentErc8004Pipeline.run(ercInput);
  await writeFile(path.resolve(answers.reportPath), JSON.stringify(result, null, 2));
  console.log(`Workflow complete. Report written to ${answers.reportPath}`);
}

async function collectAnswers(): Promise<Answers> {
  const rl = readline.createInterface({ input, output });
  const networks = await rl.question('ERC-8004 networks (comma separated, leave blank for all): ');
  const updateNetworks = await rl.question('Update registries after registration (comma separated, blank to skip): ');
  const skipUpdate = (await rl.question('Skip update step? (y/N): ')).trim().toLowerCase().startsWith('y');
  const creditTopUp = (await rl.question('Auto purchase credits with HBAR if needed? (y/N): ')).trim().toLowerCase().startsWith('y');
  let accountId: string | undefined;
  let privateKey: string | undefined;
  let hbarAmount: number | undefined;
  if (creditTopUp) {
    accountId = (await rl.question('Hedera account ID for top-up: ')).trim();
    privateKey = (await rl.question('Hedera private key: ')).trim();
    const amount = (await rl.question('HBAR amount per purchase [0.25]: ')).trim();
    hbarAmount = amount ? Number(amount) : undefined;
  }
  const shouldVerifyLedger = (await rl.question('Provide ledger verification payload? (y/N): ')).trim().toLowerCase().startsWith('y');
  let ledgerVerify: LedgerVerifyRequest | undefined;
  if (shouldVerifyLedger) {
    const challengeId = await rl.question('Ledger challenge ID: ');
    const accountIdLedger = await rl.question('Ledger account ID: ');
    const network = (await rl.question('Ledger network (mainnet/testnet): ')).trim() as 'mainnet' | 'testnet';
    const signature = await rl.question('Signature: ');
    const signatureKind = (await rl.question('Signature kind (raw/map) [raw]: ')).trim() || 'raw';
    const publicKey = (await rl.question('Public key (optional): ')).trim();
    ledgerVerify = {
      challengeId: challengeId.trim(),
      accountId: accountIdLedger.trim(),
      network,
      signature: signature.trim(),
      signatureKind: signatureKind as 'raw' | 'map',
      publicKey: publicKey || undefined,
    };
  }
  const reportPath = (await rl.question('Report path [workflow-register-erc8004-report.json]: ')).trim() || 'workflow-register-erc8004-report.json';
  rl.close();

  return {
    networks,
    updateNetworks,
    skipUpdate,
    creditTopUp,
    accountId,
    privateKey,
    hbarAmount,
    ledgerVerify,
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

async function loadTemplate() {
  const templatePath = path.join(projectRoot, 'examples', 'agent-registration-request.json');
  const raw = await readFile(templatePath, 'utf8');
  return JSON.parse(raw) as AgentRegistrationRequest;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
