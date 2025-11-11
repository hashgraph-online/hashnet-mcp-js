import { beforeEach, describe, expect, it, vi } from 'vitest';

const createdClients: Array<{ instance: ReturnType<typeof createClient>; options: Record<string, unknown> }> = [];
const redisCtor = vi.fn((url: string) => ({ url }));
const bottleneckInstances: any[] = [];

function createClient() {
  return {
    search: vi.fn().mockResolvedValue('ok'),
  };
}

vi.mock('@hashgraphonline/standards-sdk', () => ({
  RegistryBrokerClient: vi.fn((options: Record<string, unknown>) => {
    const instance = createClient();
    createdClients.push({ instance, options });
    return instance;
  }),
}));

vi.mock('ioredis', () => ({
  default: redisCtor,
}));

vi.mock('bottleneck', () => ({
  default: vi.fn(function MockBottleneck(this: any, options: Record<string, unknown>) {
    this.options = options;
    this.schedule = vi.fn((task: () => unknown) => task());
    bottleneckInstances.push(this);
  }),
}));

const baseConfig = {
  registryBrokerUrl: 'https://registry.test',
  registryBrokerApiKey: undefined,
  hederaAccountId: undefined,
  hederaPrivateKey: undefined,
  port: 3333,
  autoTopUpEnabled: false,
  rateLimit: undefined,
};

const mockConfig = (overrides: Partial<typeof baseConfig> = {}) => {
  vi.doMock('../../src/config', () => ({
    config: {
      ...baseConfig,
      ...overrides,
    },
  }));
};

describe('broker helpers', () => {
  beforeEach(() => {
    vi.resetModules();
    createdClients.length = 0;
    redisCtor.mockClear();
    bottleneckInstances.length = 0;
  });

  it('executes tasks immediately when no limiter is configured', async () => {
    mockConfig();
    const { withBroker } = await import('../../src/broker');
    const result = await withBroker(async (client) => {
      await client.search('ping');
      return 'done';
    });
    expect(result).toBe('done');
    expect(createdClients).toHaveLength(1);
    expect(createdClients[0].instance.search).toHaveBeenCalledWith('ping');
  });

  it('passes auto top-up credentials to the client', async () => {
    mockConfig({
      autoTopUpEnabled: true,
      hederaAccountId: '0.0.123',
      hederaPrivateKey: 'private-key',
    });
    const { withBroker } = await import('../../src/broker');
    await withBroker(async () => 'ok');
    expect(createdClients[0]?.options.registrationAutoTopUp).toEqual({
      accountId: '0.0.123',
      privateKey: 'private-key',
      memo: 'mcp-autotopup',
    });
  });

  it('schedules calls through bottleneck when configured', async () => {
    mockConfig({ rateLimit: { maxConcurrent: 1 } as any });
    const { brokerLimiter, withBroker } = await import('../../src/broker');
    expect(brokerLimiter).toBeTruthy();
    const scheduleSpy = vi.spyOn(brokerLimiter!, 'schedule');
    await withBroker(async (client) => client.search('limited'));
    expect(scheduleSpy).toHaveBeenCalledTimes(1);
  });

  it('initializes redis datastore when URL is provided', async () => {
    mockConfig({ rateLimit: { redis: { url: 'redis://127.0.0.1:6379' } } as any });
    await import('../../src/broker');
    expect(redisCtor).toHaveBeenCalledWith('redis://127.0.0.1:6379');
    expect(bottleneckInstances[0]?.options.datastore).toBe('ioredis');
  });

  it('returns undefined limiter when no options survive', async () => {
    mockConfig({ rateLimit: {} as any });
    const { brokerLimiter } = await import('../../src/broker');
    expect(brokerLimiter).toBeUndefined();
    expect(bottleneckInstances).toHaveLength(0);
  });

  it('applies reservoir-based rate limit settings', async () => {
    mockConfig({
      rateLimit: {
        minTimeMs: 25,
        reservoir: 10,
        reservoirRefreshAmount: 5,
        reservoirRefreshIntervalMs: 500,
      } as any,
    });
    await import('../../src/broker');
    const options = bottleneckInstances[0]?.options;
    expect(options).toMatchObject({
      minTime: 25,
      reservoir: 10,
      reservoirRefreshAmount: 5,
      reservoirRefreshInterval: 500,
    });
  });
});
