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

#### Claude Code auto-install
- `pnpm claude:install --endpoint http://localhost:3333/mcp/stream` — adds/updates the MCP entry inside Claude Code’s config (`~/Library/Application Support/Claude/claude_code_config.json` on macOS; `%APPDATA%\Claude\claude_code_config.json` on Windows; `~/.config/Claude/claude_code_config.json` on Linux).
- Pass `--name <id>` to customize the MCP server handle or `--config <path>` if your Claude Code build stores config elsewhere.
- Use `--force` to overwrite an existing entry, `--dry-run` to preview changes, and `--skip-backup` to avoid writing a `.bak` file next to the config.
- After running the script, restart Claude Code so the client discovers the new `hol.*` tool catalog automatically.

#### Cursor auto-install
- `pnpm cursor:install --endpoint http://localhost:3333/mcp/stream` — writes/updates the `modelContextProtocol.servers` array inside Cursor’s `settings.json` (`~/Library/Application Support/Cursor/User/settings.json` on macOS; `%APPDATA%\Cursor\User\settings.json` on Windows; `~/.config/Cursor/User/settings.json` on Linux).
- Use `--name <id>` to change the MCP handle, `--config <path>` to point at a custom settings file, and `--force` if you need to replace an existing server entry.
- Add `--dry-run` to preview the merged JSON. Once applied, restart Cursor so the MCP list refreshes and exposes the `hol.*` commands.

### Workflow Helpers
Run `pnpm workflow:list` to see the live catalog (the script reads `src/workflows/index.ts`, so it never goes stale). Each workflow’s golden-path payload lives under `examples/workflows/`—copy one, replace the placeholder UAIDs/keys, and pass it to `pnpm workflow:run <workflow> --payload <file>`.

**Discovery & Ops**
- `workflow.discovery` – `hol.search` + `hol.vectorSearch` (`examples/workflows/workflow.discovery.json`)
- `workflow.erc8004Discovery` – ERC-8004 search + namespace lookup (`examples/workflows/workflow.erc8004Discovery.json`)
- `workflow.opsCheck` – Stats/metrics/protocol snapshot (`examples/workflows/workflow.opsCheck.json`)
- `workflow.registryBrokerShowcase` – Discovery + analytics + optional chat (`examples/workflows/workflow.registryBrokerShowcase.json`)

**Registration Pipelines**
- `workflow.registerMcp` – Quote → register → wait (`examples/workflows/workflow.registerMcp.json`)
- `workflow.registerAgentAdvanced` – Additional registries + optional update + HITL credit top-up (`examples/workflows/workflow.registerAgentAdvanced.json`)
- `workflow.registerAgentErc8004` – ERC-8004 network resolution + optional ledger verification (`examples/workflows/workflow.registerAgentErc8004.json`)
- `workflow.erc8004X402` – ERC-8004 registration funded via X402 with follow-up chat (`examples/workflows/workflow.erc8004X402.json`)
- `workflow.x402Registration` – General-purpose registration paid for by X402 credits (`examples/workflows/workflow.x402Registration.json`)
- `workflow.fullRegistration` – Discovery → registration → chat → ops composite (`examples/workflows/workflow.fullRegistration.json`)

**Credit & Ledger Utilities**
- `workflow.ledgerAuth` – Create + verify ledger challenges (`examples/workflows/workflow.ledgerAuth.json`)
- `workflow.x402TopUp` – Buy credits via X402 (`examples/workflows/workflow.x402TopUp.json`)
- `workflow.historyTopUp` – Chat + history compaction + automatic HBAR purchases on 402s (`examples/workflows/workflow.historyTopUp.json`)

**Chat & Interop**
- `workflow.chatSmoke` – Session lifecycle validation (`examples/workflows/workflow.chatSmoke.json`)
- `workflow.openrouterChat` – Discover an OpenRouter UAID and send an authenticated message (`examples/workflows/workflow.openrouterChat.json`)
- `workflow.agentverseBridge` – Relay between a local UAID and Agentverse (`examples/workflows/workflow.agentverseBridge.json`)

Common CLI patterns:

```
pnpm workflow:list
pnpm workflow:run workflow.registerAgentAdvanced --payload examples/workflows/workflow.registerAgentAdvanced.json
pnpm workflow:run workflow.openrouterChat --payload examples/workflows/workflow.openrouterChat.json --endpoint https://host/mcp/stream
pnpm workflow:register
pnpm workflow:register:advanced
pnpm workflow:register:erc8004
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
        "args": ["@hol-org/hashnet-mcp@latest", "up"]
      }
    }
  },
  "pipelines": [
    {
      "name": "workflow.registerMcp",
      "steps": [
        { "id": "hol.getRegistrationQuote", "durationMs": 812 },
        { "id": "hol.registerAgent", "durationMs": 1420 }
      ]
    }
  ]
}
```

