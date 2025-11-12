#!/usr/bin/env tsx
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import type { CreditPurchaseResponse } from '@hashgraphonline/standards-sdk';
import { registrationPipeline } from '../src/workflows/registration';
import { chatPipeline } from '../src/workflows/chat';
import { opsPipeline } from '../src/workflows/ops';
import { assertEnvVars } from '../src/workflows/env';
import { isInsufficientCreditsError } from '../src/workflows/errors';
import type { CreditShortfallSummary } from '../src/workflows/errors';
import { config as appConfig } from '../src/config';
import { withBroker } from '../src/broker';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

interface Answers {
  displayName: string;
  alias: string;
  description: string;
  connectionUrl: string;
  chatMessage: string;
  outputPath: string;
  additionalRegistries: string[];
}

async function main() {
  ensureCliEnv();
  const answers = await collectAnswers();
  const basePayload = await loadTemplate();

  const profile = basePayload.profile ?? {};
  profile.display_name = answers.displayName || profile.display_name;
  profile.alias = answers.alias || profile.alias;
  profile.bio = answers.description || profile.bio;
  profile.mcpServer = profile.mcpServer ?? {};
  profile.mcpServer.connectionInfo = profile.mcpServer.connectionInfo ?? {};
  profile.mcpServer.connectionInfo.url = answers.connectionUrl || profile.mcpServer.connectionInfo.url;
  profile.mcpServer.connectionInfo.transport = 'http';
  basePayload.profile = profile;

  if (answers.additionalRegistries.length > 0) {
    basePayload.additionalRegistries = answers.additionalRegistries;
  } else {
    delete basePayload.additionalRegistries;
  }

  const report = {
    startedAt: new Date().toISOString(),
    uaid: null as string | null,
    steps: [] as Array<{ name: string; status: 'ok' | 'error'; message?: string }>,
  };

  try {
    const registrationResult = await runRegistrationWithCredits(basePayload);
    report.steps.push({ name: 'workflow.registerMcp', status: 'ok' });
    report.uaid = registrationResult.context.uaid ?? null;

    let chatResult: unknown = null;
    let opsResult: unknown = null;
    if (report.uaid) {
      chatResult = await chatPipeline.run({ uaid: report.uaid, message: answers.chatMessage });
      report.steps.push({ name: 'workflow.chatSmoke', status: 'ok' });
      opsResult = await opsPipeline.run({});
      report.steps.push({ name: 'workflow.opsCheck', status: 'ok' });
    }

    await saveReport(answers.outputPath, report, registrationResult, chatResult, opsResult, answers);

    console.log(`Workflow complete. Report written to ${answers.outputPath}`);
    if (report.uaid) {
      console.log(`UAID: ${report.uaid}`);
    }
  } catch (error) {
    report.steps.push({ name: 'workflow.registerMcp', status: 'error', message: (error as Error).message });
    await saveReport(answers.outputPath, report, null, null, null, answers);
    console.error('Workflow failed:', error);
    process.exit(1);
  }
}

const REQUIRED_CLI_ENV = ['REGISTRY_BROKER_API_KEY'];

function ensureCliEnv() {
  try {
    assertEnvVars(REQUIRED_CLI_ENV, 'workflow.register');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(1);
  }
}

async function collectAnswers(): Promise<Answers> {
  const rl = readline.createInterface({ input, output });
  const displayName = await rl.question('Display name [Hashnet MCP Server]: ');
  const alias = await rl.question('Alias [hashnet-mcp]: ');
  const description = await rl.question('Short description: ');
  const connectionUrl = await rl.question('Public MCP URL [http://localhost:3333/mcp/stream]: ');
  const chatMessage = await rl.question('Chat smoke message [Hello from workflow]: ');
  const registriesRaw = await rl.question('Additional registries (comma separated) []: ');
  const outputPath = (await rl.question('Report path [workflow-register-report.json]: ')) || 'workflow-register-report.json';
  rl.close();

  const additionalRegistries =
    registriesRaw
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0) ?? [];

  return {
    displayName: displayName || 'Hashnet MCP Server',
    alias: alias || 'hashnet-mcp',
    description,
    connectionUrl: connectionUrl || 'http://localhost:3333/mcp/stream',
    chatMessage: chatMessage || 'Hello from workflow.register',
    outputPath,
    additionalRegistries,
  };
}

async function loadTemplate() {
  const templatePath = path.join(projectRoot, 'examples', 'agent-registration-request.json');
  try {
    const raw = await readFile(templatePath, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`Failed to load template at ${templatePath}: ${(error as Error).message}`);
  }
}

