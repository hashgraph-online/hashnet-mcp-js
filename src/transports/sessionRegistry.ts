import type { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import type { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

import type { AppLogger } from "../observability/logger.js";

export type HttpSessionTransport = StreamableHTTPServerTransport | SSEServerTransport;
export type HttpSessionKind = "streamable-http" | "legacy-sse";

export interface SessionClientInfo {
  name?: string;
  version?: string;
}

export interface SessionRecord {
  sessionId: string;
  kind: HttpSessionKind;
  transport: HttpSessionTransport;
  createdAt: number;
  lastActivityAt: number;
  clientInfo?: SessionClientInfo;
  protocolVersion?: string;
}

export interface SessionRegistryOptions {
  idleTtlMs: number;
  maxSessions: number;
}

export interface RegisterSessionOptions {
  sessionId: string;
  kind: HttpSessionKind;
  transport: HttpSessionTransport;
  clientInfo?: SessionClientInfo;
  protocolVersion?: string;
}

export interface SessionRegistryStats {
  activeSessions: number;
  createdSessions: number;
  expiredSessions: number;
  rejectedSessions: number;
}

export class SessionCapacityError extends Error {
  constructor(readonly maxSessions: number) {
    super(`Session capacity exceeded: maxSessions=${maxSessions}`);
    this.name = "SessionCapacityError";
  }
}

export function createSessionRegistry(options: SessionRegistryOptions) {
  const sessions = new Map<string, SessionRecord>();
  let createdSessions = 0;
  let expiredSessions = 0;
  let rejectedSessions = 0;

  function get(sessionId: string): SessionRecord | undefined {
    const session = sessions.get(sessionId);
    if (session) {
      session.lastActivityAt = Date.now();
    }
    return session;
  }

  function register(opts: RegisterSessionOptions): SessionRecord {
    if (sessions.size >= options.maxSessions) {
      rejectedSessions += 1;
      throw new SessionCapacityError(options.maxSessions);
    }

    const now = Date.now();
    const session: SessionRecord = {
      ...opts,
      createdAt: now,
      lastActivityAt: now,
    };

    sessions.set(opts.sessionId, session);
    createdSessions += 1;

    return session;
  }

  function remove(sessionId: string): void {
    sessions.delete(sessionId);
  }

  async function expireSession(sessionId: string, logger: AppLogger): Promise<void> {
    const session = sessions.get(sessionId);
    if (!session) {
      return;
    }

    try {
      await session.transport.close();
    } catch (error) {
      logger.warn({ error, sessionId }, "failed to close expired session");
    } finally {
      if (sessions.delete(sessionId)) {
        expiredSessions += 1;
      }
    }
  }

  async function reapExpired(logger: AppLogger): Promise<number> {
    const now = Date.now();
    const expiredIds: string[] = [];

    for (const [sessionId, session] of sessions.entries()) {
      if (now - session.lastActivityAt > options.idleTtlMs) {
        expiredIds.push(sessionId);
      }
    }

    await Promise.all(expiredIds.map((sessionId) => expireSession(sessionId, logger)));
    return expiredIds.length;
  }

  async function closeAll(logger: AppLogger): Promise<void> {
    const sessionIds = [...sessions.keys()];
    await Promise.all(sessionIds.map((sessionId) => expireSession(sessionId, logger)));
  }

  function stats(): SessionRegistryStats {
    return {
      activeSessions: sessions.size,
      createdSessions,
      expiredSessions,
      rejectedSessions,
    };
  }

  return {
    get,
    register,
    remove,
    reapExpired,
    closeAll,
    stats,
  };
}

export type SessionRegistry = ReturnType<typeof createSessionRegistry>;
