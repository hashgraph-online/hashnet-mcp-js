export type MemoryScope = string | undefined;

export interface MemoryEntry {
  key: string;
  scope?: MemoryScope;
  value: unknown;
  tags?: string[];
  createdAt: number;
  updatedAt: number;
  expiresAt?: number;
}

export interface MemoryPutOptions {
  key: string;
  scope?: MemoryScope;
  value: unknown;
  tags?: string[];
  ttlMs?: number;
}

export interface MemoryListOptions {
  scope?: MemoryScope;
  tag?: string;
  limit?: number;
}

export interface MemoryStore {
  put(options: MemoryPutOptions): Promise<MemoryEntry>;
  get(key: string, scope?: MemoryScope): Promise<MemoryEntry | null>;
  delete(key: string, scope?: MemoryScope): Promise<boolean>;
  list(options?: MemoryListOptions): Promise<MemoryEntry[]>;
  clear(scope?: MemoryScope): Promise<number>;
  prune(): Promise<number>;
}