async function saveReport(
  filepath: string,
  summary: any,
  registrationResult: any,
  chatResult: any,
  opsResult: any,
  answers: Answers,
) {
  const claudeSnippet = {
    mcpServers: {
      [answers.alias || 'hashnet-mcp']: {
        command: 'pnpm',
        args: ['dev:sse'],
        env: {
          REGISTRY_BROKER_API_URL: process.env.REGISTRY_BROKER_API_URL ?? '',
        },
        connectionUrl: answers.connectionUrl,
      },
    },
  };

  const report = {
    summary,
    claudeConfigSnippet: claudeSnippet,
    registrationResult,
    chatResult,
    opsResult,
  };
  await writeFile(path.resolve(filepath), JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

async function runRegistrationWithCredits(payload: Record<string, unknown>) {
  while (true) {
    try {
      return await registrationPipeline.run({ payload });
    } catch (error) {
      if (isInsufficientCreditsError(error)) {
        await handleCreditShortfall(error.summary, payload);
        continue;
      }
      throw error;
    }
  }
}

async function handleCreditShortfall(summary: CreditShortfallSummary, payload: Record<string, unknown>) {
  console.error('\nInsufficient registry credits detected.');
  console.error(
    `Required: ${summary.requiredCredits} • Available: ${summary.availableCredits} • Shortfall: ${summary.shortfallCredits}`,
  );
  if (!appConfig.hederaAccountId || !appConfig.hederaPrivateKey) {
    throw new Error(
      'Registry credits are insufficient and no Hedera wallet is configured. Top up credits via the dashboard or set HEDERA_ACCOUNT_ID/HEDERA_PRIVATE_KEY to enable automatic purchases.',
    );
  }
  const plan = calculatePurchasePlan(summary);
  const consent = await promptYesNo(
    `Purchase ~${plan.hbarAmount} ℏ worth of credits from account ${appConfig.hederaAccountId}? (y/N): `,
  );
  if (!consent) {
    throw new Error('Registration aborted: credits insufficient and purchase declined.');
  }
  const receipt = await purchaseCredits(plan, summary);
  console.log(
    `Purchased ${receipt.credits} credits for ${receipt.hbarAmount} ℏ (tx ${receipt.transactionId}). Waiting for settlement...`,
  );
  await waitForCreditsToSettle(payload);
  console.log('Credits confirmed. Continuing registration.\n');
}

interface PurchasePlan {
  creditsNeeded: number;
  hbarAmount: number;
}

function calculatePurchasePlan(summary: CreditShortfallSummary): PurchasePlan {
  const creditsNeeded = Math.max(1, Math.ceil(summary.shortfallCredits));
  const creditsPerHbar = summary.creditsPerHbar ?? null;
  let hbarAmount: number | null = null;
  if (creditsPerHbar && creditsPerHbar > 0) {
    hbarAmount = calculateHbarAmount(creditsNeeded, creditsPerHbar);
  } else if (summary.estimatedHbar && summary.estimatedHbar > 0) {
    hbarAmount = summary.estimatedHbar;
  }
  if (!hbarAmount) {
    throw new Error('Broker quote did not include pricing info to purchase credits automatically.');
  }
  return { creditsNeeded, hbarAmount };
}

function calculateHbarAmount(creditsToPurchase: number, creditsPerHbar: number): number {
  if (creditsPerHbar <= 0) {
    throw new Error('creditsPerHbar must be positive to request a purchase.');
  }
  const tinybars = Math.ceil((creditsToPurchase / creditsPerHbar) * 1e8);
  if (tinybars <= 0) {
    throw new Error('Calculated HBAR amount is invalid.');
  }
  return tinybars / 1e8;
}

async function purchaseCredits(plan: PurchasePlan, summary: CreditShortfallSummary): Promise<CreditPurchaseResponse> {
  if (!appConfig.hederaAccountId || !appConfig.hederaPrivateKey) {
    throw new Error('Hedera credentials missing; cannot purchase credits automatically.');
  }
  return withBroker((client) =>
    client.purchaseCreditsWithHbar({
      accountId: appConfig.hederaAccountId,
      privateKey: appConfig.hederaPrivateKey,
      hbarAmount: plan.hbarAmount,
      memo: 'hashnet-mcp workflow register top-up',
      metadata: {
        requestedCredits: plan.creditsNeeded,
        shortfall: summary.shortfallCredits,
        registry: summary.registry,
        protocol: summary.protocol,
      },
    }),
  );
}

async function waitForCreditsToSettle(payload: Record<string, unknown>) {
  while (true) {
    await sleep(3_000);
    const quote = await withBroker((client) => client.getRegistrationQuote(payload));
    const shortfall = Math.max(0, quote.shortfallCredits ?? 0);
    if (shortfall <= 0) {
      console.log(`Broker now reports ${quote.availableCredits ?? 0} credits available.`);
      return;
    }
    const continueWaiting = await promptYesNo(
      `Credits not posted yet (shortfall ${shortfall}). Continue waiting? (y/N): `,
    );
    if (!continueWaiting) {
      throw new Error('Credits purchase pending settlement. Re-run the workflow once the balance updates.');
    }
  }
}

async function promptYesNo(question: string) {
  const rl = readline.createInterface({ input, output });
  const answer = (await rl.question(question)).trim().toLowerCase();
  rl.close();
  return answer === 'y' || answer === 'yes';
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
