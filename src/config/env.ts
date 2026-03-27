import { config as loadDotenv } from "dotenv";

export type McpTransportMode = "stdio" | "http";

export interface EnvConfig {
  registryBrokerApiUrl: string;
  registryBrokerApiKey?: string;
  brokerRequestTimeoutMs: number;
  mcpTransport: McpTransportMode;
  mcpHost: string;
  mcpPort: number;
  mcpAllowedOrigins: string[];
  mcpServerBearerToken?: string;
  mcpSessionIdleTtlMs: number;
  mcpSessionMaxCount: number;
  mcpSessionReapIntervalMs: number;
  logLevel: string;
  brokerRateLimitConcurrency: number;
  brokerRateLimitMinTimeMs: number;
  ledgerAccountId?: string;
  hederaNetwork?: string;
  hederaAccountId?: string;
  hederaPrivateKey?: string;
  evmLedgerNetwork?: string;
  ethPrivateKey?: string;
  rbEncryptionPrivateKey?: string;
}

interface UnsafeEnvView extends Record<string, string | number | string[] | undefined> {
  REGISTRY_BROKER_API_URL: string;
  REGISTRY_BROKER_API_KEY?: string;
  BROKER_REQUEST_TIMEOUT_MS: number;
  MCP_TRANSPORT: McpTransportMode;
  MCP_HOST: string;
  MCP_PORT: number;
  MCP_ALLOWED_ORIGINS: string[];
  MCP_SERVER_BEARER_TOKEN?: string;
  MCP_SESSION_IDLE_TTL_MS: number;
  MCP_SESSION_MAX_COUNT: number;
  MCP_SESSION_REAP_INTERVAL_MS: number;
  LOG_LEVEL: string;
  BROKER_RATE_LIMIT_CONCURRENCY: number;
  BROKER_RATE_LIMIT_MIN_TIME_MS: number;
  LEDGER_ACCOUNT_ID?: string;
  HEDERA_NETWORK?: string;
  HEDERA_ACCOUNT_ID?: string;
  HEDERA_PRIVATE_KEY?: string;
  EVM_LEDGER_NETWORK?: string;
  ETH_PK?: string;
  RB_ENCRYPTION_PRIVATE_KEY?: string;
}

const DEFAULT_ALLOWED_ORIGINS = ["http://localhost:*", "http://127.0.0.1:*"];