During `workflow.registerMcp`, the CLI always attempts to spend the API key’s existing credits first. Only if the broker rejects the registration with a 402 does the script fetch the latest quote, show the required/available credits plus the estimated ℏ charge, and ask for HITL approval before calling `purchaseCreditsWithHbar`. It then polls the quote endpoint until the newly purchased credits appear so you never pay without seeing the balance update. Set `BROKER_AUTO_TOP_UP=1` if you need the “fire-and-forget” auto top-up behaviour with no prompts.

#### Workflow Environment Requirements
- Every workflow requires `REGISTRY_BROKER_API_KEY`. Discovery/ops flows can run with just that variable.
- Registration workflows (`workflow.register*`, `workflow.fullRegistration`) will prompt for purchases when credits are low. Provide `HEDERA_ACCOUNT_ID` + `HEDERA_PRIVATE_KEY` to allow automatic HBAR-based top-ups; otherwise the pipeline aborts on 402.
- X402 flows (`workflow.x402*`, `workflow.erc8004X402`) also need an EVM private key plus any ledger verification payloads referenced in the sample JSON.
- Chat/interop flows (`workflow.chatSmoke`, `workflow.agentverseBridge`, `workflow.openrouterChat`, `workflow.historyTopUp`) require valid UAIDs and, when applicable, bearer tokens for the downstream service.
- `examples/workflows/*.json` files include clearly named placeholders (e.g., `0xYOUR_EVM_PRIVATE_KEY`). Replace them before running `workflow:run`; keeping them as-is will cause schema validation or broker auth failures.

### Hol Tool Catalog
These FastMCP tools are available everywhere the server runs (CLI, Claude Desktop, Claude Code, Cursor, or any MCP-compliant client).

| Tool | Purpose |
| --- | --- |
| `hol.search.help` | Markdown primer that documents filters and usage for search-heavy agents. |
| `hol.search` | Keyword search across the Registry Broker catalog with filtering and sorting controls. |
| `hol.vectorSearch` | Embedding-backed discovery endpoint for semantic matches. |
| `hol.resolveUaid` | Look up metadata and trust status for a UAID or alias. |
| `hol.closeUaidConnection` | Forcibly closes any active UAID tunnel after ops or chat completes. |
| `hol.getRegistrationQuote` | Fetch cost + prerequisites before registering a new agent. |
| `hol.registerAgent` | Submit a signed registration payload to the broker. |
| `hol.waitForRegistrationCompletion` | Poll the broker until a registration attempt succeeds, fails, or times out. |
| `hol.chat.createSession` | Start a chat session scoped to a UAID. |
| `hol.chat.sendMessage` | Send a broker-routed chat message within an existing session. |
| `hol.chat.history` | Retrieve the message transcript for observability or resume flows. |
| `hol.chat.compact` | Truncate chat history while preserving a fixed number of recent entries. |
| `hol.chat.end` | End the active session and release broker-side resources. |
| `hol.listProtocols` | Enumerate known Registry Broker protocols plus transport metadata. |
| `hol.detectProtocol` | Inspect headers/body to auto-detect which broker protocol applies. |
| `hol.stats` | Aggregate registry stats (totals, growth, health). |
| `hol.metricsSummary` | Pull summarized broker metrics for dashboards. |
| `hol.dashboardStats` | Fetch the dashboard-friendly stats bundle used by ops workflows. |
| `hol.credits.balance` | Return API key, Hedera, and (optionally) X402 credit balances from `/credits/balance`. |

