import { describe, expect, test } from "vitest";

import {
  holGuardBillingBalanceOutputSchema,
  holGuardEntitlementsOutputSchema,
  holGuardResolveTrustInputSchema,
  holGuardResolveTrustOutputSchema,
  holGuardRevocationsOutputSchema,
  holGuardSessionOutputSchema,
  holGuardSyncReceiptsInputSchema,
  holGuardSyncReceiptsOutputSchema,
  holGuardTrustByHashInputSchema,
  holGuardTrustByHashOutputSchema,
} from "../../src/mcp/schemas/common.js";

describe("guard tool schemas", () => {
  test("accept valid Guard inputs", () => {
    expect(holGuardTrustByHashInputSchema.safeParse({ sha256: "abc123" }).success).toBe(true);
    expect(
      holGuardResolveTrustInputSchema.safeParse({
        ecosystem: "mcp",
        name: "hashnet-mcp",
        version: "1.0.0",
      }).success,
    ).toBe(true);
    expect(
      holGuardSyncReceiptsInputSchema.safeParse({
        receipts: [
          {
            receiptId: "receipt-1",
            capturedAt: "2026-04-10T00:00:00.000Z",
            harness: "codex",
            deviceId: "device-1",
            deviceName: "MacBook",
            artifactId: "artifact-1",
            artifactName: "hashnet-mcp",
            artifactType: "plugin",
            artifactSlug: "hashnet-mcp",
            artifactHash: "abc123",
            policyDecision: "allow",
            recommendation: "monitor",
            changedSinceLastApproval: false,
            capabilities: ["search"],
            summary: "Initial approval",
          },
        ],
      }).success,
    ).toBe(true);
  });

  test("accept valid Guard success envelopes", () => {
    const meta = {
      schemaVersion: 1,
      summary: "ok",
      traceId: "trace-1",
      durationMs: 12,
    };

    expect(
      holGuardSessionOutputSchema.safeParse({
        ok: true,
        data: {
          session: {
            principal: { signedIn: false, roles: [] },
            entitlements: { planId: "free" },
          },
        },
        meta,
      }).success,
    ).toBe(true);
    expect(
      holGuardEntitlementsOutputSchema.safeParse({
        ok: true,
        data: {
          entitlements: {
            entitlements: { planId: "pro" },
          },
        },
        meta,
      }).success,
    ).toBe(true);
    expect(
      holGuardBillingBalanceOutputSchema.safeParse({
        ok: true,
        data: {
          balance: {
            generatedAt: "2026-04-10T00:00:00.000Z",
            buckets: [],
          },
        },
        meta,
      }).success,
    ).toBe(true);
    expect(
      holGuardTrustByHashOutputSchema.safeParse({
        ok: true,
        data: {
          trust: {
            query: { sha256: "abc123" },
            match: null,
            evidence: [],
          },
        },
        meta,
      }).success,
    ).toBe(true);
    expect(
      holGuardResolveTrustOutputSchema.safeParse({
        ok: true,
        data: {
          query: {
            ecosystem: "mcp",
            name: "hashnet-mcp",
            version: "1.0.0",
          },
          trust: {
            query: { ecosystem: "mcp", name: "hashnet-mcp", version: "1.0.0" },
            items: [],
          },
        },
        meta,
      }).success,
    ).toBe(true);
    expect(
      holGuardRevocationsOutputSchema.safeParse({
        ok: true,
        data: {
          revocations: {
            generatedAt: "2026-04-10T00:00:00.000Z",
            items: [],
          },
        },
        meta,
      }).success,
    ).toBe(true);
    expect(
      holGuardSyncReceiptsOutputSchema.safeParse({
        ok: true,
        data: {
          sync: {
            syncedAt: "2026-04-10T00:00:00.000Z",
            receiptsStored: 1,
          },
        },
        meta,
      }).success,
    ).toBe(true);
  });
});
