export interface FeatureFlags {
  featureLegacySse: boolean;
  featureMemorySqlite: boolean;
  featureMemoryRedis: boolean;
  featureLedgerAuth: boolean;
  featureEncryptedChat: boolean;
}

function parseBooleanFlag(value: string | undefined): boolean {
  if (!value) {
    return false;
  }

  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

export function getFeatureFlags(env: NodeJS.ProcessEnv = process.env): FeatureFlags {
  return {
    featureLegacySse: parseBooleanFlag(env.FEATURE_LEGACY_SSE),
    featureMemorySqlite: parseBooleanFlag(env.FEATURE_MEMORY_SQLITE),
    featureMemoryRedis: parseBooleanFlag(env.FEATURE_MEMORY_REDIS),
    featureLedgerAuth: parseBooleanFlag(env.FEATURE_LEDGER_AUTH),
    featureEncryptedChat: parseBooleanFlag(env.FEATURE_ENCRYPTED_CHAT),
  };
}
