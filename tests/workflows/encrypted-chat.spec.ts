import { beforeEach, describe, expect, it, vi } from 'vitest';

process.env.REGISTRY_BROKER_API_KEY = process.env.REGISTRY_BROKER_API_KEY ?? 'test-api-key';

const requesterHandle = {
  sessionId: 'session-123',
  mode: 'encrypted' as const,
  send: vi.fn().mockResolvedValue({ ok: true }),
  decryptHistoryEntry: () => null,
};

const responderHandle = {
  sessionId: 'session-123',
  mode: 'encrypted' as const,
  send: vi.fn().mockResolvedValue({ ok: true }),
  decryptHistoryEntry: () => null,
};

const requesterClient = {
  encryption: {
    ensureAgentKey: vi.fn().mockResolvedValue({ ensured: true }),
  },
  chat: {
    startConversation: vi.fn().mockResolvedValue(requesterHandle),
    acceptConversation: vi.fn().mockResolvedValue(requesterHandle),
    getHistory: vi
      .fn()
      .mockResolvedValue({ history: [], decryptedHistory: [{ plaintext: 'hi', entry: { role: 'user', content: 'cipher' } }] }),
    endSession: vi.fn().mockResolvedValue({ ended: true }),
  },
};

const responderClient = {
  encryption: {
    ensureAgentKey: vi.fn().mockResolvedValue({ ensured: true }),
  },
  chat: {
    startConversation: vi.fn().mockResolvedValue(responderHandle),
    acceptConversation: vi.fn().mockResolvedValue(responderHandle),
    getHistory: vi
      .fn()
      .mockResolvedValue({ history: [], decryptedHistory: [{ plaintext: 'reply', entry: { role: 'agent', content: 'cipher' } }] }),
    endSession: vi.fn().mockResolvedValue({ ended: true }),
  },
};

const cacheConversationHandle = vi.fn();

const withEncryptedBrokerMock = vi.fn(
  async <T>(options: { uaid: string }, task: (client: typeof requesterClient) => Promise<T>) => {
    const client = options.uaid === 'uaid:responder' ? responderClient : requesterClient;
    return task(client as any);
  },
);

vi.mock('../../src/broker', () => ({
  withEncryptedBroker: withEncryptedBrokerMock,
  cacheConversationHandle,
}));

const { encryptedChatWorkflow } = await import('../../src/workflows/encrypted-chat');

describe('encryptedChatWorkflow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('runs encrypted chat handshake, sends messages, and fetches decrypted history', async () => {
    const result = await encryptedChatWorkflow.run({
      requesterUaid: 'uaid:requester',
      responderUaid: 'uaid:responder',
      requesterMessage: 'hello secure world',
      responderMessage: 'acknowledged',
    });

    expect(requesterClient.encryption.ensureAgentKey).toHaveBeenCalled();
    expect(responderClient.encryption.ensureAgentKey).toHaveBeenCalled();
    expect(requesterClient.chat.startConversation).toHaveBeenCalledWith(
      expect.objectContaining({ uaid: 'uaid:responder', senderUaid: 'uaid:requester' }),
    );
    expect(responderClient.chat.acceptConversation).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 'session-123', responderUaid: 'uaid:responder' }),
    );
    expect(requesterHandle.send).toHaveBeenCalledWith(expect.objectContaining({ plaintext: 'hello secure world' }));
    expect(responderHandle.send).toHaveBeenCalledWith(expect.objectContaining({ plaintext: 'acknowledged' }));
    expect(requesterClient.chat.getHistory).toHaveBeenCalled();
    expect(responderClient.chat.getHistory).toHaveBeenCalled();
    expect(result.context.sessionId).toBe('session-123');
  });
});
