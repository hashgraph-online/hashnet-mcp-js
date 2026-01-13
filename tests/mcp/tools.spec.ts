import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

process.env.REGISTRY_BROKER_API_KEY = process.env.REGISTRY_BROKER_API_KEY ?? 'test-api-key';
process.env.HEDERA_ACCOUNT_ID = process.env.HEDERA_ACCOUNT_ID ?? '0.0.1234';
process.env.HEDERA_PRIVATE_KEY =
  process.env.HEDERA_PRIVATE_KEY ?? '302e020100300506032b657004220420aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

function createFakeClient() {
  return {
    search: vi.fn().mockResolvedValue('search-result'),
    vectorSearch: vi.fn().mockResolvedValue('vector-result'),
    resolveUaid: vi.fn().mockResolvedValue('resolved'),
    validateUaid: vi.fn().mockResolvedValue('validated'),
    getUaidConnectionStatus: vi.fn().mockResolvedValue('status'),
    closeUaidConnection: vi.fn().mockResolvedValue('closed'),
    getRegistrationQuote: vi.fn().mockResolvedValue('quote'),
    registerAgent: vi.fn().mockResolvedValue('registered'),
    waitForRegistrationCompletion: vi.fn().mockResolvedValue('complete'),
    updateAgent: vi.fn().mockResolvedValue('updated'),
    getAdditionalRegistries: vi.fn().mockResolvedValue({ registries: [] }),
    registrySearchByNamespace: vi.fn().mockResolvedValue({ hits: [] }),
    chat: {
      createSession: vi.fn().mockResolvedValue({ sessionId: 'session-1' }),
      sendMessage: vi.fn().mockResolvedValue({ message: 'ok' }),
      getHistory: vi.fn().mockResolvedValue([{ role: 'user', content: 'hi' }]),
      compactHistory: vi.fn().mockResolvedValue({ pruned: 2 }),
      endSession: vi.fn().mockResolvedValue({ ended: true }),
    },
    listProtocols: vi.fn().mockResolvedValue(['protocol']),
    detectProtocol: vi.fn().mockResolvedValue({ name: 'proto' }),
    stats: vi.fn().mockResolvedValue({ total: 10 }),
    metricsSummary: vi.fn().mockResolvedValue({ latencyP50: 10 }),
    dashboardStats: vi.fn().mockResolvedValue({ active: 5 }),
    websocketStats: vi.fn().mockResolvedValue({ connections: 1 }),
    createLedgerChallenge: vi.fn().mockResolvedValue({ challengeId: 'c1', message: 'sign-me' }),
    verifyLedgerChallenge: vi.fn().mockResolvedValue({ key: 'ledger-key' }),
    purchaseCreditsWithHbar: vi.fn().mockResolvedValue({ credits: 100 }),
    getX402Minimums: vi.fn().mockResolvedValue({ minimums: {} }),
    buyCreditsWithX402: vi.fn().mockResolvedValue({ creditedCredits: 100 }),
  };
}

const { fakeClient, getCreditBalanceMock, loggerSpy, recordEntryMock, requestBrokerJsonMock, withBrokerMock } = vi.hoisted(() => {
  const fakeClient = createFakeClient();
  const getCreditBalanceMock = vi.fn().mockResolvedValue({
    accountId: '0.0.123',
    balance: 500,
    timestamp: new Date().toISOString(),
  });
  const requestBrokerJsonMock = vi.fn().mockResolvedValue('agentic-result');
  const withBrokerMock = vi.fn(
    (fn: (client: typeof fakeClient) => Promise<unknown>, _label?: string, _options?: unknown) => fn(fakeClient),
  );
  const recordEntryMock = vi.fn().mockResolvedValue(undefined);
  const loggerSpy = {
    debug: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  };
  return { fakeClient, getCreditBalanceMock, loggerSpy, recordEntryMock, requestBrokerJsonMock, withBrokerMock };
});

vi.mock('../../src/broker', () => ({
  withBroker: withBrokerMock,
  withEncryptedBroker: vi.fn((_: unknown, fn: (client: typeof fakeClient) => Promise<unknown>) => fn(fakeClient)),
  cacheConversationHandle: vi.fn(),
  getCachedConversationHandle: vi.fn().mockReturnValue(undefined),
  broker: fakeClient,
  brokerLimiter: undefined,
  getCreditBalance: getCreditBalanceMock,
  requestBrokerJson: requestBrokerJsonMock,
}));

