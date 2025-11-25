import { beforeEach, describe, expect, it, vi } from 'vitest';

process.env.REGISTRY_BROKER_API_KEY = process.env.REGISTRY_BROKER_API_KEY ?? 'test-api-key';

const chatNamespace = {
  createSession: vi.fn().mockResolvedValue({ sessionId: 'session-1' }),
  sendMessage: vi.fn().mockResolvedValue({ ok: true }),
  getHistory: vi.fn().mockResolvedValue([{ role: 'assistant', content: 'hi' }]),
  compactHistory: vi.fn().mockResolvedValue({ pruned: 1 }),
  endSession: vi.fn().mockResolvedValue({ ended: true }),
};

const client = { chat: chatNamespace };
const withBrokerMock = vi.fn((fn: (client: typeof client) => Promise<unknown>) => fn(client));

const memoryMock = {
  isEnabled: vi.fn(() => true),
  getContext: vi.fn().mockResolvedValue({ entries: [], summary: null }),
  recordEntry: vi.fn().mockResolvedValue(undefined),
};

vi.mock('../../src/broker', () => ({
  withBroker: withBrokerMock,
}));

vi.mock('../../src/memory', () => ({
  memoryService: memoryMock,
}));

const { chatPipeline } = await import('../../src/workflows/chat');

describe('workflow memory hooks', () => {
  beforeEach(() => {
    withBrokerMock.mockClear();
    chatNamespace.createSession.mockClear();
    chatNamespace.sendMessage.mockClear();
    chatNamespace.getHistory.mockClear();
    chatNamespace.compactHistory.mockClear();
    chatNamespace.endSession.mockClear();
    memoryMock.getContext.mockClear();
    memoryMock.recordEntry.mockClear();
    memoryMock.isEnabled.mockReturnValue(true);
  });

  it('loads and records memory when enabled', async () => {
    const result = await chatPipeline.run({ uaid: 'uaid:demo', message: 'hello' }, { dryRun: false });

    expect(result.steps.find((step) => step.name === 'workflow.chatSmoke.memory.load')?.skipped).toBeFalsy();
    expect(memoryMock.getContext).toHaveBeenCalled();
    expect(memoryMock.recordEntry).toHaveBeenCalled();
  });

  it('skips memory when disabled or opted out', async () => {
    memoryMock.isEnabled.mockReturnValue(false);
    const result = await chatPipeline.run({ uaid: 'uaid:demo', message: 'hello', disableMemory: true }, { dryRun: false });

    expect(result.steps.find((step) => step.name === 'workflow.chatSmoke.memory.load')?.skipped).toBe(true);
    expect(memoryMock.getContext).not.toHaveBeenCalled();
    expect(memoryMock.recordEntry).not.toHaveBeenCalled();
  });
});
