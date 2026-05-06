import { describe, expect, test } from "vitest";

import {
  holCapabilitiesOutputSchema,
  holChatCreateSessionInputSchema,
  holChatCreateSessionOutputSchema,
  holChatEndInputSchema,
  holChatEndOutputSchema,
  holChatHistoryInputSchema,
  holChatHistoryOutputSchema,
  holChatReadinessInputSchema,
  holChatReadinessOutputSchema,
  holChatRetryInputSchema,
  holChatRetryOutputSchema,
  holChatSendMessageInputSchema,
  holChatSendMessageOutputSchema,
  holResolveUaidInputSchema,
  holResolveUaidOutputSchema,
  holSearchInputSchema,
  holSearchOutputSchema,
  holStatsOutputSchema,
  holVectorSearchInputSchema,
  holVectorSearchOutputSchema,
  holRegisterAgentOutputSchema,
  holRegistrationQuoteOutputSchema,
  holWaitRegistrationOutputSchema,
  registrationPayloadSchema,
  toolErrorEnvelopeSchema,
  waitRegistrationInputSchema,
  workflowDelegateInputSchema,
  workflowDelegateOutputSchema,
  workflowDiscoveryInputSchema,
  workflowDiscoveryOutputSchema,
  workflowRegistrationInputSchema,
  workflowRegistrationOutputSchema,
} from "../../src/mcp/schemas/common.js";

