import type { NextFunction, Request, RequestHandler, Response } from "express";

interface RequestBucket {
  count: number;
  resetAt: number;
}

export interface RequestRateLimitResult {
  allowed: boolean;
  retryAfterSeconds?: number;
}

export interface RequestRateLimiter {
  check(clientId: string): RequestRateLimitResult;
}

export interface RequestRateLimiterOptions {
  maxRequests?: number;
  windowMs?: number;
  now?: () => number;
}

const DEFAULT_MAX_REQUESTS = 60;
const DEFAULT_WINDOW_MS = 60_000;

function sendJsonRpcError(res: Response, status: number, message: string): void {
  res.status(status).json({
    jsonrpc: "2.0",
    error: {
      code: -32000,
      message,
    },
    id: null,
  });
}

function pruneExpiredBuckets(
  buckets: Map<string, RequestBucket>,
  currentTime: number,
): void {
  for (const [clientId, bucket] of buckets.entries()) {
    if (bucket.resetAt <= currentTime) {
      buckets.delete(clientId);
    }
  }
}

function resolveClientId(req: Request): string {
  const forwardedFor = req.header("x-forwarded-for");
  if (forwardedFor) {
    const [firstClient] = forwardedFor.split(",", 1);
    if (firstClient && firstClient.trim().length > 0) {
      return firstClient.trim();
    }
  }

  if (req.ip && req.ip.length > 0) {
    return req.ip;
  }

  return req.socket.remoteAddress ?? "unknown";
}

export function createRequestRateLimiter(
  options: RequestRateLimiterOptions = {},
): RequestRateLimiter {
  const maxRequests = options.maxRequests ?? DEFAULT_MAX_REQUESTS;
  const windowMs = options.windowMs ?? DEFAULT_WINDOW_MS;
  const now = options.now ?? Date.now;

  if (!Number.isInteger(maxRequests) || maxRequests <= 0) {
    throw new Error("maxRequests must be a positive integer");
  }

  if (!Number.isInteger(windowMs) || windowMs <= 0) {
    throw new Error("windowMs must be a positive integer");
  }

  const buckets = new Map<string, RequestBucket>();

  return {
    check(clientId: string): RequestRateLimitResult {
      const currentTime = now();
      pruneExpiredBuckets(buckets, currentTime);

      const existing = buckets.get(clientId);
      if (!existing) {
        buckets.set(clientId, {
          count: 1,
          resetAt: currentTime + windowMs,
        });
        return { allowed: true };
      }

      if (existing.count >= maxRequests) {
        return {
          allowed: false,
          retryAfterSeconds: Math.max(
            1,
            Math.ceil((existing.resetAt - currentTime) / 1000),
          ),
        };
      }

      existing.count += 1;
      return { allowed: true };
    },
  };
}

export function enforceRequestRateLimit(
  req: Request,
  res: Response,
  limiter: RequestRateLimiter,
): boolean {
  const result = limiter.check(resolveClientId(req));
  if (result.allowed) {
    return true;
  }

  if (result.retryAfterSeconds) {
    res.setHeader("retry-after", String(result.retryAfterSeconds));
  }

  sendJsonRpcError(
    res,
    429,
    `Rate limit exceeded. Retry in ${result.retryAfterSeconds ?? 1} seconds.`,
  );
  return false;
}

export function createRequestRateLimitMiddleware(
  limiter: RequestRateLimiter,
): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!enforceRequestRateLimit(req, res, limiter)) {
      return;
    }

    next();
  };
}
