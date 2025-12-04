import {
  type ChatConversationHandle,
  type ClientEncryptionOptions,
  type EnsureAgentKeyOptions,
  type InitializeAgentClientOptions,
  type RegistryBrokerClientOptions,
  RegistryBrokerClient,
  RegistryBrokerError,
} from '@hashgraphonline/standards-sdk';
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
  baseUrl: normalizeRegistryUrl(config.registryBrokerUrl),
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

type EncryptionClientOptions = {
  uaid: string;
  ensureEncryptionKey?: boolean | EnsureAgentKeyOptions;
  encryption?: ClientEncryptionOptions;
};

const encryptionClientCache = new Map<string, Promise<RegistryBrokerClient>>();
const conversationHandleCache = new Map<string, ChatConversationHandle>();

const buildEncryptionClientKey = (options: EncryptionClientOptions): string => {
  const autoDecrypt = options.encryption?.autoDecryptHistory ? 'decrypt' : 'nodecrypt';
  const ensureLabel =
    typeof options.ensureEncryptionKey === 'object' ? options.ensureEncryptionKey.label ?? '' : options.ensureEncryptionKey ? 'ensure' : 'skip';
  return `${options.uaid}:${autoDecrypt}:${ensureLabel}`;
};

const resolveEncryptionInitOptions = (options: EncryptionClientOptions): InitializeAgentClientOptions => {
  const ensureEncryptionKey =
    options.ensureEncryptionKey === undefined
      ? { uaid: options.uaid, generateIfMissing: true }
      : options.ensureEncryptionKey;
  const encryption: ClientEncryptionOptions =
    options.encryption ??
    {
      autoDecryptHistory: true,
    };
  const base: RegistryBrokerClientOptions = {
    baseUrl: normalizeRegistryUrl(config.registryBrokerUrl),
    apiKey: config.registryBrokerApiKey,
    fetchImplementation: undiciFetch as unknown as typeof fetch,
    encryption,
  };
  return { ...base, uaid: options.uaid, ensureEncryptionKey };
};

async function getEncryptedClient(options: EncryptionClientOptions): Promise<RegistryBrokerClient> {
  if (!config.registryBrokerApiKey) {
    throw new Error('REGISTRY_BROKER_API_KEY is required to use encrypted chat helpers.');
  }
  const key = buildEncryptionClientKey(options);
  const cached = encryptionClientCache.get(key);
  if (cached) return cached;
  const clientPromise = RegistryBrokerClient.initializeAgent(resolveEncryptionInitOptions(options)).then((result) => result.client);
  encryptionClientCache.set(key, clientPromise);
  return clientPromise;
}

export async function withEncryptedBroker<T>(
  options: EncryptionClientOptions,
  task: BrokerTask<T>,
  label?: string,
): Promise<T> {
  const run = async () => {
    try {
      const client = await getEncryptedClient(options);
      return await task(client);
    } catch (error) {
      throw formatBrokerError(error, label);
    }
  };
  if (brokerLimiter) {
    return brokerLimiter.schedule(run);
  }
  return run();
}

const conversationKey = (sessionId: string, uaid: string) => `${sessionId}:${uaid}`;

export function cacheConversationHandle(sessionId: string, uaid: string, handle: ChatConversationHandle): void {
  conversationHandleCache.set(conversationKey(sessionId, uaid), handle);
}

export function getCachedConversationHandle(sessionId: string, uaid: string): ChatConversationHandle | undefined {
  return conversationHandleCache.get(conversationKey(sessionId, uaid));
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

function normalizeRegistryUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    // Map legacy host to the canonical hol registry host.
    if (parsed.hostname === 'registry.hashgraphonline.com') {
      parsed.hostname = 'hol.org';
      parsed.pathname = '/registry/api/v1';
      parsed.search = '';
      parsed.hash = '';
      return stripTrailingSlash(parsed.toString());
    }
    // Ensure path ends with /api/v1
    const cleanPath = parsed.pathname.replace(/\/+$/, '');
    parsed.pathname = cleanPath.endsWith('/api/v1') ? cleanPath : `${cleanPath || ''}/api/v1`;
    return stripTrailingSlash(parsed.toString());
  } catch {
    // Fallback to raw URL if parsing fails.
    return rawUrl;
  }
}

function stripTrailingSlash(value: string) {
  return value.endsWith('/') ? value.slice(0, -1) : value;
}
