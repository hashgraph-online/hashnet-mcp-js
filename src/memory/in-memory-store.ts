import { randomUUID } from 'node:crypto';
import type { MemoryEntry, MemoryEntryInput, MemoryStore, MemorySummary } from './types';
import { scopeKey } from './types';

export class InMemoryMemoryStore implements MemoryStore {
  private entries = new Map<string, MemoryEntry[]>();
  private summaries = new Map<string, MemorySummary>();

  async append(entry: MemoryEntryInput): Promise<MemoryEntry> {
    const now = Date.now();
    const key = scopeKey(entry.scope);
    const record: MemoryEntry = {
      ...entry,
      id: randomUUID(),
      createdAt: now,
    };
    const existing = this.entries.get(key) ?? [];
    existing.push(record);
    this.entries.set(key, existing);
    return record;
  }

  async listRecent(scope: MemoryEntryInput['scope'], limit: number): Promise<MemoryEntry[]> {
    const key = scopeKey(scope);
    const items = this.entries.get(key) ?? [];
    return this.filterLive(items)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit);
  }

  async trim(scope: MemoryEntryInput['scope'], maxEntries: number): Promise<number> {
    const key = scopeKey(scope);
    const items = this.filterLive(this.entries.get(key) ?? []).sort((a, b) => b.createdAt - a.createdAt);
    const toKeep = items.slice(0, maxEntries);
    const trimmed = items.length - toKeep.length;
    this.entries.set(key, toKeep);
    return trimmed;
  }

  async clear(scope: MemoryEntryInput['scope']): Promise<number> {
    const key = scopeKey(scope);
    const count = (this.entries.get(key) ?? []).length;
    this.entries.delete(key);
    this.summaries.delete(key);
    return count;
  }

  async search(scope: MemoryEntryInput['scope'], query: string, limit: number): Promise<MemoryEntry[]> {
    const key = scopeKey(scope);
    const items = this.filterLive(this.entries.get(key) ?? []);
    const normalized = query.toLowerCase();
    return items
      .filter((item) => item.content.toLowerCase().includes(normalized))
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit);
  }

  async getSummary(scope: MemoryEntryInput['scope']): Promise<MemorySummary | null> {
    const key = scopeKey(scope);
    return this.summaries.get(key) ?? null;
  }

  async upsertSummary(summary: MemorySummary): Promise<void> {
    const key = scopeKey(summary.scope);
    this.summaries.set(key, summary);
  }

  async purgeExpired(nowMs: number): Promise<number> {
    let removed = 0;
    for (const [key, values] of this.entries.entries()) {
      const live = values.filter((entry) => !entry.expiresAt || entry.expiresAt > nowMs);
      removed += values.length - live.length;
      this.entries.set(key, live);
    }
    return removed;
  }

  private filterLive(entries: MemoryEntry[]) {
    const now = Date.now();
    return entries.filter((entry) => !entry.expiresAt || entry.expiresAt > now);
  }
}
