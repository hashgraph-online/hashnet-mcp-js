import { describe, expect, test } from "vitest";

import { createRequestRateLimiter } from "../../src/transports/requestRateLimit.js";

describe("request rate limiter", () => {
  test("blocks requests that exceed the configured budget until the window resets", () => {
    let currentTime = 1_000;
    const limiter = createRequestRateLimiter({
      maxRequests: 2,
      windowMs: 1_000,
      now: () => currentTime,
    });

    expect(limiter.check("client-1").allowed).toBe(true);
    expect(limiter.check("client-1").allowed).toBe(true);

    const blocked = limiter.check("client-1");
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBe(1);

    currentTime = 2_001;
    expect(limiter.check("client-1").allowed).toBe(true);
  });
});
