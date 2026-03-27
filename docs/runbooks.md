# Runbooks

## Local Startup

1. Install dependencies: `pnpm install`
2. Configure environment: `cp .env.example .env`
3. Start HTTP transport: `pnpm dev:http`
4. Start stdio transport: `pnpm dev:stdio`

## Basic Validation

- Build: `pnpm build`
- Typecheck: `pnpm typecheck`
- Tests: `pnpm test:run`
- Stub ban: `pnpm check:no-stubs`
- HTTP smoke: `pnpm smoke:http`
- stdio smoke: `pnpm smoke:stdio`

## Common Failures

1. Startup fails with unsafe host error
- Cause: `MCP_HOST` is non-local and `MCP_SERVER_BEARER_TOKEN` is missing.
- Fix: set token or bind to `127.0.0.1`.

2. Paid tools return auth errors
- Cause: `REGISTRY_BROKER_API_KEY` missing/invalid.
- Fix: configure valid key.

3. HTTP calls rejected with 403
- Cause: request `Origin` is not in `MCP_ALLOWED_ORIGINS`.
- Fix: add origin to allowlist.

4. Smoke tests time out
- Cause: server not reachable on configured host/port or blocked network to Broker.
- Fix: verify `MCP_HOST`, `MCP_PORT`, Broker URL reachability, and credentials.

## Production-Shaped Hardening (Next)

- Replace bearer gate with OAuth-aligned MCP authorization.
- Add tenant isolation and scoped tool permissions.
- Add durable storage for session/workflow continuity.
- Add metrics backend and SLO-based alerting.