#### Invoking Tools from the CLI
- `pnpm test:tools` — boot the SSE transport on `http://localhost:3333/mcp/stream` and run every `hol.*` tool with sample payloads (set `TEST_UAID`, `TEST_CHAT_UAID`, `TEST_REGISTRATION_ATTEMPT_ID` so UAID/chat steps execute instead of skipping). No need to append `--spawn`; the script already starts/stops the local server.
- `pnpm test:tools:mock` — smoke-test the CLI against the bundled mock MCP server (no registry/Broker access required). Useful for CI to verify the harness exits cleanly with code 0.
- `pnpm test:tools --endpoint https://host/mcp/stream` — hit a remote deployment without spawning a local server; combine with `--port <n>` when using `--spawn` to change the local port.
- Use `TEST_UAID=<uaid> TEST_CHAT_UAID=<uaid> pnpm test:tools --spawn` to pass environment variables inline; the harness reports missing vars and skips dependent tools if they are not provided.
- Set `BROKER_PROTOCOL_TOOLS=1` if your API key has access to the `/protocols` + `/detect-protocol` endpoints; otherwise those scenarios are skipped (the staging broker currently returns 404 for those routes).
- For ad-hoc calls, point `scripts/run-tool-suite.ts` at any MCP endpoint (`tsx scripts/run-tool-suite.ts --endpoint ...`) and edit the scenarios array to focus on a subset of tools or custom payloads.

### Workflow Environment Requirements
- `REGISTRY_BROKER_API_URL` / `REGISTRY_BROKER_API_KEY` – base URL + key for the Registry Broker API (staging/testnet supported).
- `HEDERA_ACCOUNT_ID` / `HEDERA_PRIVATE_KEY` – optional; only required if you want the CLI to purchase credits on your behalf when the API key runs dry.
- `WORKFLOW_DRY_RUN=1` – skip state-changing steps (quote-only, no registration).
- `BROKER_E2E=1` – opt in to real broker calls inside CI/e2e scripts (otherwise the mock broker is used where possible).
- `BROKER_AUTO_TOP_UP=1` – opt in to automatic broker purchases without prompts (defaults to `0`, which enables HITL confirmation).
- Tool-suite fixtures (optional): `TEST_UAID`, `TEST_CHAT_UAID`, `TEST_REGISTRATION_ATTEMPT_ID`, and `BROKER_PROTOCOL_TOOLS`. Populate these in `.env` (see `.env.example`) so `pnpm test:tools` can run UAID/chat flows locally and skip protocol checks unless your API key has access. Leave them blank to let the suite auto-discover UAIDs/attempt IDs from preceding steps.

Each workflow definition lists its required env vars and the pipeline runner will fail fast (before touching the broker) if any are missing. Restart the MCP server after changing credentials so FastMCP snapshots the updated environment.

## NPX Quick Start
```
npx @hol-org/hashnet-mcp up --transport sse
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
│ FastMCP / mcp.ts     │  ← registers `hol.*` + `workflow.*` tools
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
- `examples/agent-registration-request.json` mirrors the stricter schema used by `hol.registerAgent` and `hol.getRegistrationQuote`.

## Testing & Automation
- `pnpm test --run --coverage` — runs Vitest in CI mode with V8 coverage, ensuring `src/mcp.ts` and `src/broker.ts` stay above the 90% branch threshold.
- `pnpm test:run` — quick single-pass test run without coverage.
- `pnpm test:tools` — spins up the HTTP-stream gateway (unless one is already running) and exercises every MCP tool end-to-end via the official MCP client (Streamable HTTP transport). Set `TEST_UAID`, `TEST_CHAT_UAID`, and `TEST_REGISTRATION_ATTEMPT_ID` if you want UAID-specific flows to run instead of being skipped.
- `pnpm workflow:list` / `pnpm workflow:run <name>` — inspect and execute the built-in pipelines (use `examples/workflows/*.json` for payloads).
- `pnpm workflow:register` — prompts for metadata, runs the registration/chat/ops pipelines, and writes a JSON report (UAID, Claude config snippet, workflow traces).
- `pnpm workflow:register:advanced` — guided version of the advanced workflow (additional registries + optional credit purchasing prompts).
- `pnpm workflow:register:erc8004` — helper around the ERC-8004 workflow (ledger prompts + X402/X-Ledger guidance).
- `pnpm mock:broker` — boot a lightweight mock Registry Broker for CI/testing without external dependencies.

## Adding New Workflows
1. Create `src/workflows/<name>.ts` exporting a factory that calls `registerPipeline()` with metadata (description, input schema, required env vars).
2. Import the module inside `src/workflows/index.ts` so the pipeline registers at startup.
3. Wire an MCP tool in `src/mcp.ts` (define a `zod` schema, call `runPipeline`, and convert the result with `formatPipelineResult`).
4. Add Vitest coverage in `tests/workflows/<name>.spec.ts` plus CLI smoke coverage if pipelines should be runnable via `workflow:run`.
5. Update README/AGENTS describing the workflow, logging fields, and any CLI flags so downstream agents know how to trigger it.
