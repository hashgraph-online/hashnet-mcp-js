export type MemoryScope = {
  uaid?: string;
  sessionId?: string;
  namespace?: string;
  userId?: string;
};

export type MemoryRole = 'user' | 'assistant' | 'system' | 'tool' | 'event' | 'note';

export interface MemoryEntryInput {
  scope: MemoryScope;
  role: MemoryRole;
  content: string;
  toolName?: string;
  metadata?: Record<string, unknown>;
  expiresAt?: number;
}

export interface MemoryEntry extends MemoryEntryInput {
  id: string;
  createdAt: number;
}

export interface MemorySummary {
  scope: MemoryScope;
  content: string;
  updatedAt: number;
}

export interface MemoryStore {
  append(entry: MemoryEntryInput): Promise<MemoryEntry>;
  listRecent(scope: MemoryScope, limit: number): Promise<MemoryEntry[]>;
  trim(scope: MemoryScope, maxEntries: number): Promise<number>;
  clear(scope: MemoryScope): Promise<number>;
  search(scope: MemoryScope, query: string, limit: number): Promise<MemoryEntry[]>;
  getSummary(scope: MemoryScope): Promise<MemorySummary | null>;
  upsertSummary(summary: MemorySummary): Promise<void>;
  purgeExpired(nowMs: number): Promise<number>;
}

export interface MemoryConfig {
  enabled: boolean;
  store: 'sqlite' | 'rocksdb' | 'memory' | 'redis';
  path?: string;
  maxEntriesPerScope: number;
  defaultTtlSeconds?: number;
  summaryTrigger: number;
  maxReturnEntries: number;
  captureTools: boolean;
}

export function scopeKey(scope: MemoryScope): string {
  return [scope.uaid ?? '', scope.sessionId ?? '', scope.namespace ?? '', scope.userId ?? ''].join('::');
}
