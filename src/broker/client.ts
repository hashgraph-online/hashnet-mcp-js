import * as standardsSdk from "@hashgraphonline/standards-sdk";
import { Agent } from "undici";

import type { EnvConfig } from "../config/env.js";
import { SERVER_NAME } from "../constants.js";

const RegistryBrokerClientCtor = (standardsSdk as Record<string, unknown>).RegistryBrokerClient as new (
  options: Record<string, unknown>,
) => RegistryBrokerClientLike;
const sharedDispatcher = new Agent({
  keepAliveTimeout: 10_000,
  keepAliveMaxTimeout: 60_000,
  connections: 64,
});

type BrokerFetch = typeof fetch;

export type RegistryBrokerClientLike = {
  setDefaultHeader?: (name: string, value?: string | null) => void;
  stats: () => Promise<Record<string, unknown>>;
  search: (params?: Record<string, unknown>) => Promise<{ hits?: Array<Record<string, unknown>> } & Record<string, unknown>>;
  vectorSearch: (
    request: Record<string, unknown>,
  ) => Promise<{ results?: Array<Record<string, unknown>> } & Record<string, unknown>>;
  resolveUaid: (uaid: string) => Promise<Record<string, unknown>>;
  createSession: (payload: Record<string, unknown>) => Promise<{ sessionId: string } & Record<string, unknown>>;
  sendMessage: (payload: Record<string, unknown>) => Promise<Record<string, unknown>>;
  fetchHistorySnapshot: (
    sessionId: string,
    options?: Record<string, unknown>,
  ) => Promise<Record<string, unknown>>;
  endSession: (sessionId: string) => Promise<void>;
  getRegistrationQuote: (payload: Record<string, unknown>) => Promise<Record<string, unknown>>;
  registerAgent: (payload: Record<string, unknown>) => Promise<Record<string, unknown>>;
  waitForRegistrationCompletion: (
    attemptId: string,
    options?: Record<string, unknown>,
  ) => Promise<Record<string, unknown>>;
};

export function createRegistryBrokerClient(
  env: Pick<EnvConfig, "registryBrokerApiUrl" | "registryBrokerApiKey" | "brokerRequestTimeoutMs">,
  traceId: string,
): RegistryBrokerClientLike {
  return new RegistryBrokerClientCtor({
    baseUrl: env.registryBrokerApiUrl,
    apiKey: env.registryBrokerApiKey,
    defaultHeaders: {
      "x-app-id": SERVER_NAME,
      "x-trace-id": traceId,
    },
    fetchImplementation: createBrokerFetch(env.brokerRequestTimeoutMs),
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
