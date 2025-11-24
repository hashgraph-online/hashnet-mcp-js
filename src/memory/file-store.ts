import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { MemoryEntry, MemoryEntryInput, MemoryStore, MemorySummary } from './types';
import { scopeKey } from './types';

type PersistedShape = {
  entries: MemoryEntry[];
  summaries: MemorySummary[];
};

export class FileMemoryStore implements MemoryStore {
  private filePath: string;
  private data: PersistedShape;

  constructor(filePath: string) {
    this.filePath = filePath;
    this.data = { entries: [], summaries: [] };
    this.ensureLoaded();
  }

  async append(entry: MemoryEntryInput): Promise<MemoryEntry> {
    const record: MemoryEntry = {
      ...entry,
      id: randomUUID(),
      createdAt: Date.now(),
    };
    this.data.entries.push(record);
    await this.save();
    return record;
  }

  async listRecent(scope: MemoryEntryInput['scope'], limit: number): Promise<MemoryEntry[]> {
    const key = scopeKey(scope);
    const now = Date.now();
    return this.data.entries
      .filter((entry) => scopeKey(entry.scope) === key)
      .filter((entry) => !entry.expiresAt || entry.expiresAt > now)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit);
  }

  async trim(scope: MemoryEntryInput['scope'], maxEntries: number): Promise<number> {
    const key = scopeKey(scope);
    const scoped = this.data.entries.filter((entry) => scopeKey(entry.scope) === key).sort((a, b) => b.createdAt - a.createdAt);
    const keep = scoped.slice(0, maxEntries).map((entry) => entry.id);
    const before = this.data.entries.length;
    this.data.entries = this.data.entries.filter((entry) => scopeKey(entry.scope) !== key || keep.includes(entry.id));
    const removed = before - this.data.entries.length;
    if (removed > 0) {
      await this.save();
    }
    return removed;
  }

  async clear(scope: MemoryEntryInput['scope']): Promise<number> {
    const key = scopeKey(scope);
    const beforeEntries = this.data.entries.length;
    const beforeSummaries = this.data.summaries.length;
    this.data.entries = this.data.entries.filter((entry) => scopeKey(entry.scope) !== key);
    this.data.summaries = this.data.summaries.filter((summary) => scopeKey(summary.scope) !== key);
    const removed = beforeEntries - this.data.entries.length + (beforeSummaries - this.data.summaries.length);
    if (removed > 0) {
      await this.save();
    }
    return removed;
  }

  async search(scope: MemoryEntryInput['scope'], query: string, limit: number): Promise<MemoryEntry[]> {
    const key = scopeKey(scope);
    const normalized = query.toLowerCase();
    const now = Date.now();
    return this.data.entries
      .filter((entry) => scopeKey(entry.scope) === key)
      .filter((entry) => !entry.expiresAt || entry.expiresAt > now)
      .filter((entry) => entry.content.toLowerCase().includes(normalized))
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit);
  }

  async getSummary(scope: MemoryEntryInput['scope']): Promise<MemorySummary | null> {
    const key = scopeKey(scope);
    return this.data.summaries.find((summary) => scopeKey(summary.scope) === key) ?? null;
  }

  async upsertSummary(summary: MemorySummary): Promise<void> {
    const key = scopeKey(summary.scope);
    const existingIndex = this.data.summaries.findIndex((entry) => scopeKey(entry.scope) === key);
    if (existingIndex >= 0) {
      this.data.summaries[existingIndex] = summary;
    } else {
      this.data.summaries.push(summary);
    }
    await this.save();
  }

  async purgeExpired(nowMs: number): Promise<number> {
    const before = this.data.entries.length;
    this.data.entries = this.data.entries.filter((entry) => !entry.expiresAt || entry.expiresAt > nowMs);
    const removed = before - this.data.entries.length;
    if (removed > 0) {
      await this.save();
    }
    return removed;
  }

  private ensureLoaded() {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    if (!fs.existsSync(this.filePath)) {
      this.saveSync();
      return;
    }
    try {
      const content = fs.readFileSync(this.filePath, 'utf8');
      const parsed = JSON.parse(content) as PersistedShape;
      this.data = {
        entries: parsed.entries ?? [],
        summaries: parsed.summaries ?? [],
      };
    } catch {
      // Corrupt file: reset to empty to keep the server running.
      this.data = { entries: [], summaries: [] };
      this.saveSync();
    }
  }

  private async save() {
    await fs.promises.writeFile(this.filePath, JSON.stringify(this.data, null, 2), 'utf8');
  }

  private saveSync() {
    fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), 'utf8');
  }
}
