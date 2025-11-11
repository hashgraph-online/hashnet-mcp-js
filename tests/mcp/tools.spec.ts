import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

const createFakeClient = () => ({
  search: vi.fn().mockResolvedValue('search-result'),
  vectorSearch: vi.fn().mockResolvedValue('vector-result'),
  resolveUaid: vi.fn().mockResolvedValue('resolved'),
  validateUaid: vi.fn().mockResolvedValue('validated'),
  getUaidConnectionStatus: vi.fn().mockResolvedValue('status'),
  closeUaidConnection: vi.fn().mockResolvedValue('closed'),
  getRegistrationQuote: vi.fn().mockResolvedValue('quote'),
  registerAgent: vi.fn().mockResolvedValue('registered'),
  waitForRegistrationCompletion: vi.fn().mockResolvedValue('complete'),
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
});

const fakeClient = createFakeClient();
const withBrokerMock = vi.fn((fn: (client: typeof fakeClient) => Promise<unknown>) => fn(fakeClient));

const loggerSpy = {
  debug: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
};

vi.mock('../../src/broker', () => ({
  withBroker: withBrokerMock,
  broker: fakeClient,
  brokerLimiter: undefined,
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
  'rb.search': { valid: { q: 'agent', limit: 5 }, invalid: { limit: 0 } },
  'rb.vectorSearch': { valid: { query: 'embedding' }, invalid: { query: '' } },
  'rb.resolveUaid': { valid: { uaid: 'uaid-1' }, invalid: { uaid: '' } },
  'rb.closeUaidConnection': { valid: { uaid: 'uaid-1' }, invalid: { uaid: '' } },
  'rb.getRegistrationQuote': { valid: { payload: baseRegistrationPayload }, invalid: { payload: null } },
  'rb.registerAgent': { valid: { payload: baseRegistrationPayload }, invalid: { payload: undefined } },
  'rb.waitForRegistrationCompletion': {
    valid: { attemptId: 'attempt', intervalMs: 1000, timeoutMs: 2000 },
    invalid: { attemptId: 'attempt', intervalMs: 0, timeoutMs: 0 },
  },
  'rb.chat.createSession': { valid: { uaid: 'uaid', historyTtlSeconds: 60 }, invalid: { uaid: '' } },
  'rb.chat.sendMessage': { valid: { sessionId: 's1', message: 'hello' }, invalid: { sessionId: 's1', message: '' } },
  'rb.chat.history': { valid: { sessionId: 's1' }, invalid: {} },
  'rb.chat.compact': { valid: { sessionId: 's1', preserveEntries: 2 }, invalid: { sessionId: 's1', preserveEntries: -1 } },
  'rb.chat.end': { valid: { sessionId: 's1' }, invalid: {} },
  'rb.listProtocols': { valid: {} },
  'rb.detectProtocol': { valid: { headers: { 'content-type': 'application/json' }, body: '{}' }, invalid: { headers: { foo: 1 } } },
  'rb.stats': { valid: {} },
  'rb.metricsSummary': { valid: {} },
  'rb.dashboardStats': { valid: {} },
};

describe('mcp tool definitions', () => {
  beforeEach(() => {
    withBrokerMock.mockClear();
    fakeClient.search.mockClear();
    fakeClient.vectorSearch.mockClear();
    fakeClient.resolveUaid.mockClear();
    fakeClient.validateUaid.mockClear();
    fakeClient.getUaidConnectionStatus.mockClear();
    fakeClient.closeUaidConnection.mockClear();
    fakeClient.getRegistrationQuote.mockClear();
    fakeClient.registerAgent.mockClear();
    fakeClient.waitForRegistrationCompletion.mockClear();
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
  });

  it('registers all expected tool names', () => {
    expect(registeredTools.map((tool) => tool.name)).toEqual([
      'rb.search',
      'rb.vectorSearch',
      'rb.resolveUaid',
      'rb.closeUaidConnection',
      'rb.getRegistrationQuote',
      'rb.registerAgent',
      'rb.waitForRegistrationCompletion',
      'rb.chat.createSession',
      'rb.chat.sendMessage',
      'rb.chat.history',
      'rb.chat.compact',
      'rb.chat.end',
      'rb.listProtocols',
      'rb.detectProtocol',
      'rb.stats',
      'rb.metricsSummary',
      'rb.dashboardStats',
    ]);
  });

  it.each(Object.entries(schemaSamples))('%s schema validates as expected', (name, sample) => {
    const tool = getTool(name);
    expect(tool.schema.safeParse(sample.valid).success).toBe(true);
    if (sample.invalid !== undefined) {
      expect(tool.schema.safeParse(sample.invalid).success).toBe(false);
    }
  });

  it('delegates rb.search to client.search', async () => {
    const tool = getTool('rb.search');
    const payload = schemaSamples['rb.search'].valid;
    const result = await tool.handler(payload as any);
    expect(fakeClient.search).toHaveBeenCalledWith(payload);
    expect(result).toBe('search-result');
  });

  it('aggregates UAID utilities correctly', async () => {
    fakeClient.resolveUaid.mockResolvedValueOnce('resolved-value');
    fakeClient.validateUaid.mockResolvedValueOnce('validated-value');
    fakeClient.getUaidConnectionStatus.mockResolvedValueOnce('status-value');
    const tool = getTool('rb.resolveUaid');
    const response = await tool.handler({ uaid: 'abc' });
    expect(response).toEqual({
      resolved: 'resolved-value',
      validation: 'validated-value',
      status: 'status-value',
    });
    expect(fakeClient.resolveUaid).toHaveBeenCalledWith('abc');
  });

  it('waits for registration completion using broker helper', async () => {
    const tool = getTool('rb.waitForRegistrationCompletion');
    await tool.handler({ attemptId: 'attempt', intervalMs: 500, timeoutMs: 1_000 });
    expect(fakeClient.waitForRegistrationCompletion).toHaveBeenCalledWith('attempt', {
      intervalMs: 500,
      timeoutMs: 1_000,
    });
  });

  it('routes chat operations through the broker chat namespace', async () => {
    const createTool = getTool('rb.chat.createSession');
    await createTool.handler({ uaid: 'uaid', historyTtlSeconds: 60 });
    expect(fakeClient.chat.createSession).toHaveBeenCalledWith({ uaid: 'uaid', historyTtlSeconds: 60 });

    const messageTool = getTool('rb.chat.sendMessage');
    await messageTool.handler({ sessionId: 's', message: 'hi' });
    expect(fakeClient.chat.sendMessage).toHaveBeenCalledWith({ sessionId: 's', message: 'hi' });

    const historyTool = getTool('rb.chat.history');
    await historyTool.handler({ sessionId: 's' });
    expect(fakeClient.chat.getHistory).toHaveBeenCalledWith('s');

    const compactTool = getTool('rb.chat.compact');
    await compactTool.handler({ sessionId: 's', preserveEntries: 3 });
    expect(fakeClient.chat.compactHistory).toHaveBeenCalledWith({ sessionId: 's', preserveEntries: 3 });

    const endTool = getTool('rb.chat.end');
    await endTool.handler({ sessionId: 's' });
    expect(fakeClient.chat.endSession).toHaveBeenCalledWith('s');
  });

  it('exposes read-only protocol and stats utilities', async () => {
    await getTool('rb.listProtocols').handler({});
    await getTool('rb.detectProtocol').handler({ headers: { foo: 'bar' } });
    await getTool('rb.stats').handler({});
    await getTool('rb.metricsSummary').handler({});
    await getTool('rb.dashboardStats').handler({});

    expect(fakeClient.listProtocols).toHaveBeenCalled();
    expect(fakeClient.detectProtocol).toHaveBeenCalledWith({ headers: { foo: 'bar' } });
    expect(fakeClient.stats).toHaveBeenCalled();
    expect(fakeClient.metricsSummary).toHaveBeenCalled();
    expect(fakeClient.dashboardStats).toHaveBeenCalled();
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