vi.mock('../../src/memory', () => ({
  memoryService: {
    isEnabled: () => true,
    recordEntry: recordEntryMock,
  },
}));

vi.mock('../../src/logger', () => ({
  logger: loggerSpy,
}));

const { registeredTools, buildLoggedTool } = await import('../../src/mcp');

const getTool = (name: string) => {
  const tool = registeredTools.find((t) => t.name === name);
  if (!tool) {
    throw new Error(`Tool ${name} not found`);
  }
  return tool;
};

const baseRegistrationPayload = {
  profile: {
    version: '1.0.0',
    type: 2,
    display_name: 'Hashnet MCP',
    mcpServer: {
      version: '1.0.0',
      connectionInfo: { url: 'https://example.com/mcp/stream', transport: 'sse' },
      services: [0, 1],
      description: 'test',
    },
  },
};

const schemaSamples: Record<string, { valid: unknown; invalid?: unknown }> = {
  'hol.search': { valid: { q: 'agent', limit: 5 }, invalid: { limit: 0 } },
  'hol.vectorSearch': { valid: { query: 'embedding' }, invalid: { query: '' } },
  'hol.agenticSearch': { valid: { query: 'find ledger experts', limit: 5 }, invalid: { query: '' } },
  'hol.delegate.suggest': { valid: { task: 'Find a ledger authentication expert', limit: 3 }, invalid: { task: '' } },
  'hol.resolveUaid': { valid: { uaid: 'uaid-1' }, invalid: { uaid: '' } },
  'hol.closeUaidConnection': { valid: { uaid: 'uaid-1' }, invalid: { uaid: '' } },
  'hol.getRegistrationQuote': { valid: { payload: baseRegistrationPayload }, invalid: { payload: null } },
  'hol.registerAgent': { valid: { payload: baseRegistrationPayload }, invalid: { payload: undefined } },
  'hol.waitForRegistrationCompletion': {
    valid: { attemptId: 'attempt', intervalMs: 1000, timeoutMs: 2000 },
    invalid: { attemptId: 'attempt', intervalMs: 0, timeoutMs: 0 },
  },
  'hol.updateAgent': { valid: { uaid: 'uaid-1', payload: baseRegistrationPayload }, invalid: { uaid: '', payload: baseRegistrationPayload } },
  'hol.additionalRegistries': { valid: {} },
  'hol.registrySearchByNamespace': { valid: { registry: 'hashnet', query: 'mcp' }, invalid: { registry: '' } },
  'hol.chat.createSession': { valid: { uaid: 'uaid', historyTtlSeconds: 60 }, invalid: { uaid: '' } },
  'hol.chat.sendMessage': { valid: { sessionId: 's1', message: 'hello' }, invalid: { sessionId: 's1', message: '' } },
  'hol.chat.history': { valid: { sessionId: 's1' }, invalid: {} },
  'hol.chat.compact': { valid: { sessionId: 's1', preserveEntries: 2 }, invalid: { sessionId: 's1', preserveEntries: -1 } },
  'hol.chat.end': { valid: { sessionId: 's1' }, invalid: {} },
  'hol.stats': { valid: {} },
  'hol.metricsSummary': { valid: {} },
  'hol.dashboardStats': { valid: {} },
  'hol.websocketStats': { valid: {} },
  'hol.listProtocols': { valid: {} },
  'hol.detectProtocol': { valid: { headers: { 'content-type': 'application/json' }, body: '{}' }, invalid: { headers: { accept: 1 } } },
  'hol.ledger.challenge': { valid: { accountId: '0.0.123', network: 'mainnet' }, invalid: { accountId: '', network: 'foo' } },
  'hol.ledger.authenticate': {
    valid: { challengeId: 'c1', accountId: '0.0.123', network: 'testnet', signature: '0xabc' },
    invalid: { challengeId: '', accountId: '', network: 'foo', signature: '' },
  },
  'hol.purchaseCredits.hbar': {
    valid: { accountId: '0.0.123', privateKey: 'key', hbarAmount: 1.5 },
    invalid: { accountId: '', privateKey: 'key', hbarAmount: 0 },
  },
  'hol.credits.balance': {
    valid: { hederaAccountId: '0.0.123', x402AccountId: 'evm:0xabc' },
    invalid: { hederaAccountId: '' },
  },
  'hol.x402.minimums': { valid: {} },
  'hol.x402.buyCredits': {
    valid: { accountId: '0.0.123', credits: 10, evmPrivateKey: '0xabc' },
    invalid: { accountId: '', credits: 0, evmPrivateKey: '' },
  },
  'hol.memory.context': {
    valid: { scope: { uaid: 'uaid:1' }, limit: 5, includeSummary: true },
    invalid: { scope: {} },
  },
  'hol.memory.note': { valid: { scope: { sessionId: 's1' }, content: 'note' }, invalid: { scope: { sessionId: 's1' }, content: '' } },
  'hol.memory.clear': { valid: { scope: { namespace: 'demo' } }, invalid: { scope: {} } },
  'hol.memory.search': { valid: { scope: { uaid: 'uaid:1' }, query: 'hello', limit: 5 }, invalid: { scope: { uaid: 'uaid:1' }, query: '' } },
  'workflow.discovery': { valid: { query: 'hash', limit: 5 }, invalid: { limit: 0 } },
  'workflow.delegate': { valid: { task: 'Ask an agent to summarize a log', limit: 1 }, invalid: { task: '' } },
  'workflow.registerMcp': { valid: { payload: baseRegistrationPayload }, invalid: { payload: null } },
  'workflow.chatSmoke': { valid: { uaid: 'uaid-123', message: 'hi' }, invalid: { uaid: '' } },
  'workflow.opsCheck': { valid: {} },
  'workflow.fullRegistration': {
    valid: { registrationPayload: baseRegistrationPayload, discoveryQuery: 'hashnet', chatMessage: 'hello' },
    invalid: { registrationPayload: null },
  },
};

