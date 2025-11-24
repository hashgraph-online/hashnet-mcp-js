import type { Logger } from 'pino';
import { config } from '../config';
import { logger as baseLogger } from '../logger';
import { createMemoryStore } from './factory';
import type { MemoryConfig, MemoryEntry, MemoryRole, MemoryScope, MemoryStore, MemorySummary } from './types';

type RecordParams = {
  scope: MemoryScope;
  role: MemoryRole;
  content: string;
  toolName?: string;
  metadata?: Record<string, unknown>;
  ttlSeconds?: number;
};

type ContextParams = {
  scope: MemoryScope;
  limit?: number;
  includeSummary?: boolean;
};

type SearchParams = {
  scope: MemoryScope;
  query: string;
  limit?: number;
};

const DEFAULT_MAX_CHARS = 4000;
const REDACT_KEYS = ['privateKey', 'apiKey', 'token', 'authorization', 'auth', 'evmPrivateKey', 'password'];

export class MemoryService {
  private readonly store: MemoryStore;
  private readonly config: MemoryConfig;
  private readonly logger: Logger;

  constructor(store: MemoryStore, memoryConfig: MemoryConfig, logger: Logger) {
    this.store = store;
    this.config = memoryConfig;
    // Keep a scoped logger so memory noise does not mix with tool logs.
    this.logger = logger.child({ module: 'memory' });
  }

  isEnabled(): boolean {
    return this.config.enabled;
  }

  async recordEntry(params: RecordParams): Promise<MemoryEntry | null> {
    if (!this.config.enabled) return null;
    const content = truncate(params.content, DEFAULT_MAX_CHARS);
    const ttlSeconds = params.ttlSeconds ?? this.config.defaultTtlSeconds;
    const expiresAt = ttlSeconds ? Date.now() + ttlSeconds * 1000 : undefined;

    const entry = await this.store.append({
      scope: params.scope,
      role: params.role,
      content,
      toolName: params.toolName,
      metadata: params.metadata ? redact(params.metadata) : undefined,
      expiresAt,
    });

    await this.store.trim(params.scope, this.config.maxEntriesPerScope);
    await this.store.purgeExpired(Date.now());
    if (this.config.summaryTrigger && this.config.summaryTrigger > 0) {
      void this.maybeSummarize(params.scope).catch((error) => {
        this.logger.warn({ error }, 'memory.summarize.failed');
      });
    }

    return entry;
  }

  async recordToolEvent(toolName: string, scope: MemoryScope, payload: unknown): Promise<void> {
    if (!this.config.enabled || !this.config.captureTools) return;
    const excerpt = truncate(serialize(payload), DEFAULT_MAX_CHARS);
    await this.recordEntry({
      scope,
      role: 'tool',
      content: `[${toolName}] ${excerpt}`,
      toolName,
    });
  }

  async note(scope: MemoryScope, content: string): Promise<MemoryEntry | null> {
    return this.recordEntry({ scope, role: 'note', content });
  }

  async getContext(params: ContextParams): Promise<{ entries: MemoryEntry[]; summary?: MemorySummary | null }> {
    const limit = clamp(params.limit ?? this.config.maxReturnEntries, 1, this.config.maxReturnEntries);
    const entries = await this.store.listRecent(params.scope, limit);
    const summary = params.includeSummary ? await this.store.getSummary(params.scope) : undefined;
    return { entries, summary };
  }

  async search(params: SearchParams): Promise<MemoryEntry[]> {
    const limit = clamp(params.limit ?? this.config.maxReturnEntries, 1, this.config.maxReturnEntries);
    return this.store.search(params.scope, params.query, limit);
  }

  async clear(scope: MemoryScope): Promise<number> {
    return this.store.clear(scope);
  }

  async summarize(scope: MemoryScope): Promise<MemorySummary | null> {
    if (!this.config.enabled) return null;
    const entries = await this.store.listRecent(scope, this.config.summaryTrigger ?? this.config.maxReturnEntries);
    if (!entries.length) return null;
    const summary = buildHeuristicSummary(entries);
    const record = { scope, content: summary, updatedAt: Date.now() };
    await this.store.upsertSummary(record);
    return record;
  }

  private async maybeSummarize(scope: MemoryScope) {
    if (!this.config.summaryTrigger) return;
    const entries = await this.store.listRecent(scope, this.config.summaryTrigger + 5);
    if (entries.length < this.config.summaryTrigger) return;
    await this.summarize(scope);
  }
}

export function createMemoryService(): MemoryService | null {
  if (!config.memory.enabled) return null;
  try {
    const store = createMemoryStore(config.memory);
    return new MemoryService(store, config.memory, baseLogger);
  } catch (error) {
    baseLogger.error({ error }, 'memory.init.failed');
    return null;
  }
}

function truncate(value: string, max: number) {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}…`;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function serialize(payload: unknown) {
  if (typeof payload === 'string') return payload;
  if (payload === undefined || payload === null) return '';
  try {
    return JSON.stringify(redact(payload), null, 2);
  } catch (error) {
    return `unserializable payload: ${error instanceof Error ? error.message : String(error)}`;
  }
}

function redact<T>(payload: T): T {
  if (Array.isArray(payload)) {
    return payload.map((item) => redact(item)) as unknown as T;
  }
  if (payload && typeof payload === 'object') {
    const clone: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
      if (REDACT_KEYS.includes(key.toLowerCase())) {
        clone[key] = '[redacted]';
      } else {
        clone[key] = redact(value);
      }
    }
    return clone as unknown as T;
  }
  return payload;
}

function buildHeuristicSummary(entries: MemoryEntry[]): string {
  // Lightweight fallback: we do not call an LLM here; just condense the latest messages.
  const recent = entries
    .slice(0, 10)
    .map((entry) => `${entry.role}${entry.toolName ? `(${entry.toolName})` : ''}: ${truncate(entry.content, 512)}`);
  return ['Summary (heuristic, no LLM):', ...recent].join('\n');
}
