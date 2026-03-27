import { afterEach, describe, expect, test, vi } from "vitest";

import { createLogger } from "../../src/observability/logger.js";
import { createSessionRegistry, SessionCapacityError } from "../../src/transports/sessionRegistry.js";

const logger = createLogger({ logLevel: "silent" });

function createTransport() {
  return {
    close: vi.fn().mockResolvedValue(undefined),
  } as unknown as { close: () => Promise<void> };
}

describe("session registry", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test("tracks registration, lookup touches, and removal", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-05T00:00:00.000Z"));

    const registry = createSessionRegistry({
      idleTtlMs: 10_000,
      maxSessions: 5,
    });
    const transport = createTransport();

    registry.register({
      sessionId: "session-1",
      kind: "streamable-http",
      transport: transport as never,
      clientInfo: { name: "test-client", version: "1.0.0" },
      protocolVersion: "2025-06-18",
    });

    vi.setSystemTime(new Date("2026-03-05T00:00:05.000Z"));
    const session = registry.get("session-1");

    expect(session?.lastActivityAt).toBe(new Date("2026-03-05T00:00:05.000Z").getTime());
    expect(registry.stats()).toMatchObject({
      activeSessions: 1,
      createdSessions: 1,
      expiredSessions: 0,
      rejectedSessions: 0,
    });

    registry.remove("session-1");
    expect(registry.stats().activeSessions).toBe(0);
  });

  test("rejects sessions beyond the configured capacity", () => {
    const registry = createSessionRegistry({
      idleTtlMs: 10_000,
      maxSessions: 1,
    });

    registry.register({
      sessionId: "session-1",
      kind: "streamable-http",
      transport: createTransport() as never,
    });

    expect(() =>
      registry.register({
        sessionId: "session-2",
        kind: "legacy-sse",
        transport: createTransport() as never,
      }),
    ).toThrow(SessionCapacityError);
    expect(registry.stats().rejectedSessions).toBe(1);
  });

  test("reaps idle sessions and closes transports", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-05T00:00:00.000Z"));

    const registry = createSessionRegistry({
      idleTtlMs: 1_000,
      maxSessions: 5,
    });
    const transport = createTransport();

    registry.register({
      sessionId: "session-1",
      kind: "streamable-http",
      transport: transport as never,
    });

    vi.setSystemTime(new Date("2026-03-05T00:00:02.000Z"));
    const expiredCount = await registry.reapExpired(logger);

    expect(expiredCount).toBe(1);
    expect(transport.close).toHaveBeenCalledTimes(1);
    expect(registry.stats()).toMatchObject({
      activeSessions: 0,
      expiredSessions: 1,
    });
  });
});
