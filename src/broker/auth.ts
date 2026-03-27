import { SERVER_NAME } from "../constants.js";
import type { EnvConfig } from "../config/env.js";
import type { AppLogger } from "../observability/logger.js";
import type {
  LedgerCredentialAuthOptionsLike,
  LedgerVerifyResponseLike,
  RegistryBrokerClientLike,
} from "./client.js";

export type BrokerAuthMode = "none" | "apiKey" | "hedera" | "evm";
export type LedgerAuthMode = Exclude<BrokerAuthMode, "apiKey">;

export interface BrokerAuthAvailability {
  brokerApiKeyConfigured: boolean;
  ledgerAuthConfigured: boolean;
  ledgerAuthMode: LedgerAuthMode;
  paidToolAuthAvailable: boolean;
}

export interface BrokerAuthState {
  cachedLedgerVerification?: LedgerVerifyResponseLike;
  pendingLedgerVerification?: Promise<LedgerVerifyResponseLike>;
}

type BrokerAuthEnv = Pick<
  EnvConfig,
  | "registryBrokerApiKey"
  | "ledgerAccountId"
  | "hederaAccountId"
  | "hederaNetwork"
  | "hederaPrivateKey"
  | "evmLedgerNetwork"
  | "ethPrivateKey"
>;

interface ResolvedLedgerCredentials extends LedgerCredentialAuthOptionsLike {
  mode: Exclude<LedgerAuthMode, "none">;
}

function resolveLedgerCredentials(env: BrokerAuthEnv): ResolvedLedgerCredentials | null {
  const accountId = env.ledgerAccountId ?? env.hederaAccountId;

  if (accountId && env.hederaNetwork && env.hederaPrivateKey) {
    return {
      mode: "hedera",
      accountId,
      network: env.hederaNetwork,
      hederaPrivateKey: env.hederaPrivateKey,
    };
  }

  if (accountId && env.evmLedgerNetwork && env.ethPrivateKey) {
    return {
      mode: "evm",
      accountId,
      network: env.evmLedgerNetwork,
      evmPrivateKey: env.ethPrivateKey,
    };
  }

  return null;
}

export function createBrokerAuthState(): BrokerAuthState {
  return {};
}

export function getBrokerAuthAvailability(env: BrokerAuthEnv): BrokerAuthAvailability {
  const ledgerCredentials = resolveLedgerCredentials(env);
  const brokerApiKeyConfigured = Boolean(env.registryBrokerApiKey);

  return {
    brokerApiKeyConfigured,
    ledgerAuthConfigured: ledgerCredentials !== null,
    ledgerAuthMode: ledgerCredentials?.mode ?? "none",
    paidToolAuthAvailable: brokerApiKeyConfigured || ledgerCredentials !== null,
  };
}

async function authenticateWithLedger(
  client: RegistryBrokerClientLike,
  env: BrokerAuthEnv,
  logger: AppLogger,
  state: BrokerAuthState,
): Promise<LedgerVerifyResponseLike> {
  if (state.cachedLedgerVerification) {
    return state.cachedLedgerVerification;
  }

  if (!state.pendingLedgerVerification) {
    const ledgerCredentials = resolveLedgerCredentials(env);

    if (!ledgerCredentials) {
      throw new Error(
        "Paid tools require REGISTRY_BROKER_API_KEY or ledger credentials (LEDGER_ACCOUNT_ID/HEDERA_ACCOUNT_ID plus matching network and private key).",
      );
    }

    state.pendingLedgerVerification = client
      .authenticateWithLedgerCredentials({
        ...ledgerCredentials,
        label: SERVER_NAME,
        logger,
      })
      .then((verification) => {
        state.cachedLedgerVerification = verification;
        return verification;
      })
      .finally(() => {
        state.pendingLedgerVerification = undefined;
      });
  }

  return state.pendingLedgerVerification;
}

export async function ensureBrokerClientAuth(
  client: RegistryBrokerClientLike,
  env: BrokerAuthEnv,
  logger: AppLogger,
  state: BrokerAuthState,
): Promise<BrokerAuthMode> {
  if (env.registryBrokerApiKey) {
    return "apiKey";
  }

  const verification = await authenticateWithLedger(client, env, logger, state);
  client.setLedgerApiKey(verification.key);
  client.setDefaultHeader("x-account-id", verification.accountId);

  const availability = getBrokerAuthAvailability(env);
  return availability.ledgerAuthMode === "none" ? "none" : availability.ledgerAuthMode;
}