function parseInteger(value: string | undefined, fallback: number, label: string): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive number`);
  }

  return Math.trunc(parsed);
}

function parseAllowedOrigins(value: string | undefined): string[] {
  if (!value || value.trim().length === 0) {
    return DEFAULT_ALLOWED_ORIGINS;
  }

  const parsed = value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

  return parsed.length > 0 ? parsed : DEFAULT_ALLOWED_ORIGINS;
}

function normalizeOptionalSecret(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function isLocalHost(host: string): boolean {
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): EnvConfig {
  loadDotenv({ quiet: true });

  const rawTransport = (source.MCP_TRANSPORT ?? "http").trim();
  if (rawTransport !== "stdio" && rawTransport !== "http") {
    throw new Error("MCP_TRANSPORT must be either 'stdio' or 'http'");
  }

  const envView: UnsafeEnvView = {
    REGISTRY_BROKER_API_URL: (source.REGISTRY_BROKER_API_URL ?? "https://hol.org/registry/api/v1").trim(),
    REGISTRY_BROKER_API_KEY: normalizeOptionalSecret(source.REGISTRY_BROKER_API_KEY),
    BROKER_REQUEST_TIMEOUT_MS: parseInteger(
      source.BROKER_REQUEST_TIMEOUT_MS,
      15_000,
      "BROKER_REQUEST_TIMEOUT_MS",
    ),
    MCP_TRANSPORT: rawTransport,
    MCP_HOST: (source.MCP_HOST ?? "127.0.0.1").trim(),
    MCP_PORT: parseInteger(source.MCP_PORT, 3333, "MCP_PORT"),
    MCP_ALLOWED_ORIGINS: parseAllowedOrigins(source.MCP_ALLOWED_ORIGINS),
    MCP_SERVER_BEARER_TOKEN: normalizeOptionalSecret(source.MCP_SERVER_BEARER_TOKEN),
    MCP_SESSION_IDLE_TTL_MS: parseInteger(
      source.MCP_SESSION_IDLE_TTL_MS,
      15 * 60 * 1000,
      "MCP_SESSION_IDLE_TTL_MS",
    ),
    MCP_SESSION_MAX_COUNT: parseInteger(source.MCP_SESSION_MAX_COUNT, 250, "MCP_SESSION_MAX_COUNT"),
    MCP_SESSION_REAP_INTERVAL_MS: parseInteger(
      source.MCP_SESSION_REAP_INTERVAL_MS,
      60 * 1000,
      "MCP_SESSION_REAP_INTERVAL_MS",
    ),
    LOG_LEVEL: (source.LOG_LEVEL ?? "info").trim().toLowerCase(),
    BROKER_RATE_LIMIT_CONCURRENCY: parseInteger(
      source.BROKER_RATE_LIMIT_CONCURRENCY,
      5,
      "BROKER_RATE_LIMIT_CONCURRENCY",
    ),
    BROKER_RATE_LIMIT_MIN_TIME_MS: parseInteger(
      source.BROKER_RATE_LIMIT_MIN_TIME_MS,
      100,
      "BROKER_RATE_LIMIT_MIN_TIME_MS",
    ),
    LEDGER_ACCOUNT_ID: normalizeOptionalSecret(source.LEDGER_ACCOUNT_ID),
    HEDERA_NETWORK: normalizeOptionalSecret(source.HEDERA_NETWORK),
    HEDERA_ACCOUNT_ID: normalizeOptionalSecret(source.HEDERA_ACCOUNT_ID),
    HEDERA_PRIVATE_KEY: normalizeOptionalSecret(source.HEDERA_PRIVATE_KEY),
    EVM_LEDGER_NETWORK: normalizeOptionalSecret(source.EVM_LEDGER_NETWORK),
    ETH_PK: normalizeOptionalSecret(source.ETH_PK),
    RB_ENCRYPTION_PRIVATE_KEY: normalizeOptionalSecret(source.RB_ENCRYPTION_PRIVATE_KEY),
  };

  if (!envView.REGISTRY_BROKER_API_URL) {
    throw new Error("REGISTRY_BROKER_API_URL cannot be empty");
  }

  if (!isLocalHost(envView.MCP_HOST) && !envView.MCP_SERVER_BEARER_TOKEN) {
    throw new Error(
      "Unsafe HTTP configuration: binding to non-local host requires MCP_SERVER_BEARER_TOKEN",
    );
  }

  return {
    registryBrokerApiUrl: envView.REGISTRY_BROKER_API_URL,
    registryBrokerApiKey: envView.REGISTRY_BROKER_API_KEY,
    brokerRequestTimeoutMs: envView.BROKER_REQUEST_TIMEOUT_MS,
    mcpTransport: envView.MCP_TRANSPORT,
    mcpHost: envView.MCP_HOST,
    mcpPort: envView.MCP_PORT,
    mcpAllowedOrigins: envView.MCP_ALLOWED_ORIGINS,
    mcpServerBearerToken: envView.MCP_SERVER_BEARER_TOKEN,
    mcpSessionIdleTtlMs: envView.MCP_SESSION_IDLE_TTL_MS,
    mcpSessionMaxCount: envView.MCP_SESSION_MAX_COUNT,
    mcpSessionReapIntervalMs: envView.MCP_SESSION_REAP_INTERVAL_MS,
    logLevel: envView.LOG_LEVEL,
    brokerRateLimitConcurrency: envView.BROKER_RATE_LIMIT_CONCURRENCY,
    brokerRateLimitMinTimeMs: envView.BROKER_RATE_LIMIT_MIN_TIME_MS,
    ledgerAccountId: envView.LEDGER_ACCOUNT_ID ?? envView.HEDERA_ACCOUNT_ID,
    hederaNetwork: envView.HEDERA_NETWORK,
    hederaAccountId: envView.HEDERA_ACCOUNT_ID,
    hederaPrivateKey: envView.HEDERA_PRIVATE_KEY,
    evmLedgerNetwork: envView.EVM_LEDGER_NETWORK,
    ethPrivateKey: envView.ETH_PK,
    rbEncryptionPrivateKey: envView.RB_ENCRYPTION_PRIVATE_KEY,
  };
}

function redact(value: string | undefined): string | undefined {
  return value ? "***REDACTED***" : undefined;
}

export function redactEnvForLogs(env: EnvConfig): Record<string, unknown> {
  return {
    registryBrokerApiUrl: env.registryBrokerApiUrl,
    registryBrokerApiKey: redact(env.registryBrokerApiKey),
    brokerRequestTimeoutMs: env.brokerRequestTimeoutMs,
    mcpTransport: env.mcpTransport,
    mcpHost: env.mcpHost,
    mcpPort: env.mcpPort,
    mcpAllowedOrigins: env.mcpAllowedOrigins,
    mcpServerBearerToken: redact(env.mcpServerBearerToken),
    mcpSessionIdleTtlMs: env.mcpSessionIdleTtlMs,
    mcpSessionMaxCount: env.mcpSessionMaxCount,
    mcpSessionReapIntervalMs: env.mcpSessionReapIntervalMs,
    logLevel: env.logLevel,
    brokerRateLimitConcurrency: env.brokerRateLimitConcurrency,
    brokerRateLimitMinTimeMs: env.brokerRateLimitMinTimeMs,
    ledgerAccountId: env.ledgerAccountId,
    hederaNetwork: env.hederaNetwork,
    hederaAccountId: env.hederaAccountId,
    hederaPrivateKey: redact(env.hederaPrivateKey),
    evmLedgerNetwork: env.evmLedgerNetwork,
    ethPrivateKey: redact(env.ethPrivateKey),
    rbEncryptionPrivateKey: redact(env.rbEncryptionPrivateKey),
  };
}
