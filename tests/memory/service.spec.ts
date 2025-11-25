import { describe, expect, it } from 'vitest';
import { InMemoryMemoryStore } from '../../src/memory/in-memory-store';
import { MemoryService } from '../../src/memory/service';
import type { MemoryConfig } from '../../src/memory/types';

const loggerStub = {
  child: () => loggerStub,
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  trace: () => {},
};

const baseConfig: MemoryConfig = {
  enabled: true,
  store: 'memory',
  path: undefined,
  maxEntriesPerScope: 5,
  defaultTtlSeconds: undefined,
  summaryTrigger: 3,
  maxReturnEntries: 5,
  captureTools: true,
};

describe('MemoryService', () => {
  it('records entries and retrieves context', async () => {
    const service = new MemoryService(new InMemoryMemoryStore(), baseConfig, loggerStub as any);
    const scope = { sessionId: 's1' };

    await service.recordEntry({ scope, role: 'user', content: 'hello' });
    const result = await service.getContext({ scope, includeSummary: false });

    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]?.content).toBe('hello');
  });

  it('summarizes when threshold is reached', async () => {
    const service = new MemoryService(new InMemoryMemoryStore(), baseConfig, loggerStub as any);
    const scope = { uaid: 'uaid:demo' };
    await service.recordEntry({ scope, role: 'user', content: 'one' });
    await service.recordEntry({ scope, role: 'assistant', content: 'two' });
    await service.recordEntry({ scope, role: 'user', content: 'three' });

    const summary = await service.summarize(scope);
    expect(summary?.content).toContain('Summary');
  });

  it('limits results by maxReturnEntries when searching', async () => {
    const service = new MemoryService(new InMemoryMemoryStore(), { ...baseConfig, maxReturnEntries: 1 }, loggerStub as any);
    const scope = { namespace: 'demo' };
    await service.recordEntry({ scope, role: 'user', content: 'hello world' });
    await service.recordEntry({ scope, role: 'assistant', content: 'another hello' });

    const matches = await service.search({ scope, query: 'hello' });
    expect(matches).toHaveLength(1);
  });
});
