import { RegistryBrokerClient } from '@hashgraphonline/standards-sdk';
import Bottleneck from 'bottleneck';
import IORedis from 'ioredis';
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

export async function withBroker<T>(task: BrokerTask<T>): Promise<T> {
  if (brokerLimiter) {
    return brokerLimiter.schedule(() => task(broker));
  }
  return task(broker);
}

export { broker, brokerLimiter };
