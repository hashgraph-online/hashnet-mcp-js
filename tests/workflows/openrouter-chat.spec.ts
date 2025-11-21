import { describe, expect, it, vi, beforeEach } from 'vitest';

process.env.REGISTRY_BROKER_API_KEY = process.env.REGISTRY_BROKER_API_KEY ?? 'test-api-key';

const client = {
  search: vi.fn().mockResolvedValue({ hits: [{ uaid: 'uaid:openrouter' }] }),
  chat: {
    createSession: vi.fn().mockResolvedValue({ sessionId: 'session-1' }),
    sendMessage: vi.fn().mockResolvedValue({ message: 'ok' }),
    getHistory: vi.fn().mockResolvedValue([{ role: 'assistant', content: 'hi' }]),
    endSession: vi.fn().mockResolvedValue({ ended: true }),
  },
};

const withBrokerMock = vi.fn((fn: (client: typeof client) => Promise<unknown>) => fn(client));

vi.mock('../../src/broker', () => ({
  withBroker: withBrokerMock,
}));

const { openRouterChatWorkflow } = await import('../../src/workflows/openrouter-chat');

describe('openRouterChatWorkflow', () => {
  beforeEach(() => {
    withBrokerMock.mockClear();
    client.search.mockClear();
    client.chat.createSession.mockClear();
    client.chat.sendMessage.mockClear();
    client.chat.getHistory.mockClear();
    client.chat.endSession.mockClear();
  });

  it('searches model, creates session, sends message, and ends chat', async () => {
    const result = await openRouterChatWorkflow.run({ modelId: 'anthropic/claude', message: 'hello' });
    expect(client.search).toHaveBeenCalled();
    expect(client.chat.createSession).toHaveBeenCalledWith({
      uaid: 'uaid:openrouter',
      historyTtlSeconds: 900,
      auth: undefined,
    });
    expect(client.chat.sendMessage).toHaveBeenCalledWith({
      sessionId: 'session-1',
      auth: undefined,
      message: 'hello',
    });
    expect(client.chat.endSession).toHaveBeenCalledWith('session-1');
    expect(result.context.uaid).toBe('uaid:openrouter');
  });
});
