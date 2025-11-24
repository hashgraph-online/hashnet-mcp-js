import { createRequire } from 'node:module';
import { InMemoryMemoryStore } from './in-memory-store';
import { FileMemoryStore } from './file-store';
import type { MemoryConfig, MemoryStore } from './types';

export function createMemoryStore(config: MemoryConfig): MemoryStore {
  switch (config.store) {
    case 'file':
      return new FileMemoryStore(config.path ?? 'tmp/memory.json');
    case 'sqlite':
      return loadSqliteStore(config.path ?? 'tmp/memory.db');
    case 'memory':
      return new InMemoryMemoryStore();
    case 'rocksdb':
      // Placeholder for a heavier-duty backend; keep failure explicit so DX is predictable.
      throw new Error('RocksDB backend not yet implemented. Use MEMORY_STORE=sqlite or memory for now.');
    case 'redis':
      // Redis would allow multi-process sharing; still to be implemented.
      throw new Error('Redis backend not yet implemented. Use MEMORY_STORE=sqlite or memory for now.');
    default:
      throw new Error(`Unsupported memory store "${config.store}".`);
  }
}

function loadSqliteStore(filePath: string): MemoryStore {
  const require = createRequire(import.meta.url);
  // Dynamic import keeps better-sqlite3 optional until the sqlite backend is actually enabled.
  const module = require('./sqlite-store') as typeof import('./sqlite-store');
  return new module.SqliteMemoryStore(filePath);
}
