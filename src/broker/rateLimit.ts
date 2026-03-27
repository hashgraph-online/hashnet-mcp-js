import Bottleneck from "bottleneck";

import type { EnvConfig } from "../config/env.js";

export interface BrokerRateLimiter {
  schedule<T>(fn: () => Promise<T>): Promise<T>;
  stop(): Promise<void>;
}

export function createBrokerRateLimiter(env: Pick<EnvConfig, "brokerRateLimitConcurrency" | "brokerRateLimitMinTimeMs">): BrokerRateLimiter {
  const limiter = new Bottleneck({
    maxConcurrent: env.brokerRateLimitConcurrency,
    minTime: env.brokerRateLimitMinTimeMs,
  });

  return {
    schedule<T>(fn: () => Promise<T>): Promise<T> {
      return limiter.schedule(fn);
    },
    async stop(): Promise<void> {
      await limiter.stop({ dropWaitingJobs: false });
    },
  };
}
