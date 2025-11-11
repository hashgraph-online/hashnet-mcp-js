# Hashnet MCP

Node/TypeScript Model Context Protocol server exposing the Hashgraph Online Registry Broker via FastMCP, with both stdio and SSE transports. See `AGENTS.md` for full contributor guidance.

## Directory Layout
- `src/` – application source code. Core entrypoints (`mcp.ts`, `broker.ts`) live here.
- `src/schemas/` – shared zod schemas and SDK-driven types.
- `src/transports/` – stdio/SSE transport helpers plus bootstrap glue.
- `tests/` – Vitest specs mirroring the `src/` tree.
- `examples/` – sample payloads, env snippets, and integration fixtures.

## Getting Started
```
pnpm install
pnpm dev:stdio # once scripts are added
```
Copy `.env.example` to `.env` and fill in Registry Broker + Hedera credentials before running transports.

### Zero-touch Quickstart
```
pnpm quickstart
```
The DX script will:
1. Copy `.env.example` (and let you inject your Registry Broker API key).
2. Install dependencies, build the project, and run smoke tests.
3. Launch the dev transport you choose (`sse` by default) with a stylized CLI experience.

## Logging & Health
- `LOG_LEVEL` controls `pino` verbosity (`fatal`, `error`, `warn`, `info`, `debug`, `trace`).
- Every tool invocation is logged with a requestId plus duration; SSE/stdio transport logs each HTTP request.
- `/healthz` returns `{ status, uptime, tools }` so Fly.io/Cloud Run probes can verify readiness.
- Optional rate limiting is enabled via the `BROKER_*` variables; point `BROKER_RATE_LIMIT_REDIS_URL` at your Redis cluster to queue requests across replicas.
- `HTTP_STREAM_PORT` lets you pin the internal FastMCP HTTP-stream backend to a specific port (defaults to `PORT + 1`). External clients always connect to `http://<host>:PORT/mcp/stream` (Streamable HTTP) or `http://<host>:PORT/mcp/sse` (SSE fallback).

## MCP Client Configuration
Claude Desktop (stdio):

```json
{
  "mcpServers": {
    "hashgraph-standards": {
      "command": "pnpm",
      "args": ["dev:stdio"],
      "env": {
        "REGISTRY_BROKER_API_URL": "https://registry.hashgraphonline.com/api/v1",
        "REGISTRY_BROKER_API_KEY": "YOUR_KEY"
      }
    }
  }
}
```

Claude Code / Cursor (HTTP streaming): point the client at `https://<host>/mcp/stream` once deployed (see `deploy/README.md`). Use `pnpm dev:sse` locally to expose the same endpoint at `http://localhost:3333/mcp/stream`. SSE fallback remains available at `/mcp/sse` for clients that still require it.

## NPX Quick Start
```
npx @hol/hashnet-mcp up --transport sse
```
The CLI verifies Node ≥18, installs dependencies (preferring pnpm), copies `.env.example` if needed, and launches the requested transport. Pass `--install-only` to skip auto-start. See `AGENTS.md` for advanced flags.

## Deployment
- `deploy/fly.toml` – Fly.io app manifest exposing `/mcp/stream`.
- `deploy/Dockerfile` – Cloud Run-ready image that builds the project and runs `node dist/index.js`.
- `deploy/README.md` – step-by-step instructions for both targets.

## Examples
- `examples/agent-registration-request.json` mirrors the stricter schema used by `rb.registerAgent` and `rb.getRegistrationQuote`.

## Testing
- `pnpm test --run --coverage` — runs Vitest in CI mode with V8 coverage, ensuring `src/mcp.ts` and `src/broker.ts` stay above the 90% branch threshold.
- `pnpm test:run` — quick single-pass test run without coverage.
- `pnpm test:tools` — spins up the HTTP-stream gateway (unless one is already running) and exercises every MCP tool end-to-end via the official MCP client (Streamable HTTP transport). Set `TEST_UAID`, `TEST_CHAT_UAID`, and `TEST_REGISTRATION_ATTEMPT_ID` if you want UAID-specific flows to run instead of being skipped.