describe("tool schemas", () => {
  test("discovery schemas accept valid payloads", () => {
    expect(holSearchInputSchema.safeParse({ query: "customer support", limit: 5 }).success).toBe(true);
    expect(holVectorSearchInputSchema.safeParse({ query: "semantic", limit: 5 }).success).toBe(true);
    expect(holResolveUaidInputSchema.safeParse({ uaid: "uaid:example" }).success).toBe(true);
  });

  test("chat schemas accept valid payloads", () => {
    expect(
      holChatCreateSessionInputSchema.safeParse({
        uaid: "uaid:abc",
        auth: { type: "bearer", token: "token-1" },
      }).success,
    ).toBe(true);
    expect(
      holChatSendMessageInputSchema.safeParse({
        sessionId: "session-1",
        message: "hello",
        auth: { type: "header", headerName: "x-demo", headerValue: "value" },
        senderUaid: "uaid:sender",
        historyTtlSeconds: 300,
        encryptionRequested: true,
        idempotencyKey: "idem-1",
        transport: "a2a",
      }).success,
    ).toBe(true);
    expect(holChatReadinessInputSchema.safeParse({ uaid: "uaid:abc" }).success).toBe(true);
    expect(
      holChatRetryInputSchema.safeParse({
        messageId: "idem-1",
        sessionId: "session-1",
        message: "hello",
        senderUaid: "uaid:sender",
      }).success,
    ).toBe(true);
    expect(holChatHistoryInputSchema.safeParse({ sessionId: "session-1" }).success).toBe(true);
    expect(holChatEndInputSchema.safeParse({ sessionId: "session-1" }).success).toBe(true);
  });

  test("registration/workflow schemas accept valid payloads", () => {
    const payload = {
      profile: { name: "Test Agent" },
      endpoint: "https://example.com/agent",
      protocol: "mcp",
    };

    expect(registrationPayloadSchema.safeParse(payload).success).toBe(true);
    expect(waitRegistrationInputSchema.safeParse({ attemptId: "attempt-1", timeoutMs: 1000 }).success).toBe(true);
    expect(workflowDiscoveryInputSchema.safeParse({ query: "support", limit: 3 }).success).toBe(true);
    expect(
      workflowDelegateInputSchema.safeParse({
        task: "Review this pull request.",
        query: "typescript reviewer",
        auth: { type: "apiKey", token: "token-1" },
      }).success,
    ).toBe(true);
    expect(workflowRegistrationInputSchema.safeParse({ payload, wait: true }).success).toBe(true);
    expect(
      workflowDiscoveryInputSchema.safeParse({
        query: "support",
        filters: { q: "override" },
      }).success,
    ).toBe(false);
  });

  test("output schemas accept the structured success envelope", () => {
    const meta = {
      schemaVersion: 1,
      summary: "ok",
      traceId: "trace-1",
      durationMs: 12,
    };

    expect(holStatsOutputSchema.safeParse({ ok: true, data: { stats: { totalAgents: 1 } }, meta }).success).toBe(true);
    expect(
      holSearchOutputSchema.safeParse({
        ok: true,
        data: { query: "support", count: 1, results: { hits: [] } },
        meta,
      }).success,
    ).toBe(true);
    expect(
      holVectorSearchOutputSchema.safeParse({
        ok: true,
        data: { query: "support", count: 1, results: { results: [] } },
        meta,
      }).success,
    ).toBe(true);
    expect(
      holResolveUaidOutputSchema.safeParse({
        ok: true,
        data: { uaid: "uaid:abc", resolved: { name: "Agent" } },
        meta,
      }).success,
    ).toBe(true);
    expect(
      holChatCreateSessionOutputSchema.safeParse({
        ok: true,
        data: { session: { sessionId: "s1" } },
        meta,
      }).success,
    ).toBe(true);
    expect(
      holChatReadinessOutputSchema.safeParse({
        ok: true,
        data: { readiness: { status: "responsive" } },
        meta,
      }).success,
    ).toBe(true);
    expect(
      holChatSendMessageOutputSchema.safeParse({
        ok: true,
        data: { sessionId: "s1", response: { id: "msg-1" } },
        meta,
      }).success,
    ).toBe(true);
    expect(
      holChatHistoryOutputSchema.safeParse({
        ok: true,
        data: { sessionId: "s1", history: { items: [] } },
        meta,
      }).success,
    ).toBe(true);
    expect(
      holChatRetryOutputSchema.safeParse({
        ok: true,
        data: { sessionId: "s1", response: { idempotent: true } },
        meta,
      }).success,
    ).toBe(true);
    expect(
      holChatEndOutputSchema.safeParse({
        ok: true,
        data: { sessionId: "s1", ended: true, state: "ended" },
        meta,
      }).success,
    ).toBe(true);
    expect(
      holRegistrationQuoteOutputSchema.safeParse({
        ok: true,
        data: { quote: { credits: 1 } },
        meta,
      }).success,
    ).toBe(true);
    expect(
      holRegisterAgentOutputSchema.safeParse({
        ok: true,
        data: { registration: { attemptId: "attempt-1" } },
        meta,
      }).success,
    ).toBe(true);
    expect(
      holWaitRegistrationOutputSchema.safeParse({
        ok: true,
        data: { attemptId: "attempt-1", progress: { state: "complete" } },
        meta,
      }).success,
    ).toBe(true);
    expect(
      workflowDiscoveryOutputSchema.safeParse({
        ok: true,
        data: {
          query: "support",
          totalHits: 1,
          topHits: [{ uaid: "uaid:1", name: "Agent 1" }],
          raw: { hits: [] },
        },
        meta,
      }).success,
    ).toBe(true);
    expect(
      workflowRegistrationOutputSchema.safeParse({
        ok: true,
        data: {
          quote: { credits: 1 },
          registration: { attemptId: "attempt-1" },
          progress: { state: "complete" },
          waited: true,
        },
        meta,
      }).success,
    ).toBe(true);
    expect(
      workflowDelegateOutputSchema.safeParse({
        ok: true,
        data: {
          task: "Review this pull request.",
          query: "typescript reviewer",
          candidateCount: 1,
          selectedAgent: {
            uaid: "uaid:delegate-1",
            name: "Registry Reviewer",
            agentUrl: "https://delegate.example.com/mcp",
            score: 0.99,
          },
          session: { sessionId: "session-1" },
          response: { accepted: true },
          search: { hits: [] },
        },
        meta,
      }).success,
    ).toBe(true);
    expect(
      holCapabilitiesOutputSchema.safeParse({
        ok: true,
        data: {
          server: { name: "hol-mcp-server-poc", version: "0.1.0" },
          transports: { stdio: true, http: true, legacySse: false },
          auth: {
            brokerApiKeyConfigured: true,
            ledgerAuthConfigured: false,
            ledgerAuthMode: "none",
            paidToolAuthAvailable: true,
            httpBearerRequired: false,
          },
          limits: {
            brokerRateLimitConcurrency: 5,
            brokerRateLimitMinTimeMs: 100,
            brokerRequestTimeoutMs: 15000,
            sessionIdleTtlMs: 60000,
            sessionMaxCount: 10,
          },
          features: {
            legacySse: false,
            memorySqlite: false,
            memoryRedis: false,
            ledgerAuth: false,
            encryptedChat: false,
          },
        },
        meta,
      }).success,
    ).toBe(true);
  });

  test("error envelope schema accepts structured failures", () => {
    expect(
      toolErrorEnvelopeSchema.safeParse({
        ok: false,
        error: {
          code: "BROKER_HTTP_ERROR",
          category: "auth",
          message: "Unauthorized",
          retryable: false,
          statusCode: 401,
        },
        meta: {
          schemaVersion: 1,
          summary: "Unauthorized",
        },
      }).success,
    ).toBe(true);
  });
});
