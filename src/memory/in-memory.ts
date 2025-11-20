import { logger } from '../logger';
import type { MemoryEntry, MemoryListOptions, MemoryPutOptions, MemoryScope, MemoryStore } from './types';

type InternalEntry = MemoryEntry & { expiresAt?: number };

type InMemoryOptions = {
  defaultTtlMs?: number;
  maxItems?: number;
};

export class InMemoryMemoryStore implements MemoryStore {
  private readonly store = new Map<string, InternalEntry>();
  private readonly defaultTtlMs?: number;
  private readonly maxItems?: number;

  constructor(options: InMemoryOptions = {}) {
    this.defaultTtlMs = options.defaultTtlMs;
    this.maxItems = options.maxItems;
  }

  async put(input: MemoryPutOptions): Promise<MemoryEntry> {
    await this.prune();
    const now = Date.now();
    const expiresAt = this.computeExpiry(now, input.ttlMs);
    const entry: InternalEntry = {
      key: input.key,
      scope: input.scope,
      value: input.value,
      tags: input.tags,
      createdAt: now,
      updatedAt: now,
      expiresAt,
    };
    const mapKey = this.mapKey(entry.scope, entry.key);
    if (this.store.has(mapKey)) {
      const existing = this.store.get(mapKey)!;
      entry.createdAt = existing.createdAt;
    }
    this.store.set(mapKey, entry);
    this.enforceMaxItems();
    return this.stripInternal(entry);
  }

  async get(key: string, scope?: MemoryScope): Promise<MemoryEntry | null> {
    await this.prune();
    const mapKey = this.mapKey(scope, key);
    const entry = this.store.get(mapKey);
    if (!entry) return null;
    if (this.isExpired(entry)) {
      this.store.delete(mapKey);
      return null;
    }
    return this.stripInternal(entry);
  }

  async delete(key: string, scope?: MemoryScope): Promise<boolean> {
    const mapKey = this.mapKey(scope, key);
    return this.store.delete(mapKey);
  }

  async list(options: MemoryListOptions = {}): Promise<MemoryEntry[]> {
    await this.prune();
    const { scope, tag, limit } = options;
    const entries: MemoryEntry[] = [];
    for (const entry of this.store.values()) {
      if (this.isExpired(entry)) continue;
      if (scope && entry.scope !== scope) continue;
      if (tag && !(entry.tags ?? []).includes(tag)) continue;
      entries.push(this.stripInternal(entry));
    }
    entries.sort((a, b) => b.updatedAt - a.updatedAt);
    return typeof limit === 'number' && limit > 0 ? entries.slice(0, limit) : entries;
  }

  async clear(scope?: MemoryScope): Promise<number> {
    let removed = 0;
    if (!scope) {
      removed = this.store.size;
      this.store.clear();
      return removed;
    }
    for (const key of Array.from(this.store.keys())) {
      if (key.startsWith(this.scopePrefix(scope))) {
        this.store.delete(key);
        removed += 1;
      }
    }
    return removed;
  }

  async prune(): Promise<number> {
    let removed = 0;
    for (const [key, entry] of this.store.entries()) {
      if (this.isExpired(entry)) {
        this.store.delete(key);
        removed += 1;
      }
    }
    return removed;
  }

  private stripInternal(entry: InternalEntry): MemoryEntry {
    return {
      key: entry.key,
      scope: entry.scope,
      value: entry.value,
      tags: entry.tags,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
      expiresAt: entry.expiresAt,
    };
  }

  private enforceMaxItems() {
    if (!this.maxItems || this.store.size <= this.maxItems) return;
    const entries = Array.from(this.store.entries());
    entries.sort(([, a], [, b]) => a.updatedAt - b.updatedAt);
    const overflow = this.store.size - this.maxItems;
    const victims = entries.slice(0, overflow);
    for (const [key] of victims) {
      this.store.delete(key);
    }
    if (victims.length > 0) {
      logger.warn({ removed: victims.length, maxItems: this.maxItems }, 'memory.evicted');
    }
  }

  private isExpired(entry: InternalEntry): boolean {
    return typeof entry.expiresAt === 'number' && entry.expiresAt <= Date.now();
  }

  private mapKey(scope: MemoryScope, key: string): string {
    return `${this.scopePrefix(scope)}::${key}`;
  }

  private scopePrefix(scope: MemoryScope): string {
    return scope ?? 'global';
  }

  private computeExpiry(now: number, ttlMs?: number): number | undefined {
    const ttl = ttlMs ?? this.defaultTtlMs;
    if (!ttl || ttl <= 0) return undefined;
    return now + ttl;
  }
}
