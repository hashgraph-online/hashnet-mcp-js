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
All transports, workflows, and CLI scripts load `.env` automatically via `dotenv`, so once the file is populated you can run `pnpm dev:*`, `pnpm workflow:*`, or tests without re-exporting environment variables.

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

### Workflow Helpers
The server exposes high-level `workflow.*` tools so agents can run complete Registry Broker flows with a single call.

| Tool | Purpose |
| --- | --- |
| `workflow.discovery` | Run `rb.search` + `rb.vectorSearch` |
| `workflow.registerMcp` | Quote → register → wait for completion |
| `workflow.chatSmoke` | Chat session smoke test for a UAID |
| `workflow.opsCheck` | Snapshot stats/metrics/dashboard/protocols |
| `workflow.fullRegistration` | Discovery → registration → chat → ops |

CLI helpers:

```
pnpm workflow:list                      # enumerate available workflows
pnpm workflow:run workflow.registerMcp --payload payloads/register.json
pnpm workflow:run workflow.registerMcp --endpoint https://host/mcp/stream --payload payloads/register.json
pnpm workflow:register                  # interactive wizard to register this server
```

`workflow:run` spawns the local server (if needed) and prints a structured pipeline report. Use `--endpoint https://host/mcp/stream` to target a remote deployment; add `--reuse-server` to skip spawning when pointing at an already-running localhost instance.

`pnpm workflow:register` flow:
1. CLI prompts for display name, alias, description, MCP URL, chat message, and report path.
2. Runs `workflow.registerMcp`, `workflow.chatSmoke`, `workflow.opsCheck` sequentially.
3. Saves `workflow-register-report.json` (configurable) containing:
   - `uaid`
   - Pipeline traces (steps, dry-run flag, UAID context)
   - Claude config snippet with your MCP URL
   - Raw pipeline results (registration/chat/ops)

**Sample report snippet**

```json
{
  "uaid": "uaid:registry:abcd-1234",
  "claudeConfig": {
    "mcpServers": {
      "hashnet": {
        "command": "npx",
        "args": ["@hol/hashnet-mcp@latest", "up"]
      }
    }
  },
  "pipelines": [
    {
      "name": "workflow.registerMcp",
      "steps": [
        { "id": "rb.getRegistrationQuote", "durationMs": 812 },
        { "id": "rb.registerAgent", "durationMs": 1420 }
      ]
    }
  ]
}
```

### Workflow Environment Requirements
- `REGISTRY_BROKER_API_URL` / `REGISTRY_BROKER_API_KEY` – base URL + key for the Registry Broker API (staging/testnet supported).
- `HEDERA_ACCOUNT_ID` / `HEDERA_PRIVATE_KEY` – required for registration, chat, and ops workflows that sign payloads.
- `WORKFLOW_DRY_RUN=1` – skip state-changing steps (quote-only, no registration).
- `BROKER_E2E=1` – opt in to real broker calls inside CI/e2e scripts (otherwise the mock broker is used where possible).

Restart the MCP server after changing any credential so FastMCP snapshots the updated environment.

## NPX Quick Start
```
npx @hol/hashnet-mcp up --transport sse
```
The CLI verifies Node ≥18, installs dependencies (preferring pnpm), copies `.env.example` if needed, and launches the requested transport. Pass `--install-only` to skip auto-start. See `AGENTS.md` for advanced flags.

## Deployment
- `deploy/fly.toml` – Fly.io app manifest exposing `/mcp/stream`.
- `deploy/Dockerfile` – Cloud Run-ready image that builds the project and runs `node dist/index.js`.
- `deploy/README.md` – step-by-step instructions for both targets.

## Architecture Overview

```
[ CLI / Agent ]
       │
       ▼
┌──────────────────────┐
│ MCP Gateway (Hono)   │
│ /mcp/stream & /mcp/sse│
└─────────┬────────────┘
          │ proxies HTTP stream traffic
┌─────────▼────────────┐
│ FastMCP / mcp.ts     │  ← registers `rb.*` + `workflow.*` tools
│   ├─ broker.ts       │  ← wraps RegistryBrokerClient
│   └─ workflows/      │  ← pipeline definitions + registry
└─────────┬────────────┘
          │
          ▼
┌──────────────────────┐
│ Workflow Pipelines   │
│ (discovery/register/ │
│  chat/ops/full)      │
└──────────────────────┘
```

- `src/workflows/pipeline.ts` implements the reusable pipeline engine (steps, hooks, dry-run).
- `src/workflows/*.ts` define domain workflows; importing `src/workflows/index.ts` registers them.
- MCP tools (`workflow.*`) simply call the registered pipelines and return structured reports.

## Examples
- `examples/agent-registration-request.json` mirrors the stricter schema used by `rb.registerAgent` and `rb.getRegistrationQuote`.

## Testing & Automation
- `pnpm test --run --coverage` — runs Vitest in CI mode with V8 coverage, ensuring `src/mcp.ts` and `src/broker.ts` stay above the 90% branch threshold.
- `pnpm test:run` — quick single-pass test run without coverage.
- `pnpm test:tools` — spins up the HTTP-stream gateway (unless one is already running) and exercises every MCP tool end-to-end via the official MCP client (Streamable HTTP transport). Set `TEST_UAID`, `TEST_CHAT_UAID`, and `TEST_REGISTRATION_ATTEMPT_ID` if you want UAID-specific flows to run instead of being skipped.
- `pnpm workflow:list` / `pnpm workflow:run <name>` — inspect and execute the built-in pipelines described above.
- `pnpm workflow:register` — prompts for metadata, runs the registration/chat/ops pipelines, and writes a JSON report (UAID, Claude config snippet, workflow traces).
- `pnpm workflow:e2e` — runs the full registration/chat workflow end-to-end against the real broker (requires `BROKER_E2E=1`).
- `pnpm mock:broker` — boot a lightweight mock Registry Broker for CI/testing without external dependencies.

## Adding New Workflows
1. Create `src/workflows/<name>.ts` exporting a factory that calls `registerPipeline()` with metadata (description, input schema, required env vars).
2. Import the module inside `src/workflows/index.ts` so the pipeline registers at startup.
3. Wire an MCP tool in `src/mcp.ts` (define a `zod` schema, call `runPipeline`, and convert the result with `formatPipelineResult`).
4. Add Vitest coverage in `tests/workflows/<name>.spec.ts` plus CLI smoke coverage if pipelines should be runnable via `workflow:run`.
5. Update README/AGENTS describing the workflow, logging fields, and any CLI flags so downstream agents know how to trigger it.
