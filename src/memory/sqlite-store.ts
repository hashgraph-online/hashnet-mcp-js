import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { MemoryEntry, MemoryEntryInput, MemoryStore, MemorySummary } from './types';
import { scopeKey } from './types';

export class SqliteMemoryStore implements MemoryStore {
  private db: Database.Database;

  private insertEntry!: Database.Statement;
  private selectRecent!: Database.Statement;
  private deleteOld!: Database.Statement;
  private deleteScopeEntries!: Database.Statement;
  private deleteScopeSummary!: Database.Statement;
  private searchEntries!: Database.Statement;
  private selectSummary!: Database.Statement;
  private upsertSummaryStmt!: Database.Statement;
  private purgeExpiredStmt!: Database.Statement;

  constructor(filePath: string) {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    this.db = new Database(filePath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('busy_timeout = 2000');
    this.ensureSchema();
    this.prepareStatements();
  }

  async append(entry: MemoryEntryInput): Promise<MemoryEntry> {
    const now = Date.now();
    const key = scopeKey(entry.scope);
    const record: MemoryEntry = {
      ...entry,
      id: randomUUID(),
      createdAt: now,
    };
    this.insertEntry.run({
      id: record.id,
      scopeKey: key,
      uaid: entry.scope.uaid ?? null,
      sessionId: entry.scope.sessionId ?? null,
      namespace: entry.scope.namespace ?? null,
      userId: entry.scope.userId ?? null,
      role: record.role,
      content: record.content,
      toolName: record.toolName ?? null,
      metadata: record.metadata ? JSON.stringify(record.metadata) : null,
      createdAt: record.createdAt,
      expiresAt: record.expiresAt ?? null,
    });
    return record;
  }

  private prepareStatements() {
    this.insertEntry = this.prepareInsert();
    this.selectRecent = this.prepareSelectRecent();
    this.deleteOld = this.prepareTrim();
    this.deleteScopeEntries = this.prepareClearEntries();
    this.deleteScopeSummary = this.prepareClearSummary();
    this.searchEntries = this.prepareSearch();
    this.selectSummary = this.prepareSelectSummary();
    this.upsertSummaryStmt = this.prepareUpsertSummary();
    this.purgeExpiredStmt = this.preparePurgeExpired();
  }

  async listRecent(scope: MemoryEntryInput['scope'], limit: number): Promise<MemoryEntry[]> {
    const key = scopeKey(scope);
    const rows = this.selectRecent.all(key, Date.now(), limit) as MemoryEntryRow[];
    return rows.map(rowToEntry);
  }

  async trim(scope: MemoryEntryInput['scope'], maxEntries: number): Promise<number> {
    const key = scopeKey(scope);
    const result = this.deleteOld.run({ scopeKey: key, maxEntries });
    return typeof result.changes === 'number' ? result.changes : 0;
  }

  async clear(scope: MemoryEntryInput['scope']): Promise<number> {
    const key = scopeKey(scope);
    const result = this.deleteScopeEntries.run(key);
    this.deleteScopeSummary.run(key);
    return typeof result.changes === 'number' ? result.changes : 0;
  }

  async search(scope: MemoryEntryInput['scope'], query: string, limit: number): Promise<MemoryEntry[]> {
    const key = scopeKey(scope);
    const likeQuery = `%${query}%`;
    const rows = this.searchEntries.all(key, Date.now(), likeQuery, limit) as MemoryEntryRow[];
    return rows.map(rowToEntry);
  }

  async getSummary(scope: MemoryEntryInput['scope']): Promise<MemorySummary | null> {
    const key = scopeKey(scope);
    const row = this.selectSummary.get(key) as SummaryRow | undefined;
    if (!row) return null;
    return {
      scope,
      content: row.content,
      updatedAt: row.updatedAt,
    };
  }

  async upsertSummary(summary: MemorySummary): Promise<void> {
    const key = scopeKey(summary.scope);
    this.upsertSummaryStmt.run({
      scopeKey: key,
      uaid: summary.scope.uaid ?? null,
      sessionId: summary.scope.sessionId ?? null,
      namespace: summary.scope.namespace ?? null,
      userId: summary.scope.userId ?? null,
      content: summary.content,
      updatedAt: summary.updatedAt,
    });
  }

  async purgeExpired(nowMs: number): Promise<number> {
    const result = this.purgeExpiredStmt.run(nowMs);
    return typeof result.changes === 'number' ? result.changes : 0;
  }

  private ensureSchema() {
    this.db
      .prepare(
        `
        CREATE TABLE IF NOT EXISTS entries (
          id TEXT PRIMARY KEY,
          scopeKey TEXT NOT NULL,
          uaid TEXT,
          sessionId TEXT,
          namespace TEXT,
          userId TEXT,
          role TEXT NOT NULL,
          content TEXT NOT NULL,
          toolName TEXT,
          metadata TEXT,
          createdAt INTEGER NOT NULL,
          expiresAt INTEGER
        );
      `,
      )
      .run();
    this.db.prepare('CREATE INDEX IF NOT EXISTS idx_entries_scope_created ON entries(scopeKey, createdAt DESC);').run();
    this.db.prepare('CREATE INDEX IF NOT EXISTS idx_entries_expiry ON entries(expiresAt);').run();
    this.db
      .prepare(
        `
        CREATE TABLE IF NOT EXISTS summaries (
          scopeKey TEXT PRIMARY KEY,
          uaid TEXT,
          sessionId TEXT,
          namespace TEXT,
          userId TEXT,
          content TEXT NOT NULL,
          updatedAt INTEGER NOT NULL
        );
      `,
      )
      .run();
  }

  private prepareInsert() {
    return this.db.prepare(
      `
      INSERT INTO entries (id, scopeKey, uaid, sessionId, namespace, userId, role, content, toolName, metadata, createdAt, expiresAt)
      VALUES (@id, @scopeKey, @uaid, @sessionId, @namespace, @userId, @role, @content, @toolName, @metadata, @createdAt, @expiresAt);
    `,
    );
  }

  private prepareSelectRecent() {
    return this.db.prepare(
      `
      SELECT * FROM entries
      WHERE scopeKey = ?
        AND (expiresAt IS NULL OR expiresAt > ?)
      ORDER BY createdAt DESC
      LIMIT ?;
    `,
    );
  }

  private prepareTrim() {
    return this.db.prepare(
      `
      DELETE FROM entries
      WHERE scopeKey = @scopeKey
        AND id NOT IN (
          SELECT id FROM entries WHERE scopeKey = @scopeKey ORDER BY createdAt DESC LIMIT @maxEntries
        );
    `,
    );
  }

  private prepareClearEntries() {
    return this.db.prepare('DELETE FROM entries WHERE scopeKey = ?;');
  }

  private prepareClearSummary() {
    return this.db.prepare('DELETE FROM summaries WHERE scopeKey = ?;');
  }

  private prepareSearch() {
    return this.db.prepare(
      `
      SELECT * FROM entries
      WHERE scopeKey = ?
        AND (expiresAt IS NULL OR expiresAt > ?)
        AND content LIKE ?
      ORDER BY createdAt DESC
      LIMIT ?;
    `,
    );
  }

  private prepareSelectSummary() {
    return this.db.prepare(
      `
      SELECT scopeKey, content, updatedAt FROM summaries
      WHERE scopeKey = ?;
    `,
    );
  }

  private prepareUpsertSummary() {
    return this.db.prepare(
      `
      INSERT INTO summaries (scopeKey, uaid, sessionId, namespace, userId, content, updatedAt)
      VALUES (@scopeKey, @uaid, @sessionId, @namespace, @userId, @content, @updatedAt)
      ON CONFLICT(scopeKey) DO UPDATE SET
        content = excluded.content,
        updatedAt = excluded.updatedAt,
        uaid = excluded.uaid,
        sessionId = excluded.sessionId,
        namespace = excluded.namespace,
        userId = excluded.userId;
    `,
    );
  }

  private preparePurgeExpired() {
    return this.db.prepare('DELETE FROM entries WHERE expiresAt IS NOT NULL AND expiresAt <= ?;');
  }
}

type MemoryEntryRow = {
  id: string;
  scopeKey: string;
  uaid: string | null;
  sessionId: string | null;
  namespace: string | null;
  userId: string | null;
  role: MemoryEntry['role'];
  content: string;
  toolName: string | null;
  metadata: string | null;
  createdAt: number;
  expiresAt: number | null;
};

type SummaryRow = {
  scopeKey: string;
  content: string;
  updatedAt: number;
};

function rowToEntry(row: MemoryEntryRow): MemoryEntry {
  return {
    id: row.id,
    scope: {
      uaid: row.uaid ?? undefined,
      sessionId: row.sessionId ?? undefined,
      namespace: row.namespace ?? undefined,
      userId: row.userId ?? undefined,
    },
    role: row.role,
    content: row.content,
    toolName: row.toolName ?? undefined,
    metadata: row.metadata ? safeParseJson(row.metadata) : undefined,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt ?? undefined,
  };
}

function safeParseJson(raw: string) {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}
