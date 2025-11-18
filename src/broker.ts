import { RegistryBrokerClient, RegistryBrokerError } from '@hashgraphonline/standards-sdk';
import Bottleneck from 'bottleneck';
import IORedis from 'ioredis';
import { fetch as undiciFetch } from 'undici';
import { config } from './config';

const broker = new RegistryBrokerClient({
  baseUrl: config.registryBrokerUrl,
  apiKey: config.registryBrokerApiKey,
  registrationAutoTopUp: config.autoTopUpEnabled
    ? {
        accountId: config.hederaAccountId!,
        privateKey: config.hederaPrivateKey!,
        memo: 'mcp-autotopup',
      }
    : undefined,
});

const brokerLimiter = createLimiter();

function createLimiter() {
  if (!config.rateLimit) return undefined;

  const limiterOptions: Bottleneck.ConstructorOptions = {};

  if (config.rateLimit.maxConcurrent !== undefined) {
    limiterOptions.maxConcurrent = config.rateLimit.maxConcurrent;
  }
  if (config.rateLimit.minTimeMs !== undefined) {
    limiterOptions.minTime = config.rateLimit.minTimeMs;
  }
  if (config.rateLimit.reservoir !== undefined) {
    limiterOptions.reservoir = config.rateLimit.reservoir;
  }
  if (config.rateLimit.reservoirRefreshAmount !== undefined) {
    limiterOptions.reservoirRefreshAmount = config.rateLimit.reservoirRefreshAmount;
  }
  if (config.rateLimit.reservoirRefreshIntervalMs !== undefined) {
    limiterOptions.reservoirRefreshInterval = config.rateLimit.reservoirRefreshIntervalMs;
  }

  if (config.rateLimit.redis?.url) {
    limiterOptions.datastore = 'ioredis';
    limiterOptions.connection = new IORedis(config.rateLimit.redis.url);
  }

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

async function safeReadBody(response: Response) {
  try {
    const text = await response.text();
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
