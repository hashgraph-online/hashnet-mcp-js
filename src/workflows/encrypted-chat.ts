import type { AgentAuthConfig, ChatConversationHandle } from '@hashgraphonline/standards-sdk';
import { cacheConversationHandle, withEncryptedBroker } from '../broker';
import { registerPipeline } from './registry';
import type { PipelineDefinition } from './types';
import { loadMemoryContext, recordMemory } from './utils/memory';

interface EncryptedChatInput {
  requesterUaid: string;
  responderUaid: string;
  requesterAuth?: AgentAuthConfig;
  responderAuth?: AgentAuthConfig;
  requesterMessage?: string;
  responderMessage?: string;
  disableMemory?: boolean;
}

interface EncryptedChatContext {
  sessionId?: string;
  requesterHandle?: ChatConversationHandle;
  responderHandle?: ChatConversationHandle;
  historySnapshots: unknown[];
  memoryOptOut?: boolean;
}

const encryptedChatDefinition: PipelineDefinition<EncryptedChatInput, EncryptedChatContext> = {
  name: 'workflow.encryptedChat',
  description: 'Establish encrypted chat between two UAIDs, exchange messages, fetch decrypted history, and close the session.',
  version: '1.0.0',
  requiredEnv: ['REGISTRY_BROKER_API_KEY'],
  createContext: (input) => ({
    historySnapshots: [],
    memoryOptOut: input.disableMemory,
  }),
  steps: [
    {
      name: 'workflow.encryptedChat.memory.load',
      skip: ({ input }) => Boolean(input.disableMemory),
      run: async ({ input, context }) => {
        const scope = { uaid: input.requesterUaid, sessionId: context.sessionId };
        return (await loadMemoryContext({ scope, optOut: context.memoryOptOut })) ?? { skipped: true };
      },
    },
    {
      name: 'hol.chat.ensureEncryptionKey.requester',
      allowDuringDryRun: true,
      run: async ({ input }) =>
        withEncryptedBroker(
          { uaid: input.requesterUaid, ensureEncryptionKey: { uaid: input.requesterUaid, generateIfMissing: true }, encryption: { autoDecryptHistory: true } },
          (client) => client.encryption.ensureAgentKey({ uaid: input.requesterUaid, generateIfMissing: true, label: 'workflow.encryptedChat.requester' }),
        ),
    },
    {
      name: 'hol.chat.ensureEncryptionKey.responder',
      allowDuringDryRun: true,
      run: async ({ input }) =>
        withEncryptedBroker(
          { uaid: input.responderUaid, ensureEncryptionKey: { uaid: input.responderUaid, generateIfMissing: true }, encryption: { autoDecryptHistory: true } },
          (client) => client.encryption.ensureAgentKey({ uaid: input.responderUaid, generateIfMissing: true, label: 'workflow.encryptedChat.responder' }),
        ),
    },
    {
      name: 'hol.chat.startEncryptedConversation',
      run: async ({ input, context }) => {
        const conversation = await withEncryptedBroker(
          { uaid: input.requesterUaid, ensureEncryptionKey: { uaid: input.requesterUaid, generateIfMissing: true }, encryption: { autoDecryptHistory: true } },
          async (client) => {
            let sessionFromCallback: string | undefined;
            const handle = await client.chat.startConversation({
              uaid: input.responderUaid,
              senderUaid: input.requesterUaid,
              auth: input.requesterAuth,
              encryption: { preference: 'required' },
              onSessionCreated: (sessionId) => {
                sessionFromCallback = sessionId;
              },
            });
            const sessionId = sessionFromCallback ?? handle.sessionId;
            if (sessionId) {
              cacheConversationHandle(sessionId, input.requesterUaid, handle);
            }
            return handle;
          },
          'workflow.encryptedChat.start',
        );
        context.sessionId = context.sessionId ?? conversation.sessionId;
        context.requesterHandle = conversation;
        return conversation;
      },
    },
    {
      name: 'hol.chat.acceptEncryptedConversation',
      run: async ({ input, context }) => {
        if (!context.sessionId) throw new Error('Missing sessionId from start conversation step.');
        const conversation = await withEncryptedBroker(
          { uaid: input.responderUaid, ensureEncryptionKey: { uaid: input.responderUaid, generateIfMissing: true }, encryption: { autoDecryptHistory: true } },
          (client) =>
            client.chat.acceptConversation({
              sessionId: context.sessionId!,
              responderUaid: input.responderUaid,
              encryption: { preference: 'required' },
            }),
          'workflow.encryptedChat.accept',
        );
        cacheConversationHandle(context.sessionId, input.responderUaid, conversation);
        context.responderHandle = conversation;
        return conversation;
      },
    },
    {
      name: 'hol.chat.sendEncrypted.requester',
      run: async ({ input, context }) => {
        if (!context.sessionId || !context.requesterHandle) throw new Error('Missing conversation handle for requester.');
        const message = input.requesterMessage ?? 'Hello from requester (encrypted)';
        await recordMemory({
          scope: { uaid: input.requesterUaid, sessionId: context.sessionId },
          role: 'user',
          content: message,
          toolName: 'workflow.encryptedChat',
          optOut: context.memoryOptOut,
        });
        const response = await context.requesterHandle.send({
          plaintext: message,
          auth: input.requesterAuth,
        });
        await recordMemory({
          scope: { uaid: input.requesterUaid, sessionId: context.sessionId },
          role: 'assistant',
          content: JSON.stringify(response),
          toolName: 'workflow.encryptedChat',
          optOut: context.memoryOptOut,
        });
        return response;
      },
    },
    {
      name: 'hol.chat.history.decrypted.after-requester',
      allowDuringDryRun: true,
      run: async ({ input, context }) => {
        if (!context.sessionId) throw new Error('Missing sessionId for history fetch.');
        const history = await withEncryptedBroker(
          { uaid: input.requesterUaid, encryption: { autoDecryptHistory: true } },
          (client) => client.chat.getHistory(context.sessionId!, { decrypt: true }),
          'workflow.encryptedChat.history.requester',
        );
        context.historySnapshots.push({ requester: history });
        await recordMemory({
          scope: { uaid: input.requesterUaid, sessionId: context.sessionId },
          role: 'event',
          content: JSON.stringify({ requesterHistory: history }),
          toolName: 'workflow.encryptedChat',
          optOut: context.memoryOptOut,
        });
        return history;
      },
    },
    {
      name: 'hol.chat.sendEncrypted.responder',
      run: async ({ input, context }) => {
        if (!context.sessionId || !context.responderHandle) throw new Error('Missing conversation handle for responder.');
        const message = input.responderMessage ?? 'Responder received your message and replies securely.';
        await recordMemory({
          scope: { uaid: input.responderUaid, sessionId: context.sessionId },
          role: 'user',
          content: message,
          toolName: 'workflow.encryptedChat',
          optOut: context.memoryOptOut,
        });
        const response = await context.responderHandle.send({
          plaintext: message,
          auth: input.responderAuth,
        });
        await recordMemory({
          scope: { uaid: input.responderUaid, sessionId: context.sessionId },
          role: 'assistant',
          content: JSON.stringify(response),
          toolName: 'workflow.encryptedChat',
          optOut: context.memoryOptOut,
        });
        return response;
      },
    },
    {
      name: 'hol.chat.history.decrypted.final',
      allowDuringDryRun: true,
      run: async ({ input, context }) => {
        if (!context.sessionId) throw new Error('Missing sessionId for final history fetch.');
        const requesterHistory = await withEncryptedBroker(
          { uaid: input.requesterUaid, encryption: { autoDecryptHistory: true } },
          (client) => client.chat.getHistory(context.sessionId!, { decrypt: true }),
          'workflow.encryptedChat.history.final.requester',
        );
        const responderHistory = await withEncryptedBroker(
          { uaid: input.responderUaid, encryption: { autoDecryptHistory: true } },
          (client) => client.chat.getHistory(context.sessionId!, { decrypt: true }),
          'workflow.encryptedChat.history.final.responder',
        );
        context.historySnapshots.push({ requesterHistory, responderHistory });
        await recordMemory({
          scope: { uaid: input.requesterUaid, sessionId: context.sessionId },
          role: 'event',
          content: JSON.stringify({ requesterHistory, responderHistory }),
          toolName: 'workflow.encryptedChat',
          optOut: context.memoryOptOut,
        });
        return { requesterHistory, responderHistory };
      },
    },
    {
      name: 'hol.chat.end',
      allowDuringDryRun: true,
      run: async ({ input, context }) => {
        if (!context.sessionId) throw new Error('Missing sessionId when attempting to end session.');
        return withEncryptedBroker({ uaid: input.requesterUaid }, (client) => client.chat.endSession(context.sessionId!));
      },
    },
  ],
};

export const encryptedChatWorkflow = registerPipeline(encryptedChatDefinition);
