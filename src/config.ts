import { config as loadEnv } from 'dotenv';
import { z } from 'zod';

loadEnv();

const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace'] as const;

const envSchema = z
  .object({
    REGISTRY_BROKER_API_URL: z
      .string()
      .url()
      .default('https://registry.hashgraphonline.com/api/v1'),
    REGISTRY_BROKER_API_KEY: z.string().min(1).optional(),
    HEDERA_ACCOUNT_ID: z.string().min(1).optional(),
    HEDERA_PRIVATE_KEY: z.string().min(1).optional(),
    PORT: z.coerce.number().int().positive().default(3333),
    BROKER_MAX_CONCURRENT: z.coerce.number().int().positive().optional(),
    BROKER_MIN_TIME_MS: z.coerce.number().int().nonnegative().optional(),
    BROKER_RESERVOIR: z.coerce.number().int().positive().optional(),
    BROKER_RESERVOIR_REFRESH_INTERVAL_MS: z.coerce.number().int().positive().optional(),
    BROKER_RESERVOIR_REFRESH_AMOUNT: z.coerce.number().int().positive().optional(),
    BROKER_RATE_LIMIT_REDIS_URL: z.string().url().optional(),
    LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
    WORKFLOW_DRY_RUN: z
      .enum(['0', '1'])
      .optional()
      .transform((value) => value === '1'),
  })
  .superRefine((val, ctx) => {
    const hasAccount = Boolean(val.HEDERA_ACCOUNT_ID);
    const hasKey = Boolean(val.HEDERA_PRIVATE_KEY);
    if (hasAccount !== hasKey) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'HEDERA_ACCOUNT_ID and HEDERA_PRIVATE_KEY must both be set to enable registrationAutoTopUp.',
      });
    }
  });

const parsed = envSchema.safeParse({
  REGISTRY_BROKER_API_URL: process.env.REGISTRY_BROKER_API_URL,
  REGISTRY_BROKER_API_KEY: process.env.REGISTRY_BROKER_API_KEY,
  HEDERA_ACCOUNT_ID: process.env.HEDERA_ACCOUNT_ID,
  HEDERA_PRIVATE_KEY: process.env.HEDERA_PRIVATE_KEY,
  PORT: process.env.PORT,
  BROKER_MAX_CONCURRENT: process.env.BROKER_MAX_CONCURRENT,
  BROKER_MIN_TIME_MS: process.env.BROKER_MIN_TIME_MS,
  BROKER_RESERVOIR: process.env.BROKER_RESERVOIR,
  BROKER_RESERVOIR_REFRESH_INTERVAL_MS: process.env.BROKER_RESERVOIR_REFRESH_INTERVAL_MS,
  BROKER_RESERVOIR_REFRESH_AMOUNT: process.env.BROKER_RESERVOIR_REFRESH_AMOUNT,
  BROKER_RATE_LIMIT_REDIS_URL: process.env.BROKER_RATE_LIMIT_REDIS_URL,
  LOG_LEVEL: process.env.LOG_LEVEL,
  WORKFLOW_DRY_RUN: process.env.WORKFLOW_DRY_RUN,
});

if (!parsed.success) {
  throw new Error(`Invalid environment configuration:\n${parsed.error.toString()}`);
}

export const config = {
  registryBrokerUrl: parsed.data.REGISTRY_BROKER_API_URL,
  registryBrokerApiKey: parsed.data.REGISTRY_BROKER_API_KEY,
  hederaAccountId: parsed.data.HEDERA_ACCOUNT_ID,
  hederaPrivateKey: parsed.data.HEDERA_PRIVATE_KEY,
  port: parsed.data.PORT,
  autoTopUpEnabled: Boolean(parsed.data.HEDERA_ACCOUNT_ID && parsed.data.HEDERA_PRIVATE_KEY),
  rateLimit: (() => {
    const {
      BROKER_MAX_CONCURRENT,
      BROKER_MIN_TIME_MS,
      BROKER_RESERVOIR,
      BROKER_RESERVOIR_REFRESH_AMOUNT,
      BROKER_RESERVOIR_REFRESH_INTERVAL_MS,
      BROKER_RATE_LIMIT_REDIS_URL,
    } = parsed.data;
    const hasLimiter =
      BROKER_MAX_CONCURRENT ||
      BROKER_MIN_TIME_MS ||
      BROKER_RESERVOIR ||
      BROKER_RATE_LIMIT_REDIS_URL;
    if (!hasLimiter) return undefined;
    return {
      maxConcurrent: BROKER_MAX_CONCURRENT,
      minTimeMs: BROKER_MIN_TIME_MS,
      reservoir: BROKER_RESERVOIR,
      reservoirRefreshAmount: BROKER_RESERVOIR_REFRESH_AMOUNT,
      reservoirRefreshIntervalMs: BROKER_RESERVOIR_REFRESH_INTERVAL_MS,
      redis: BROKER_RATE_LIMIT_REDIS_URL
        ? {
            url: BROKER_RATE_LIMIT_REDIS_URL,
          }
        : undefined,
    };
  })(),
  workflowDryRun: parsed.data.WORKFLOW_DRY_RUN ?? false,
  httpStreamPort: parsed.data.HTTP_STREAM_PORT,
  logLevel: parsed.data.LOG_LEVEL,
};

export type AppConfig = typeof config;
