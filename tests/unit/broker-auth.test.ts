import { describe, expect, test, vi } from "vitest";

import {
  createBrokerAuthState,
  ensureBrokerClientAuth,
  getBrokerAuthAvailability,
} from "../../src/broker/auth.js";
import { createLogger } from "../../src/observability/logger.js";

function createMockBrokerClient() {
  const headers: Record<string, string> = {};

  return {
    authenticateWithLedgerCredentials: vi.fn().mockResolvedValue({
      key: "issued-ledger-key",
      accountId: "0.0.12345",
      network: "hedera:testnet",
      apiKey: {
        id: "api-key-1",
        prefix: "issued",
        lastFour: "1234",
        createdAt: "2026-03-13T00:00:00.000Z",
      },
    }),
    createSession: vi.fn(),
    endSession: vi.fn(),
    fetchHistorySnapshot: vi.fn(),
    getDefaultHeaders: () => ({ ...headers }),
    getRegistrationQuote: vi.fn(),
    registerAgent: vi.fn(),
    resolveUaid: vi.fn(),
    search: vi.fn(),
    sendMessage: vi.fn(),
    setDefaultHeader: (name: string, value?: string | null) => {
      if (!value) {
        delete headers[name];
        return;
      }
      headers[name] = value;
    },
    setLedgerApiKey: (value?: string) => {
      if (!value) {
        delete headers["x-api-key"];
        return;
      }
      headers["x-api-key"] = value;
    },
    stats: vi.fn(),
    vectorSearch: vi.fn(),
    waitForRegistrationCompletion: vi.fn(),
  };
}

describe("broker auth", () => {
  test("detects API key and ledger credential availability", () => {
    expect(
      getBrokerAuthAvailability({
        registryBrokerApiKey: "broker-key",
        ledgerAccountId: undefined,
        hederaAccountId: undefined,
        hederaNetwork: undefined,
        hederaPrivateKey: undefined,
        evmLedgerNetwork: undefined,
        ethPrivateKey: undefined,
      }),
    ).toEqual({
      brokerApiKeyConfigured: true,
      ledgerAuthConfigured: false,
      ledgerAuthMode: "none",
      paidToolAuthAvailable: true,
    });

    expect(
      getBrokerAuthAvailability({
        registryBrokerApiKey: undefined,
        ledgerAccountId: "0.0.12345",
        hederaAccountId: undefined,
        hederaNetwork: "hedera:testnet",
        hederaPrivateKey: "hedera-private-key",
        evmLedgerNetwork: undefined,
        ethPrivateKey: undefined,
      }),
    ).toEqual({
      brokerApiKeyConfigured: false,
      ledgerAuthConfigured: true,
      ledgerAuthMode: "hedera",
      paidToolAuthAvailable: true,
    });
  });

  test("caches ledger verification and reuses the issued key across broker clients", async () => {
    const env = {
      registryBrokerApiKey: undefined,
      ledgerAccountId: "0.0.12345",
      hederaAccountId: "0.0.12345",
      hederaNetwork: "hedera:testnet",
      hederaPrivateKey: "hedera-private-key",
      evmLedgerNetwork: undefined,
      ethPrivateKey: undefined,
    };
    const logger = createLogger({ logLevel: "silent" });
    const state = createBrokerAuthState();
    const firstClient = createMockBrokerClient();
    const secondClient = createMockBrokerClient();

    const firstMode = await ensureBrokerClientAuth(firstClient, env, logger, state);
    const secondMode = await ensureBrokerClientAuth(secondClient, env, logger, state);

    expect(firstMode).toBe("hedera");
    expect(secondMode).toBe("hedera");
    expect(firstClient.authenticateWithLedgerCredentials).toHaveBeenCalledTimes(1);
    expect(secondClient.authenticateWithLedgerCredentials).not.toHaveBeenCalled();
    expect(firstClient.getDefaultHeaders()["x-api-key"]).toBe("issued-ledger-key");
    expect(secondClient.getDefaultHeaders()["x-api-key"]).toBe("issued-ledger-key");
    expect(secondClient.getDefaultHeaders()["x-account-id"]).toBe("0.0.12345");
  });
});
