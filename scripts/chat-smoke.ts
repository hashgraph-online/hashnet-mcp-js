import 'dotenv/config';
import { RegistryBrokerClient, RegistryBrokerError } from '@hashgraphonline/standards-sdk';

type CliOptions = {
  uaid: string;
  message: string;
  authToken?: string;
  historyTtlSeconds: number;
  topUp: boolean;
  hbarAmount: number;
  accountId?: string;
  privateKey?: string;
};

const parseArgs = (): CliOptions => {
  const args = process.argv.slice(2);
  const lookup = (flag: string) => {
    const index = args.findIndex((arg) => arg === flag || arg.startsWith(`${flag}=`));
    if (index === -1) return undefined;
    const value = args[index].includes('=') ? args[index].split('=')[1] : args[index + 1];
    return value;
  };
  const uaid = lookup('--uaid') ?? process.env.CHAT_SMOKE_UAID;
  if (!uaid) {
    throw new Error('Provide --uaid or set CHAT_SMOKE_UAID');
  }
  const message = lookup('--message') ?? 'Hello from scripts/chat-smoke.ts';
  const authToken = lookup('--auth-token') ?? process.env.OPENROUTER_API_KEY;
  const ttlRaw = lookup('--history-ttl') ?? process.env.CHAT_HISTORY_TTL_SECONDS;
  const historyTtlSeconds = ttlRaw ? Number(ttlRaw) : 900;
  const topUp = args.includes('--top-up') || args.includes('--topup');
  const hbarAmountRaw = lookup('--hbar') ?? process.env.HISTORY_COMPACTION_TOP_UP_HBAR;
  const hbarAmount = hbarAmountRaw ? Number(hbarAmountRaw) : 0.25;
  const accountId = lookup('--account-id') ?? process.env.HEDERA_ACCOUNT_ID;
  const privateKey = lookup('--private-key') ?? process.env.HEDERA_PRIVATE_KEY;
  return { uaid, message, authToken, historyTtlSeconds, topUp, hbarAmount, accountId, privateKey };
};

const log = (msg: string, extra?: unknown) => {
  if (extra !== undefined) {
    console.log(msg, extra);
    return;
  }
  console.log(msg);
};

const describeError = (error: unknown): string => {
  if (error instanceof RegistryBrokerError) {
    const body =
      typeof error.body === 'object'
        ? JSON.stringify(error.body)
        : error.body
          ? String(error.body)
          : 'no body';
    return `Registry broker error ${error.status} (${error.statusText}): ${body}`;
  }
  if (error instanceof Error) return error.message;
  return String(error);
};

const run = async () => {
  const opts = parseArgs();
  const baseUrl =
    process.env.REGISTRY_BROKER_API_URL?.trim() ?? 'https://registry.hashgraphonline.com/api/v1';
  const apiKey = process.env.REGISTRY_BROKER_API_KEY?.trim();
  if (!apiKey) {
    throw new Error('REGISTRY_BROKER_API_KEY is required to run chat smoke.');
  }

  log('=== chat-smoke ===');
  log(`Broker: ${baseUrl}`);
  log(`UAID:   ${opts.uaid}`);

  const auth = opts.authToken ? { type: 'bearer' as const, token: opts.authToken } : undefined;
  const client = new RegistryBrokerClient({ baseUrl, apiKey });

  log('\nOpening session...');
  const session = await client.chat.createSession({
    uaid: opts.uaid,
    auth,
    historyTtlSeconds: opts.historyTtlSeconds,
  });
  log(`Session: ${session.sessionId}`);

  log('\nSending message...');
  const sendResponse = await client.chat.sendMessage({
    sessionId: session.sessionId,
    auth,
    message: opts.message,
  });
  log('Agent response:', sendResponse.message ?? JSON.stringify(sendResponse));

  log('\nFetching history...');
  const history = await client.chat.getHistory(session.sessionId);
  log(`History entries: ${history.history?.length ?? 0}`);

  const attemptCompaction = async () => {
    log('\nAttempting history compaction...');
    const result = await client.chat.compactHistory({ sessionId: session.sessionId, preserveEntries: 4 });
    log('Compaction summary:', result.summaryEntry?.content ?? 'no summary');
  };

  try {
    await attemptCompaction();
  } catch (error) {
    if (error instanceof RegistryBrokerError && error.status === 402) {
      log('Insufficient credits for compaction.');
      if (!opts.topUp) {
        log('Skipping top-up (pass --top-up with Hedera credentials to enable).');
        return;
      }
      if (!opts.accountId || !opts.privateKey) {
        throw new Error('Top-up requested but missing Hedera account/private key.');
      }
      log(`Purchasing ${opts.hbarAmount}ℏ for compaction...`);
      await client.purchaseCreditsWithHbar({
        accountId: opts.accountId,
        privateKey: opts.privateKey,
        hbarAmount: opts.hbarAmount,
        memo: 'chat-smoke-compaction',
        metadata: { sessionId: session.sessionId },
      });
      await attemptCompaction();
      return;
    }
    throw error;
  }
};

run().catch((error) => {
  console.error('chat-smoke failed:', describeError(error));
  process.exitCode = 1;
});
