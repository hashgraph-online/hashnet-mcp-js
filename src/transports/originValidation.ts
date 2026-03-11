import type { Request, Response } from "express";

import type { AppLogger } from "../observability/logger.js";

function normalizeOrigin(origin: string): string {
  const trimmed = origin.trim();
  let end = trimmed.length;

  while (end > 0 && trimmed[end - 1] === "/") {
    end -= 1;
  }

  return trimmed.slice(0, end);
}

function matchesWildcardPort(origin: URL, pattern: string): boolean {
  const base = pattern.slice(0, -2);

  try {
    const baseUrl = new URL(base);
    return origin.protocol === baseUrl.protocol && origin.hostname === baseUrl.hostname;
  } catch {
    return false;
  }
}

function isOriginAllowed(origin: string, allowedOrigins: string[]): boolean {
  const normalizedOrigin = normalizeOrigin(origin);

  let parsedOrigin: URL;
  try {
    parsedOrigin = new URL(normalizedOrigin);
  } catch {
    return false;
  }

  return allowedOrigins.some((pattern) => {
    const normalizedPattern = normalizeOrigin(pattern);

    if (normalizedPattern === "*") {
      return true;
    }

    if (normalizedPattern.endsWith(":*")) {
      return matchesWildcardPort(parsedOrigin, normalizedPattern);
    }

    return normalizedOrigin === normalizedPattern;
  });
}

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

export function enforceOrigin(
  req: Request,
  res: Response,
  allowedOrigins: string[],
  logger: AppLogger,
): boolean {
  const originHeader = req.header("origin");

  if (!originHeader) {
    return true;
  }

  if (isOriginAllowed(originHeader, allowedOrigins)) {
    return true;
  }

  logger.warn(
    {
      origin: originHeader,
      allowedOrigins,
      path: req.path,
    },
    "origin denied",
  );

  sendJsonRpcError(res, 403, "Forbidden: Origin not allowed");
  return false;
}

export function enforceBearerAuth(
  req: Request,
  res: Response,
  bearerToken: string | undefined,
): boolean {
  if (!bearerToken) {
    return true;
  }

  const auth = req.header("authorization");
  const expected = `Bearer ${bearerToken}`;

  if (auth === expected) {
    return true;
  }

  res.status(401).json({
    jsonrpc: "2.0",
    error: {
      code: -32001,
      message: "Unauthorized",
    },
    id: null,
  });
  return false;
}
