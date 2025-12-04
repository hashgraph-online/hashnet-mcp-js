import { beforeEach, describe, expect, it, vi } from 'vitest';

process.env.REGISTRY_BROKER_API_KEY = process.env.REGISTRY_BROKER_API_KEY ?? 'test-api-key';

const recordEntryMock = vi.fn();

const chatClient = {
  createSession: vi.fn().mockResolvedValue({ sessionId: 'session-xyz' }),
  sendMessage: vi.fn().mockResolvedValue({ message: 'ok' }),
  getHistory: vi.fn().mockResolvedValue({ history: [{ role: 'assistant', content: 'hi' }] }),
  compactHistory: vi.fn().mockResolvedValue({ pruned: 1 }),
  endSession: vi.fn().mockResolvedValue({ ended: true }),
};

const withBrokerMock = vi.fn((fn: (client: { chat: typeof chatClient }) => Promise<unknown>) => fn({ chat: chatClient }));

vi.mock('../../src/broker', () => ({
  withBroker: withBrokerMock,
}));

vi.mock('../../src/workflows/utils/memory', () => ({
  loadMemoryContext: vi.fn().mockResolvedValue({ entries: [] }),
  recordMemory: (...args: unknown[]) => recordEntryMock(...args),
}));

const { chatPipeline } = await import('../../src/workflows/chat');

describe('workflow.chatSmoke', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('runs the chat lifecycle (create, send, history, compact, end)', async () => {
    const result = await chatPipeline.run({ uaid: 'uaid:demo', message: 'hello world' });

    expect(withBrokerMock).toHaveBeenCalled();
    expect(chatClient.createSession).toHaveBeenCalledWith({ uaid: 'uaid:demo', historyTtlSeconds: 60, auth: undefined });
    expect(chatClient.sendMessage).toHaveBeenCalledWith({
      sessionId: 'session-xyz',
      message: 'hello world',
      uaid: 'uaid:demo',
      auth: undefined,
    });
    expect(chatClient.getHistory).toHaveBeenCalledWith('session-xyz');
    expect(chatClient.compactHistory).toHaveBeenCalledWith({ sessionId: 'session-xyz', preserveEntries: 2 });
    expect(chatClient.endSession).toHaveBeenCalledWith('session-xyz');
    expect(recordEntryMock).toHaveBeenCalled();
    expect(result.context.sessionId).toBe('session-xyz');
  });
});
