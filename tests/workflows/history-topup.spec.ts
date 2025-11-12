import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RegistryBrokerError } from '@hashgraphonline/standards-sdk';

process.env.REGISTRY_BROKER_API_KEY = process.env.REGISTRY_BROKER_API_KEY ?? 'test-api-key';

const chatNamespace = {
  createSession: vi.fn().mockResolvedValue({ sessionId: 'session-1' }),
  sendMessage: vi.fn().mockResolvedValue({ ok: true }),
  getHistory: vi.fn().mockResolvedValue([{ role: 'user', content: 'hi' }]),
  compactHistory: vi.fn(),
};

const client = {
  chat: chatNamespace,
  purchaseCreditsWithHbar: vi.fn().mockResolvedValue({ credits: 50 }),
};

const withBrokerMock = vi.fn((fn: (client: typeof client) => Promise<unknown>) => fn(client));

vi.mock('../../src/broker', () => ({
  withBroker: withBrokerMock,
}));

const { historyTopUpWorkflow } = await import('../../src/workflows/history-topup');

describe('historyTopUpWorkflow', () => {
  beforeEach(() => {
    withBrokerMock.mockClear();
    chatNamespace.createSession.mockClear();
    chatNamespace.sendMessage.mockClear();
    chatNamespace.getHistory.mockClear();
    chatNamespace.compactHistory.mockReset();
    client.purchaseCreditsWithHbar.mockClear();
  });

  it('purchases credits when compact fails with 402 and retries compaction', async () => {
    chatNamespace.compactHistory
      .mockRejectedValueOnce(new RegistryBrokerError('credits', { status: 402, statusText: 'Payment Required', body: {} }))
      .mockResolvedValueOnce({ pruned: 2 });

    const result = await historyTopUpWorkflow.run({
      uaid: 'uaid:demo',
      creditTopUp: { accountId: '0.0.1', privateKey: 'key', hbarAmount: 0.5 },
    });

    expect(client.purchaseCreditsWithHbar).toHaveBeenCalled();
    expect(chatNamespace.compactHistory).toHaveBeenCalledTimes(2);
    expect(result.context.compactions).toHaveLength(1);
  });
});
