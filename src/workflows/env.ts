import type { Logger } from 'pino';

interface EnsureEnvOptions {
  logger?: Logger;
  context?: string;
}

export function ensureRequiredEnv(requiredEnv: string[] | undefined, options?: EnsureEnvOptions) {
  if (!requiredEnv?.length) return;

  const missing = getMissingEnvVars(requiredEnv);
  if (missing.length > 0) {
    options?.logger?.error?.({ missingEnv: missing }, 'workflow.env.missing');
    const label = options?.context ?? 'workflow';
    throw new Error(`Missing required environment variables for ${label}: ${missing.join(', ')}`);
  }
}

export function getMissingEnvVars(requiredEnv: string[]): string[] {
  return requiredEnv.filter((variable) => {
    const value = process.env[variable];
    return value === undefined || value.length === 0;
  });
}

export function assertEnvVars(requiredEnv: string[], context: string) {
  ensureRequiredEnv(requiredEnv, { context });
}
