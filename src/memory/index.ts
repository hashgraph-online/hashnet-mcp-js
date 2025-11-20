import { config } from '../config';
import { logger } from '../logger';
import { InMemoryMemoryStore } from './in-memory';
import { NoopMemoryStore } from './noop';
import type { MemoryStore } from './types';

export const MEMORY_ENABLED = Boolean(config.memory.enabled);

const memoryStore: MemoryStore = MEMORY_ENABLED
  ? new InMemoryMemoryStore({
      defaultTtlMs: config.memory.ttlMs,
      maxItems: config.memory.maxItems,
    })
  : new NoopMemoryStore();

if (MEMORY_ENABLED) {
  logger.info(
    {
      ttlMs: config.memory.ttlMs,
      maxItems: config.memory.maxItems,
    },
    'memory.store.enabled',
  );
} else {
  logger.debug('memory.store.disabled');
}

export { memoryStore };

