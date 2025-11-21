import { beforeEach, describe, expect, it, vi } from 'vitest';

process.env.REGISTRY_BROKER_API_KEY = process.env.REGISTRY_BROKER_API_KEY ?? 'test-api-key';

const client = {
  search: vi.fn().mockResolvedValue({ hits: [{ uaid: 'uaid:demo' }] }),
  vectorSearch: vi.fn().mockResolvedValue([]),
  resolveUaid: vi.fn().mockResolvedValue({ agent: { endpoints: ['https://agent.example.com'] } }),
  listProtocols: vi.fn().mockResolvedValue(['proto']),
  detectProtocol: vi.fn().mockResolvedValue({ protocol: 'mcp' }),
  stats: vi.fn().mockResolvedValue({ total: 1 }),
  metricsSummary: vi.fn().mockResolvedValue({ latencyP50: 10 }),
  dashboardStats: vi.fn().mockResolvedValue({ active: 1 }),
  websocketStats: vi.fn().mockResolvedValue({ connections: 1 }),
  getRegistrationQuote: vi.fn().mockResolvedValue({ requiredCredits: 10 }),
  chat: {
    createSession: vi.fn().mockResolvedValue({ sessionId: 'session-1' }),
    sendMessage: vi.fn().mockResolvedValue({ message: 'hi' }),
    getHistory: vi.fn().mockResolvedValue([]),
    compactHistory: vi.fn().mockResolvedValue({ pruned: 2 }),
    endSession: vi.fn().mockResolvedValue({ ended: true }),
  },
};

const withBrokerMock = vi.fn((fn: (client: typeof client) => Promise<unknown>) => fn(client));

vi.mock('../../src/broker', () => ({
  withBroker: withBrokerMock,
}));

const { registryBrokerShowcaseWorkflow } = await import('../../src/workflows/registry-showcase');

describe('registryBrokerShowcaseWorkflow', () => {
  beforeEach(() => {
    withBrokerMock.mockClear();
    Object.values(client).forEach((value) => {
      if (typeof value === 'function') {
        value.mockClear();
      } else if (value && typeof value === 'object') {
        Object.values(value).forEach((v) => (v as any).mockClear && (v as any).mockClear());
      }
    });
  });

  it('runs discovery, analytics, and chat sections', async () => {
    const result = await registryBrokerShowcaseWorkflow.run({ query: 'hashnet', message: 'hello', performCreditCheck: true });
    expect(client.listProtocols).toHaveBeenCalled();
    expect(client.detectProtocol).toHaveBeenCalled();
    expect(client.stats).toHaveBeenCalled();
    expect(client.metricsSummary).toHaveBeenCalled();
    expect(client.dashboardStats).toHaveBeenCalled();
    expect(client.websocketStats).toHaveBeenCalled();
    expect(client.chat.createSession).toHaveBeenCalled();
    expect(client.getRegistrationQuote).toHaveBeenCalled();
    expect(result.context.discovery).toBeTruthy();
  });
});
