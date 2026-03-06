# HOL MCP Server POC

No-stubs MCP server that bridges MCP tools to the HOL Registry Broker using `@hashgraphonline/standards-sdk`.

## Quickstart

1. Install dependencies:
   - `pnpm install`
2. Configure env:
   - `cp .env.example .env`
   - set `REGISTRY_BROKER_API_KEY` for paid flows
3. Run transports:
   - HTTP: `pnpm dev:http`
   - stdio: `pnpm dev:stdio`
   - HTTP + legacy SSE: `pnpm dev:http:compat`

## Commands

- `pnpm build`
- `pnpm start`
- `pnpm test:run`
- `pnpm test:coverage`
- `pnpm check:no-stubs`
- `pnpm smoke:http`
- `pnpm smoke:stdio`

## Security Defaults

- Binds to `127.0.0.1` by default.
- Validates `Origin` for HTTP requests when present.
- Supports optional `MCP_SERVER_BEARER_TOKEN` gate for HTTP transport.
- Reaps idle HTTP sessions and enforces a maximum active session count.
- Redacts sensitive secrets in logs.

## Tool Surface

- Discovery: `hol.stats`, `hol.capabilities`, `hol.search`, `hol.vectorSearch`, `hol.resolveUaid`
- Chat: `hol.chat.createSession`, `hol.chat.sendMessage`, `hol.chat.history`, `hol.chat.end`
- Registration: `hol.getRegistrationQuote`, `hol.registerAgent`, `hol.waitForRegistrationCompletion`
- Workflows: `workflow.discovery`, `workflow.registration`

All tools now return a structured success envelope in `structuredContent`:

- `ok`
- `data`
- `meta`

Tool failures return `isError: true` plus a structured error envelope with machine-readable `code`, `category`, and `retryable` fields.

## Transport Compatibility

| Transport | Endpoint(s) | Status |
|---|---|---|
| stdio | process stdin/stdout | supported |
| Streamable HTTP | `/mcp`, `/mcp/stream` | supported |
| legacy HTTP+SSE | `/mcp/sse`, `/mcp/messages` | supported behind `FEATURE_LEGACY_SSE=1` |

## HTTP Runtime Endpoints

- MCP: `/mcp`, `/mcp/stream`
- Health: `/healthz`
- Readiness: `/readyz`
- Metrics: `/metrics`

## Environment Matrix

| Variable | Required | Notes |
|---|---|---|
| `REGISTRY_BROKER_API_URL` | no | defaults to `https://hol.org/registry/api/v1` |
| `REGISTRY_BROKER_API_KEY` | no | required for paid tools (chat/registration) |
| `BROKER_REQUEST_TIMEOUT_MS` | no | default upstream request timeout is `15000` |
| `MCP_TRANSPORT` | no | `http` (default) or `stdio` |
| `MCP_HOST` | no | defaults to `127.0.0.1` |
| `MCP_PORT` | no | defaults to `3333` |
| `MCP_ALLOWED_ORIGINS` | no | used for HTTP Origin validation |
| `MCP_SERVER_BEARER_TOKEN` | no | required when binding to non-local host |
| `MCP_SESSION_IDLE_TTL_MS` | no | idle HTTP session timeout, defaults to `900000` |
| `MCP_SESSION_MAX_COUNT` | no | maximum active HTTP sessions, defaults to `250` |
| `MCP_SESSION_REAP_INTERVAL_MS` | no | idle session reap interval, defaults to `60000` |

## No-Stubs Validation

- Static stub ban check in CI.
- Smoke tests validate initialize -> tools/list -> real tool calls.
- Live Broker calls required for final acceptance gates.
