import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import type { EnvConfig } from "../../src/config/env.js";
import { registerAgentMailboxTools } from "../../src/mcp/tools/agent-mailbox.js";
import type { ToolRegisterContext } from "../../src/mcp/tools/types.js";
import { createLogger } from "../../src/observability/logger.js";

type ToolHandler = (args: Record<string, unknown>, extra: unknown) => Promise<CallToolResult>;

interface RegisteredTool {
  name: string;
  handler: ToolHandler;
}

function makeCtx(overrides: Partial<EnvConfig> = {}): {
  ctx: ToolRegisterContext;
  tools: Map<string, RegisteredTool>;
} {
  const tools = new Map<string, RegisteredTool>();
  const fakeServer = {
    registerTool: (name: string, _meta: unknown, handler: ToolHandler) => {
      tools.set(name, { name, handler });
    },
  };
  const env = {
    registryBrokerApiUrl: "https://broker.test/api/v1",
    brokerRequestTimeoutMs: 5_000,
    logLevel: "silent",
    ...overrides,
  } as EnvConfig;
  const ctx = {
    env,
    flags: {
      featureLegacySse: false,
      featureMemorySqlite: false,
      featureMemoryRedis: false,
      featureLedgerAuth: false,
      featureEncryptedChat: false,
      featureAgentMailbox: true,
    },
    logger: createLogger({ logLevel: "silent" }),
    rateLimiter: { schedule: <T>(fn: () => Promise<T>) => fn() },
    authAvailability: { paidToolAuthAvailable: false, ledgerAuthAvailable: false },
    server: fakeServer,
    withBroker: async (_t: string, _o: string, fn: (c: unknown) => Promise<unknown>) => fn({}),
    withBrokerAuth: async (_t: string, _o: string, fn: (c: unknown) => Promise<unknown>) => fn({}),
    requirePaidToolAuth: () => null,
  } as unknown as ToolRegisterContext;

  registerAgentMailboxTools(fakeServer as never, ctx);
  return { ctx, tools };
}

const extra = { requestId: "test-req" };

describe("agent mailbox tools", () => {
  const fetchSpy = vi.fn<typeof fetch>();

  beforeEach(() => {
    fetchSpy.mockReset();
    vi.stubGlobal("fetch", fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function jsonResponse(body: unknown, status = 200): Response {
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: "OK",
      headers: new Headers({ "content-type": "application/json" }),
      text: async () => JSON.stringify(body),
      json: async () => body,
    } as unknown as Response;
  }

  function lastCall(): { url: string; init: RequestInit } {
    const [input, init] = fetchSpy.mock.calls.at(-1)!;
    return { url: String(input), init: init ?? {} };
  }

  test("registers the expected tool surface", () => {
    const { tools } = makeCtx();
    expect([...tools.keys()].sort()).toEqual([
      "hol.agent.conversation.cancel",
      "hol.agent.conversation.get",
      "hol.agent.inbox.ack",
      "hol.agent.inbox.claim",
      "hol.agent.inbox.list",
      "hol.agent.inbox.renewLease",
      "hol.agent.me",
      "hol.agent.message.get",
      "hol.agent.pairing.complete",
      "hol.agent.reject",
      "hol.agent.reply",
      "hol.agent.send",
    ]);
  });

  test("sends the grant token as Authorization and never the env api key", async () => {
    const { tools } = makeCtx({ registryBrokerApiKey: "OPERATOR_KEY_MUST_NOT_LEAK" });
    fetchSpy.mockResolvedValueOnce(jsonResponse({ runtime: { runtimeId: "r1" } }));

    const result = await tools.get("hol.agent.me")!.handler(
      { grantToken: "hol_agt_bot1" },
      extra,
    );
    expect(result.isError).toBeFalsy();

    const { url, init } = lastCall();
    expect(url).toBe("https://broker.test/api/v1/agent-runtimes/me");
    const headers = new Headers(init.headers);
    expect(headers.get("authorization")).toBe("Bearer hol_agt_bot1");
    expect(headers.get("x-api-key")).toBeNull();
    expect(JSON.stringify(init.headers)).not.toContain("OPERATOR_KEY_MUST_NOT_LEAK");
  });

  test("claim returns null on 204 and the parsed claim otherwise", async () => {
    const { tools } = makeCtx();
    fetchSpy.mockResolvedValueOnce(jsonResponse(null, 204));
    const empty = await tools.get("hol.agent.inbox.claim")!.handler(
      { grantToken: "hol_agt_bot1" },
      extra,
    );
    expect(empty.structuredContent).toMatchObject({ ok: true, data: { claim: null } });

    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ message: { messageId: "m1" }, lease: { leaseId: "l1", fencingToken: 3 } }),
    );
    const claimed = await tools.get("hol.agent.inbox.claim")!.handler(
      { grantToken: "hol_agt_bot1" },
      extra,
    );
    expect(claimed.structuredContent).toMatchObject({
      ok: true,
      data: { claim: { lease: { fencingToken: 3 } } },
    });
  });

  test("send posts idempotencyKey and content through unchanged", async () => {
    const { tools } = makeCtx();
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ messageId: "m1", requestState: "accepted" }),
    );
    await tools.get("hol.agent.send")!.handler(
      {
        grantToken: "hol_agt_bot1",
        recipientUaid: "uaid:aid:peer",
        kind: "request",
        text: "compute 37 + 58",
        idempotencyKey: "idem-xyz",
      },
      extra,
    );
    const { url, init } = lastCall();
    expect(url).toBe("https://broker.test/api/v1/agent-messages");
    expect(JSON.parse(String(init.body))).toEqual({
      recipientUaid: "uaid:aid:peer",
      kind: "request",
      content: { type: "text", text: "compute 37 + 58" },
      idempotencyKey: "idem-xyz",
    });
  });

  test("reply carries lease fencing token and outcome", async () => {
    const { tools } = makeCtx();
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ request: { messageId: "m1" }, response: { messageId: "m2" } }),
    );
    await tools.get("hol.agent.reply")!.handler(
      {
        grantToken: "hol_agt_bot1",
        messageId: "m1",
        leaseId: "l1",
        fencingToken: 9,
        text: "95 nonce-123",
        outcome: "answered",
        idempotencyKey: "reply-1",
      },
      extra,
    );
    const { url, init } = lastCall();
    expect(url).toBe("https://broker.test/api/v1/agent-messages/m1/reply");
    expect(JSON.parse(String(init.body))).toMatchObject({
      leaseId: "l1",
      fencingToken: 9,
      outcome: "answered",
    });
  });

  test("pairing.complete sends the code without auth headers", async () => {
    const { tools } = makeCtx();
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({
        grantId: "g1",
        runtimeId: "r1",
        token: "hol_agt_new",
        scopes: ["inbox:read"],
      }),
    );
    const result = await tools.get("hol.agent.pairing.complete")!.handler(
      { pairingCode: "hol_pair_abc" },
      extra,
    );
    expect(result.structuredContent).toMatchObject({
      ok: true,
      data: { token: "hol_agt_new" },
    });
    const { init } = lastCall();
    expect(new Headers(init.headers).get("authorization")).toBeNull();
  });

  test("upstream errors surface as tool errors with status", async () => {
    const { tools } = makeCtx();
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ error: { code: "GRANT_REVOKED" } }, 403),
    );
    const result = await tools.get("hol.agent.me")!.handler(
      { grantToken: "hol_agt_dead" },
      extra,
    );
    expect(result.isError).toBe(true);
  });
});
