import * as standardsSdk from "@hashgraphonline/standards-sdk";
import { Agent } from "undici";

import type { EnvConfig } from "../config/env.js";
import { SERVER_NAME } from "../constants.js";

const sharedDispatcher = new Agent({
  keepAliveTimeout: 10_000,
  keepAliveMaxTimeout: 60_000,
  connections: 64,
});

type BrokerFetch = typeof fetch;

export interface LedgerAuthenticationLoggerLike {
  info?: (message: string) => void;
}

export interface LedgerAuthenticationSignerResultLike {
  signature: string;
  signatureKind?: string;
  publicKey?: string;
}

export interface LedgerCredentialAuthOptionsLike {
  accountId: string;
  network: string;
  signer?: unknown;
  sign?: (
    message: string,
  ) => LedgerAuthenticationSignerResultLike | Promise<LedgerAuthenticationSignerResultLike>;
  hederaPrivateKey?: string;
  evmPrivateKey?: string;
  expiresInMinutes?: number;
  setAccountHeader?: boolean;
  label?: string;
  logger?: LedgerAuthenticationLoggerLike;
}

export interface LedgerVerifyResponseLike extends Record<string, unknown> {
  key: string;
  accountId: string;
  network: string;
  apiKey: {
    prefix: string;
    lastFour: string;
  } & Record<string, unknown>;
}

export type RegistryBrokerClientLike = {
  getDefaultHeaders?: () => Record<string, string>;
  setDefaultHeader: (name: string, value?: string | null) => void;
  setLedgerApiKey: (apiKey?: string) => void;
  authenticateWithLedgerCredentials: (
    options: LedgerCredentialAuthOptionsLike,
  ) => Promise<LedgerVerifyResponseLike>;
  createSession: (
    payload: Record<string, unknown>,
  ) => Promise<{ sessionId: string } & Record<string, unknown>>;
  checkChatReadiness: (payload: Record<string, unknown>) => Promise<Record<string, unknown>>;
  getGuardSession: () => Promise<Record<string, unknown>>;
  getGuardEntitlements: () => Promise<Record<string, unknown>>;
  getGuardBillingBalance: () => Promise<Record<string, unknown>>;
  getGuardTrustByHash: (sha256: string) => Promise<Record<string, unknown>>;
  resolveGuardTrust: (query: Record<string, unknown>) => Promise<Record<string, unknown>>;
  getGuardRevocations: () => Promise<Record<string, unknown>>;
  syncGuardReceipts: (payload: Record<string, unknown>) => Promise<Record<string, unknown>>;
  cancelSession: (sessionId: string) => Promise<Record<string, unknown>>;
  endSession: (sessionId: string) => Promise<Record<string, unknown>>;
  fetchHistorySnapshot: (
    sessionId: string,
    options?: Record<string, unknown>,
  ) => Promise<Record<string, unknown>>;
  resumeSession: (sessionId: string) => Promise<Record<string, unknown>>;
  getRegistrationQuote: (payload: Record<string, unknown>) => Promise<Record<string, unknown>>;
  registerAgent: (payload: Record<string, unknown>) => Promise<Record<string, unknown>>;
  resolveUaid: (uaid: string) => Promise<Record<string, unknown>>;
  search: (params?: Record<string, unknown>) => Promise<{ hits?: Array<Record<string, unknown>> } & Record<string, unknown>>;
  sendMessage: (payload: Record<string, unknown>) => Promise<Record<string, unknown>>;
  retryMessage: (
    messageId: string,
    payload: Record<string, unknown>,
  ) => Promise<Record<string, unknown>>;
  stats: () => Promise<Record<string, unknown>>;
  vectorSearch: (
    request: Record<string, unknown>,
  ) => Promise<{ hits?: Array<Record<string, unknown>> } & Record<string, unknown>>;
  waitForRegistrationCompletion: (
    attemptId: string,
    options?: Record<string, unknown>,
  ) => Promise<Record<string, unknown>>;
};

type BrokerClientEnv = Pick<
  EnvConfig,
  "registryBrokerApiUrl" | "registryBrokerApiKey" | "brokerRequestTimeoutMs"
>;

const RegistryBrokerClientCtor = (standardsSdk as Record<string, unknown>).RegistryBrokerClient as new (
  options: Record<string, unknown>,
) => RegistryBrokerClientLike;

export function createRegistryBrokerClient(
  env: BrokerClientEnv,
  traceId: string,
): RegistryBrokerClientLike {
  const client = new RegistryBrokerClientCtor({
    baseUrl: env.registryBrokerApiUrl,
    apiKey: env.registryBrokerApiKey,
    defaultHeaders: {
      "x-app-id": SERVER_NAME,
      "x-trace-id": traceId,
    },
    fetchImplementation: createBrokerFetch(env.brokerRequestTimeoutMs),
  });

  return Object.assign(client, {
    resumeSession: (sessionId: string) => resumeBrokerSession(env, traceId, sessionId),
  });
}

function createBrokerFetch(timeoutMs: number): BrokerFetch {
  return async (input, init) => {
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const signal = init?.signal ? AbortSignal.any([init.signal, timeoutSignal]) : timeoutSignal;

    return fetch(
      input,
      {
        ...init,
        dispatcher: sharedDispatcher,
        signal,
      } as RequestInit & { dispatcher: Agent },
    );
  };
}

async function resumeBrokerSession(
  env: BrokerClientEnv,
  traceId: string,
  sessionId: string,
): Promise<Record<string, unknown>> {
  const baseUrl = env.registryBrokerApiUrl.endsWith("/")
    ? env.registryBrokerApiUrl.slice(0, -1)
    : env.registryBrokerApiUrl;
  const headers: Record<string, string> = {
    accept: "application/json",
    "x-app-id": SERVER_NAME,
    "x-trace-id": traceId,
  };
  if (env.registryBrokerApiKey) {
    headers["x-api-key"] = env.registryBrokerApiKey;
  }

  const response = await createBrokerFetch(env.brokerRequestTimeoutMs)(
    `${baseUrl}/chat/session/${encodeURIComponent(sessionId)}/resume`,
    {
      headers,
    },
  );
  const payload = await response.json();
  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "error" in payload
        ? String((payload as { error: unknown }).error)
        : `Registry Broker resume failed with HTTP ${response.status}`;
    throw new Error(message);
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Registry Broker resume returned a non-object response.");
  }
  return payload as Record<string, unknown>;
}
