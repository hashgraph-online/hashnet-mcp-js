import { RegistryBrokerClient, RegistryBrokerError } from '@hashgraphonline/standards-sdk';
import Bottleneck from 'bottleneck';
import IORedis from 'ioredis';
import { fetch as undiciFetch } from 'undici';
import type { Response as UndiciResponse } from 'undici';
import { config } from './config';

const autoTopUpConfig = config.autoTopUpEnabled
  ? {
      accountId: config.hederaAccountId!,
      privateKey: config.hederaPrivateKey!,
      memo: 'mcp-autotopup',
    }
  : undefined;

const broker = new RegistryBrokerClient({
  baseUrl: config.registryBrokerUrl,
  apiKey: config.registryBrokerApiKey,
  fetchImplementation: undiciFetch as unknown as typeof fetch,
  registrationAutoTopUp: autoTopUpConfig,
  historyAutoTopUp: autoTopUpConfig,
});

const brokerLimiter = createLimiter();

function createLimiter() {
  if (!config.rateLimit) return undefined;

  const redisClient = config.rateLimit.redis?.url ? new IORedis(config.rateLimit.redis.url) : undefined;
  const limiterOptions: Bottleneck.ConstructorOptions = {
    ...(config.rateLimit.maxConcurrent !== undefined
      ? { maxConcurrent: config.rateLimit.maxConcurrent }
      : {}),
    ...(config.rateLimit.minTimeMs !== undefined
      ? { minTime: config.rateLimit.minTimeMs }
      : {}),
    ...(config.rateLimit.reservoir !== undefined
      ? { reservoir: config.rateLimit.reservoir }
      : {}),
    ...(config.rateLimit.reservoirRefreshAmount !== undefined
      ? { reservoirRefreshAmount: config.rateLimit.reservoirRefreshAmount }
      : {}),
    ...(config.rateLimit.reservoirRefreshIntervalMs !== undefined
      ? { reservoirRefreshInterval: config.rateLimit.reservoirRefreshIntervalMs }
      : {}),
    ...(redisClient ? { datastore: 'ioredis' as const, connection: redisClient as unknown as Bottleneck.IORedisConnection } : {}),
  };

  if (
    !limiterOptions.maxConcurrent &&
    !limiterOptions.minTime &&
    !limiterOptions.reservoir &&
    !limiterOptions.datastore
  ) {
    return undefined;
  }

  return new Bottleneck(limiterOptions);
}

type BrokerTask<T> = (client: RegistryBrokerClient) => Promise<T>;

export async function withBroker<T>(task: BrokerTask<T>, label?: string): Promise<T> {
  const run = async () => {
    if (!config.registryBrokerApiKey) {
      throw new Error('REGISTRY_BROKER_API_KEY is required to call the registry broker. Set it in your environment or .env file.');
    }
    try {
      return await task(broker);
    } catch (error) {
      throw formatBrokerError(error, label);
    }
  };
  if (brokerLimiter) {
    return brokerLimiter.schedule(run);
  }
  return run();
}

export { broker, brokerLimiter };

export interface CreditBalanceResponse {
  accountId: string;
  balance: number;
  timestamp: string;
}

export async function getCreditBalance(accountId?: string): Promise<CreditBalanceResponse> {
  if (!config.registryBrokerApiKey) {
    throw new Error('REGISTRY_BROKER_API_KEY is required to fetch credit balances.');
  }
  const base = config.registryBrokerUrl.endsWith('/') ? config.registryBrokerUrl : `${config.registryBrokerUrl}/`;
  const url = new URL('credits/balance', base);
  if (accountId) {
    url.searchParams.set('accountId', accountId);
  }
  const headers: Record<string, string> = {
    accept: 'application/json',
    'x-api-key': config.registryBrokerApiKey,
  };
  const request = async () => {
    const response = await undiciFetch(url, { method: 'GET', headers });
    if (!response.ok) {
      const hint = await safeReadBody(response);
      throw new Error(`Failed to fetch credit balance (${response.status}): ${hint ?? response.statusText}`);
    }
    return (await response.json()) as CreditBalanceResponse;
  };
  if (brokerLimiter) {
    return brokerLimiter.schedule(request);
  }
  return request();
}

async function safeReadBody(response: Response | UndiciResponse) {
  try {
    const text = await (response as any).text();
    return text || undefined;
  } catch {
    return undefined;
  }
}

function formatBrokerError(error: unknown, label?: string): Error {
  if (error instanceof RegistryBrokerError) {
    const body =
      typeof error.body === 'object'
        ? JSON.stringify(error.body)
        : error.body
          ? String(error.body)
          : 'no response body';
    const statusText = error.statusText ? ` ${error.statusText}` : '';
    const prefix = label ? `${label} failed` : 'Registry broker request failed';
    return new Error(`${prefix} (${error.status}${statusText}): ${body}`);
  }
  return error instanceof Error ? error : new Error(String(error));
}
