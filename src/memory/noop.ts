import type { MemoryEntry, MemoryListOptions, MemoryPutOptions, MemoryScope, MemoryStore } from './types';

export class NoopMemoryStore implements MemoryStore {
  async put(options: MemoryPutOptions): Promise<MemoryEntry> {
    const now = Date.now();
    return {
      key: options.key,
      scope: options.scope,
      value: options.value,
      tags: options.tags,
      createdAt: now,
      updatedAt: now,
    };
  }

  async get(_key: string, _scope?: MemoryScope): Promise<MemoryEntry | null> {
    return null;
  }

  async delete(_key: string, _scope?: MemoryScope): Promise<boolean> {
    return false;
  }

  async list(_options?: MemoryListOptions): Promise<MemoryEntry[]> {
    return [];
  }

  async clear(_scope?: MemoryScope): Promise<number> {
    return 0;
  }

  async prune(): Promise<number> {
    return 0;
  }
}