describe('mcp tool definitions', () => {
  beforeEach(() => {
    withBrokerMock.mockClear();
    getCreditBalanceMock.mockClear();
    requestBrokerJsonMock.mockClear();
    fakeClient.search.mockClear();
    fakeClient.vectorSearch.mockClear();
    fakeClient.resolveUaid.mockClear();
    fakeClient.validateUaid.mockClear();
    fakeClient.getUaidConnectionStatus.mockClear();
    fakeClient.closeUaidConnection.mockClear();
    fakeClient.getRegistrationQuote.mockClear();
    fakeClient.registerAgent.mockClear();
    fakeClient.waitForRegistrationCompletion.mockClear();
    fakeClient.updateAgent.mockClear();
    fakeClient.getAdditionalRegistries.mockClear();
    fakeClient.registrySearchByNamespace.mockClear();
    fakeClient.chat.createSession.mockClear();
    fakeClient.chat.sendMessage.mockClear();
    fakeClient.chat.getHistory.mockClear();
    fakeClient.chat.compactHistory.mockClear();
    fakeClient.chat.endSession.mockClear();
    fakeClient.listProtocols.mockClear();
    fakeClient.detectProtocol.mockClear();
    fakeClient.stats.mockClear();
    fakeClient.metricsSummary.mockClear();
    fakeClient.dashboardStats.mockClear();
    fakeClient.websocketStats.mockClear();
    fakeClient.createLedgerChallenge.mockClear();
    fakeClient.verifyLedgerChallenge.mockClear();
    fakeClient.purchaseCreditsWithHbar.mockClear();
    fakeClient.getX402Minimums.mockClear();
    fakeClient.buyCreditsWithX402.mockClear();
    recordEntryMock.mockClear();
  });

  it('registers all expected tool names', () => {
    expect(registeredTools.map((tool) => tool.name)).toEqual([
      'hol.search',
      'hol.vectorSearch',
      'hol.agenticSearch',
      'hol.delegate.suggest',
      'hol.resolveUaid',
      'hol.closeUaidConnection',
      'hol.getRegistrationQuote',
      'hol.registerAgent',
      'hol.waitForRegistrationCompletion',
      'hol.updateAgent',
      'hol.additionalRegistries',
      'hol.registrySearchByNamespace',
      'hol.chat.createSession',
      'hol.chat.sendMessage',
      'hol.chat.history',
      'hol.chat.compact',
      'hol.chat.end',
      'hol.chat.ensureEncryptionKey',
      'hol.chat.startEncryptedConversation',
      'hol.chat.acceptEncryptedConversation',
      'hol.chat.sendEncrypted',
      'hol.stats',
      'hol.metricsSummary',
      'hol.dashboardStats',
      'hol.websocketStats',
      'hol.listProtocols',
      'hol.detectProtocol',
      'hol.ledger.challenge',
      'hol.ledger.authenticate',
      'hol.purchaseCredits.hbar',
      'hol.credits.balance',
      'hol.x402.minimums',
      'hol.x402.buyCredits',
      'hol.memory.context',
      'hol.memory.note',
      'hol.memory.clear',
      'hol.memory.search',
      'workflow.discovery',
      'workflow.registerMcp',
      'workflow.chatSmoke',
      'workflow.encryptedChat',
      'workflow.opsCheck',
      'workflow.openrouterChat',
      'workflow.registryBrokerShowcase',
      'workflow.agentverseBridge',
      'workflow.erc8004Discovery',
      'workflow.erc8004X402',
      'workflow.x402Registration',
      'workflow.fullRegistration',
      'workflow.delegate',
    ]);
  });

  it.each(Object.entries(schemaSamples))('%s schema validates as expected', (name, sample) => {
    const tool = getTool(name);
    expect(tool.schema.safeParse(sample.valid).success).toBe(true);
    if (sample.invalid !== undefined) {
      expect(tool.schema.safeParse(sample.invalid).success).toBe(false);
    }
  });

  it('delegates hol.search to client.search', async () => {
    const tool = getTool('hol.search');
    const payload = schemaSamples['hol.search'].valid;
    const result = await tool.handler(payload as any);
    expect(fakeClient.search).toHaveBeenCalledWith(payload);
    expect(result).toBe('search-result');
  });

  it('delegates hol.agenticSearch to client.requestJson', async () => {
    const tool = getTool('hol.agenticSearch');
    const payload = schemaSamples['hol.agenticSearch'].valid as any;
    const result = await tool.handler(payload);
    expect(requestBrokerJsonMock).toHaveBeenCalledWith(
      '/search/agentic',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'content-type': 'application/json' }),
        body: expect.objectContaining({ query: payload.query }),
      }),
    );
    expect(result).toBe('agentic-result');
  });

  it('suggests delegation candidates using broker discovery', async () => {
    requestBrokerJsonMock.mockResolvedValueOnce({
      hits: [
        {
          agent: {
            uaid: 'uaid-agentic-1',
            registry: 'hashnet',
            profile: { display_name: 'Agentic One' },
            trustScore: 80,
            verified: true,
            metadata: { available: true },
          },
          score: 0.95,
          highlights: {},
        },
      ],
      total: 1,
      totalAvailable: 1,
      visible: 1,
      limited: false,
      took: 12,
    });
    fakeClient.vectorSearch.mockResolvedValueOnce({
      hits: [
        {
          agent: {
            uaid: 'uaid-vector-1',
            registry: 'hashnet',
            profile: { display_name: 'Vector One' },
            trustScore: 60,
            verified: true,
          },
          score: 0.88,
          highlights: {},
        },
      ],
      total: 1,
    });
    fakeClient.search.mockResolvedValueOnce({
      hits: [
        {
          uaid: 'uaid-keyword-1',
          registry: 'hashnet',
          profile: { display_name: 'Keyword One' },
          trustScore: 50,
          verified: false,
          avgLatency: 100,
        },
      ],
      total: 1,
    });

    const tool = getTool('hol.delegate.suggest');
    const result = await tool.handler({ task: 'Find agents that know registry broker internals', limit: 2 });
    expect(fakeClient.search).toHaveBeenCalledWith({ q: 'Find agents that know registry broker internals', limit: 8, type: 'ai-agents' });
    expect(fakeClient.vectorSearch).toHaveBeenCalledWith({ query: 'Find agents that know registry broker internals', limit: 2 });
    expect(requestBrokerJsonMock).toHaveBeenCalledWith(
      '/search/agentic',
      expect.objectContaining({
        method: 'POST',
        body: expect.objectContaining({ query: 'Find agents that know registry broker internals' }),
      }),
    );
    const structured = result?.content?.find((entry: any) => typeof entry?.text === 'string' && entry.text.startsWith('delegate.suggest:\n'))?.text;
    expect(structured).toBeTypeOf('string');
    const json = JSON.parse(String(structured).replace(/^delegate\.suggest:\n/, ''));
    expect(json.candidates.map((candidate: any) => candidate.uaid)).toEqual(['uaid-agentic-1', 'uaid-vector-1']);
    expect(result).toMatchObject({
      content: expect.any(Array),
    });
  });

  it('enlists a delegation candidate automatically', async () => {
    requestBrokerJsonMock.mockResolvedValueOnce({
      hits: [
        {
          agent: {
            uaid: 'uaid-agentic-1',
            registry: 'hashnet',
            profile: { display_name: 'Agentic One' },
            trustScore: 80,
            verified: true,
            metadata: { available: true },
          },
          score: 0.95,
          highlights: {},
        },
      ],
      total: 1,
      totalAvailable: 1,
      visible: 1,
      limited: false,
      took: 12,
    });
    fakeClient.vectorSearch.mockResolvedValueOnce({ hits: [], total: 0 });
    fakeClient.search.mockResolvedValueOnce({ hits: [], total: 0 });

    const tool = getTool('workflow.delegate');
    const result = await tool.handler({ task: 'Ask an agent to summarize a log', limit: 1 });

    expect(requestBrokerJsonMock).toHaveBeenCalled();
    expect(fakeClient.chat.createSession).toHaveBeenCalledWith({ uaid: 'uaid-agentic-1', auth: undefined });
    expect(fakeClient.chat.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'session-1',
        message: expect.stringContaining('Ask an agent to summarize a log'),
      }),
    );

    expect(result).toMatchObject({ content: expect.any(Array) });
  });

  it('aggregates UAID utilities correctly', async () => {
    fakeClient.resolveUaid.mockResolvedValueOnce('resolved-value');
    fakeClient.validateUaid.mockResolvedValueOnce('validated-value');
    fakeClient.getUaidConnectionStatus.mockResolvedValueOnce('status-value');
    const tool = getTool('hol.resolveUaid');
    const response = await tool.handler({ uaid: 'abc' });
    expect(response).toEqual({
      resolved: 'resolved-value',
      validation: 'validated-value',
      status: 'status-value',
    });
    expect(fakeClient.resolveUaid).toHaveBeenCalledWith('abc');
  });

  it('waits for registration completion using broker helper', async () => {
    const tool = getTool('hol.waitForRegistrationCompletion');
    await tool.handler({ attemptId: 'attempt', intervalMs: 500, timeoutMs: 1_000 });
    expect(fakeClient.waitForRegistrationCompletion).toHaveBeenCalledWith('attempt', {
      intervalMs: 500,
      timeoutMs: 1_000,
    });
  });

  it('routes chat operations through the broker chat namespace', async () => {
    const createTool = getTool('hol.chat.createSession');
    await createTool.handler({ uaid: 'uaid', historyTtlSeconds: 60 });
    expect(fakeClient.chat.createSession).toHaveBeenCalledWith({ uaid: 'uaid', historyTtlSeconds: 60 });

    const messageTool = getTool('hol.chat.sendMessage');
    await messageTool.handler({ sessionId: 's', message: 'hi' });
    expect(fakeClient.chat.sendMessage).toHaveBeenCalledWith({ sessionId: 's', message: 'hi' });

    const historyTool = getTool('hol.chat.history');
    await historyTool.handler({ sessionId: 's' });
    expect(fakeClient.chat.getHistory).toHaveBeenCalledWith('s');

    const compactTool = getTool('hol.chat.compact');
    await compactTool.handler({ sessionId: 's', preserveEntries: 3 });
    expect(fakeClient.chat.compactHistory).toHaveBeenCalledWith({ sessionId: 's', preserveEntries: 3 });

    const endTool = getTool('hol.chat.end');
    await endTool.handler({ sessionId: 's' });
    expect(fakeClient.chat.endSession).toHaveBeenCalledWith('s');
  });

  it('auto-creates chat sessions when only UAID is provided and records memory entries', async () => {
    const tool = getTool('hol.chat.sendMessage');
    const result = await tool.handler({ uaid: 'uaid:auto', message: 'hello auto' });
    expect(fakeClient.chat.createSession).toHaveBeenCalledWith({ uaid: 'uaid:auto', auth: undefined });
    expect(fakeClient.chat.sendMessage).toHaveBeenCalledWith({ sessionId: 'session-1', message: 'hello auto', auth: undefined, streaming: undefined });
    expect(recordEntryMock).toHaveBeenCalledTimes(2);
    expect(recordEntryMock.mock.calls[0][0]).toMatchObject({
      scope: { sessionId: 'session-1', uaid: 'uaid:auto' },
      role: 'user',
    });
    expect(recordEntryMock.mock.calls[1][0]).toMatchObject({
      scope: { sessionId: 'session-1', uaid: 'uaid:auto' },
      role: 'assistant',
    });
    expect(result).toEqual({ message: 'ok' });
  });

  it('defaults preserveEntries to 4 when compacting history', async () => {
    const compactTool = getTool('hol.chat.compact');
    await compactTool.handler({ sessionId: 's1' });
    expect(fakeClient.chat.compactHistory).toHaveBeenCalledWith({ sessionId: 's1', preserveEntries: 4 });
  });

  it('exposes read-only protocol and stats utilities', async () => {
    await getTool('hol.stats').handler({});
    await getTool('hol.metricsSummary').handler({});
    await getTool('hol.dashboardStats').handler({});
    await getTool('hol.websocketStats').handler({});
    await getTool('hol.listProtocols').handler({});
    await getTool('hol.detectProtocol').handler({ headers: { 'content-type': 'application/json' }, body: '{}' });

    expect(fakeClient.stats).toHaveBeenCalled();
    expect(fakeClient.metricsSummary).toHaveBeenCalled();
    expect(fakeClient.dashboardStats).toHaveBeenCalled();
    expect(fakeClient.websocketStats).toHaveBeenCalled();
    expect(fakeClient.listProtocols).toHaveBeenCalled();
    expect(fakeClient.detectProtocol).toHaveBeenCalledWith({ headers: { 'content-type': 'application/json' }, body: '{}' });
  });

  it('supports registry maintenance helpers', async () => {
    await getTool('hol.updateAgent').handler({ uaid: 'uaid', payload: baseRegistrationPayload });
    expect(fakeClient.updateAgent).toHaveBeenCalled();
    await getTool('hol.additionalRegistries').handler({});
    expect(fakeClient.getAdditionalRegistries).toHaveBeenCalled();
    await getTool('hol.registrySearchByNamespace').handler({ registry: 'hashnet', query: 'foo' });
    expect(fakeClient.registrySearchByNamespace).toHaveBeenCalledWith('hashnet', 'foo');
  });

  it('handles ledger + credit purchase helpers', async () => {
    await getTool('hol.ledger.challenge').handler({ accountId: '0.0.1', network: 'mainnet' });
    expect(fakeClient.createLedgerChallenge).toHaveBeenCalled();
    await getTool('hol.ledger.authenticate').handler({
      challengeId: 'c1',
      accountId: '0.0.1',
      network: 'testnet',
      signature: '0xabc',
    });
    expect(fakeClient.verifyLedgerChallenge).toHaveBeenCalled();
    await getTool('hol.purchaseCredits.hbar').handler({ accountId: '0.0.1', privateKey: 'key', hbarAmount: 1 });
    expect(fakeClient.purchaseCreditsWithHbar).toHaveBeenCalled();
    await getTool('hol.x402.minimums').handler({});
    expect(fakeClient.getX402Minimums).toHaveBeenCalled();
    await getTool('hol.x402.buyCredits').handler({ accountId: '0.0.1', credits: 5, evmPrivateKey: '0xabc' });
    expect(fakeClient.buyCreditsWithX402).toHaveBeenCalled();
  });
});

describe('buildLoggedTool', () => {
  beforeEach(() => {
    loggerSpy.debug.mockClear();
    loggerSpy.info.mockClear();
    loggerSpy.error.mockClear();
  });

  it('logs success metadata', async () => {
    const definition = {
      name: 'demo.tool',
      description: 'demo',
      schema: z.object({ value: z.string() }),
      handler: vi.fn().mockResolvedValue('ok'),
    };
    const tool = buildLoggedTool(definition);
    await tool.execute({ value: '1' }, { requestId: 'req-1' } as any);
    expect(definition.handler).toHaveBeenCalledWith({ value: '1' });
    expect(loggerSpy.info).toHaveBeenCalled();
    expect(loggerSpy.error).not.toHaveBeenCalled();
  });

  it('logs failures and rethrows', async () => {
    const definition = {
      name: 'demo.tool',
      description: 'demo',
      schema: z.object({ count: z.number().int().positive() }),
      handler: vi.fn().mockImplementation(() => {
        throw new Error('boom');
      }),
    };
    const tool = buildLoggedTool(definition);
    await expect(tool.execute({ count: 1 })).rejects.toThrow('boom');
    expect(loggerSpy.error).toHaveBeenCalled();
  });
});
