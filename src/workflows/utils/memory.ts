import type { MemoryScope } from '../../memory';
import { memoryService } from '../../memory';
import type { MemoryEntry, MemorySummary } from '../../memory/types';

export interface MemoryLoadOptions {
  scope: MemoryScope;
  limit?: number;
  includeSummary?: boolean;
  optOut?: boolean;
}

export interface MemoryRecordOptions {
  scope: MemoryScope;
  role: 'user' | 'assistant' | 'note' | 'tool' | 'event';
  content: string;
  toolName: string;
  optOut?: boolean;
}

export async function loadMemoryContext(options: MemoryLoadOptions): Promise<{ entries: MemoryEntry[]; summary?: MemorySummary | null } | null> {
  if (options.optOut) return null;
  if (!memoryService || !memoryService.isEnabled()) return null;
  // Keep reads bounded by opts + global caps inside the service.
  return memoryService.getContext({
    scope: options.scope,
    limit: options.limit,
    includeSummary: options.includeSummary ?? true,
  });
}

export async function recordMemory(options: MemoryRecordOptions): Promise<void> {
  if (options.optOut) return;
  if (!memoryService || !memoryService.isEnabled()) return;
  await memoryService.recordEntry({
    scope: options.scope,
    role: options.role,
    content: options.content,
    toolName: options.toolName,
  });
}
