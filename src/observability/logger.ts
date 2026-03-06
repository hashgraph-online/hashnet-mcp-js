import pino from "pino";

import type { EnvConfig } from "../config/env.js";

export type AppLogger = ReturnType<typeof createLogger>;

export function createLogger(env: Pick<EnvConfig, "logLevel">) {
  return pino(
    {
      level: env.logLevel,
      redact: {
        paths: [
          "req.headers.authorization",
          "authorization",
          "token",
          "apiKey",
          "registryBrokerApiKey",
          "hederaPrivateKey",
          "ethPrivateKey",
          "rbEncryptionPrivateKey",
        ],
        censor: "***REDACTED***",
      },
      base: undefined,
      timestamp: pino.stdTimeFunctions.isoTime,
    },
    pino.destination({ dest: 2, sync: false }),
  );
}
