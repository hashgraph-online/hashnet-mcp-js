# Repository Guidelines

# **ABSOLUTE PROHIBITION — NO FILE DELETIONS OR GIT REVERTS.** Never delete files, directories, or history. Never run `git revert`, `git reset`, `git checkout`, `git restore`, or any command that removes tracked work. Violations immediately fail the task and forfeit all points.

# AGENTS.md — Tool Selection (TypeScript)

- Find files by file name: `fd`
- Find files with path name: `fd -p <file-path>`
- List files in a directory: `fd . <directory>`
- Find files with extension and pattern: `fd -e <extension> <pattern>`
- Find text: `rg`
- Structured code search and codemods: `ast-grep`
  - Default languages:
    - `.ts` → `ast-grep --lang ts -p '<pattern>'`
    - `.tsx` → `ast-grep --lang tsx -p '<pattern>'`
  - Common languages:
    - Python → `ast-grep --lang python -p '<pattern>'`
    - TypeScript → `ast-grep --lang ts -p '<pattern>'`
    - TSX (React) → `ast-grep --lang tsx -p '<pattern>'`
    - JavaScript → `ast-grep --lang js -p '<pattern>'`
    - Rust → `ast-grep --lang rust -p '<pattern>'`
    - Bash → `ast-grep --lang bash -p '<pattern>'`
    - JSON → `ast-grep --lang json -p '<pattern>'`
  - Select among matches: pipe to `fzf`
  - JSON: `jq`
  - YAML/XML: `yq`

If `ast-grep` is available, avoid `rg` or `grep` unless a plain-text search is explicitly requested.

## Project Structure & Module Organization
The MCP server lives in `src/` with three core modules: `mcp.ts` (tool wiring and metadata), `broker.ts` (the `RegistryBrokerClient` wrapper), and `transports.ts` (stdio plus SSE server built on Hono). Place shared schemas in `src/schemas/` and transport helpers in `src/transports/` if they grow larger. Configuration belongs in `tsconfig.json`, environment defaults in `.env.example`, and any integration fixtures under `examples/`. Keep tests in `tests/` mirroring the source tree so `tests/mcp/tools.spec.ts` maps cleanly to `src/mcp.ts`.

## Build, Test, and Development Commands
- `pnpm install` — syncs dependencies, including FastMCP, Hono, and the Hashgraph Online SDK.
- `pnpm dev:stdio` — launches `src/index.ts` with `MCP_TRANSPORT=stdio`, wired for Claude Desktop.
- `pnpm dev:sse` — serves `http://localhost:${PORT}/mcp/stream` via Hono’s SSE transport for Claude Code/Cursor.
- `HTTP_STREAM_PORT` controls the upstream FastMCP HTTP server (defaults to `PORT + 1`). External clients still connect to `http://localhost:${PORT}/mcp/stream` (Streamable HTTP) or `/mcp/sse`.
- `pnpm build` — runs `tsup` (see `tsup.config.ts`) to emit both `dist/index.js` and the NPX CLI bundle.
- `pnpm start` — executes the compiled output (`node dist/index.js`) for production parity.
- `pnpm test --run --coverage` — executes Vitest once with V8 coverage; `pnpm test` stays in watch mode.
- `pnpm quickstart` — interactive DX script that installs deps, copies `.env`, runs smoke tests, and launches your preferred transport (stdio or SSE).
- `pnpm test:tools` — end-to-end harness that connects to the HTTP-stream gateway via the official MCP client (Streamable HTTP transport) and calls every `hol.*` tool using sample payloads (set `TEST_UAID`, `TEST_CHAT_UAID`, `TEST_REGISTRATION_ATTEMPT_ID` to cover UAID/chat flows). The script manages its own server lifecycle; do **not** pass `--spawn` manually.
- `pnpm test:tools:mock` — runs the same harness against the built-in mock MCP server so CI can exercise the exit flow without touching the real Registry Broker.
- `BROKER_PROTOCOL_TOOLS=1` — optional flag to include `hol.listProtocols` / `hol.detectProtocol` in the tool suite; leave unset if your API key or environment doesn't expose those endpoints (the public staging broker returns 404).
- `pnpm workflow:list` / `pnpm workflow:run <name>` — inspect and execute any workflow (pair with `examples/workflows/<workflow>.json` for sample payloads).
- `pnpm workflow:register` — interactive wizard that runs the registration/chat/ops workflows and saves a JSON report (UAID + Claude snippet).
- `pnpm workflow:register:advanced` — guided prompts for `workflow.registerAgentAdvanced` (additional registries + optional credit purchase).
- `pnpm workflow:register:erc8004` — helper around the ERC-8004 workflow (ledger walkthrough + post-registration chat).
- `pnpm mock:broker` — local mock broker for CI/contract testing.
- All scripts load `.env` automatically via `dotenv`, so once you copy `.env.example` you can simply edit the file and re-run commands without re-exporting variables.

## Workflows
`pnpm workflow:list` prints every registered pipeline, and each one has a golden-path payload under `examples/workflows/`. Copy the file, replace the placeholder UAIDs/API keys, then run `pnpm workflow:run <name> --payload <file>`.

**Discovery & Ops**
- `workflow.discovery` and `workflow.erc8004Discovery` (search/vector/namespace lookups).
- `workflow.opsCheck` (stats + metrics + protocols).
- `workflow.registryBrokerShowcase` (discovery → analytics → optional chat).

**Registration Pipelines**
- `workflow.registerMcp`, `workflow.registerAgentAdvanced`, `workflow.registerAgentErc8004`.
- `workflow.fullRegistration` (discovery → registration → chat → ops).
- `workflow.erc8004X402` and `workflow.x402Registration` (registration funded via X402 with optional chat checks).

**Credit & Ledger Utilities**
- `workflow.ledgerAuth` (challenge + verify).
- `workflow.x402TopUp` (buy credits via X402).
- `workflow.historyTopUp` (chat compaction + HBAR auto-purchases on 402 errors).

**Chat & Interop**
- `workflow.chatSmoke` (UAID session lifecycle).
- `workflow.openrouterChat` (discover + ping an OpenRouter model).
- `workflow.agentverseBridge` (relay traffic between a local UAID and Agentverse).

Runbook examples:

```
pnpm workflow:run workflow.registerAgentAdvanced --payload examples/workflows/workflow.registerAgentAdvanced.json
pnpm workflow:run workflow.openrouterChat --payload examples/workflows/workflow.openrouterChat.json --endpoint https://host/mcp/stream
```

Each workflow emits a structured report (steps, timings, context) whether executed via MCP or CLI.

### Workflow Architecture
- Pipelines live in `src/workflows/`; each file exports a `registerPipeline()` definition.
- `src/workflows/index.ts` imports these modules so they register at startup.
- MCP tools (`workflow.*`) are wired in `src/mcp.ts` and simply call the pipelines.
- For a visual overview, see the "Architecture Overview" section in `README.md`.

### Required Environment Variables
- `REGISTRY_BROKER_API_URL` / `REGISTRY_BROKER_API_KEY` — broker endpoint + key (staging/testnet supported).
- `HEDERA_ACCOUNT_ID` / `HEDERA_PRIVATE_KEY` — optional; only set these if you want CLI-driven credit purchases when the key runs dry.
- `WORKFLOW_DRY_RUN=1` — optional guard that makes pipelines skip state-changing broker calls.
- `BROKER_E2E=1` — opt into real broker hits in CI; otherwise the mock broker is used when available.
- `BROKER_AUTO_TOP_UP=1` — opt into automatic broker purchases without HITL prompts (defaults to manual approvals).
- X402 workflows also require EVM wallet details (see `examples/workflows/workflow.x402*.json`) plus any ledger challenge metadata referenced in the payload.
- Tool-suite fixtures (optional): `TEST_UAID`, `TEST_CHAT_UAID`, `TEST_REGISTRATION_ATTEMPT_ID`, and `BROKER_PROTOCOL_TOOLS`. Populate them (see `.env.example`) so `pnpm test:tools` can exercise UAID/chat flows locally or skip protocol checks when the broker doesn’t expose those endpoints; leave blank to rely on auto-discovered UAIDs/attempt IDs from the preceding scenarios.
Workflow pipelines declare their required env vars and will fail fast with a descriptive error if anything is missing; payload-specific secrets (OpenRouter tokens, Agentverse headers, bearer tokens) should be supplied via `.env` or injected by your CLI before invoking the workflow.

### Memory (optional)
- Set `MEMORY_ENABLED=1` to enable local memory capture (SQLite by default; see `.env.example` for limits and store selection). When enabled, workflows like `workflow.chatSmoke`, `workflow.openrouterChat`, `workflow.historyTopUp`, `workflow.registryBrokerShowcase`, and `workflow.fullRegistration` will load scoped context (uaid/session/namespace) and append discovery/chat traces. Pass `disableMemory: true` in workflow inputs to opt out even when memory is enabled.

### Running `pnpm workflow:register`
1. The CLI prompts for display name, alias, description, MCP URL, chat message, and report path (defaults provided).
2. Runs the registration → chat → ops pipelines and prints progress to the console.
3. Writes the report JSON (defaults to `workflow-register-report.json`) containing:
   - UAID (if registration succeeded)
   - Pipeline traces (steps + context)
   - Claude config snippet pointing at your MCP URL
   - Raw pipeline responses for registration/chat/ops

**Sample report excerpt**

```json
{
  "uaid": "uaid:registry:abcd-1234",
  "pipelines": [
    { "name": "workflow.registerMcp", "steps": ["hol.getRegistrationQuote", "hol.registerAgent"] }
  ],
  "claudeConfig": {
    "mcpServers": {
      "hashnet": {
        "command": "npx",
        "args": ["@hol-org/hashnet-mcp@latest", "up", "--transport", "sse"]
      }
    }
  }
}
```

The CLI spends the API key’s existing credits first. If the broker rejects the registration (HTTP 402), the script fetches a fresh quote, prints the required/available credits, and prompts for HITL approval before calling `purchaseCreditsWithHbar` (when `HEDERA_*` are configured). It continues only after the broker reports the new balance. Toggle `BROKER_AUTO_TOP_UP=1` if you want the SDK’s legacy auto top-up behaviour without prompts.

### Adding / Extending Workflows
1. Create `src/workflows/<name>.ts`, register the pipeline with metadata + env requirements, and export any helper schemas.
2. Import it from `src/workflows/index.ts` so registration happens at server boot.
3. Optional MCP tool: define schemas/handlers in `src/mcp.ts` and wrap responses with `formatPipelineResult`.
4. Tests belong in `tests/workflows/<name>.spec.ts` (unit) plus CLI hooks in `scripts/workflow-run*.ts` when interactive flags are required.
5. Document new workflows (README/AGENTS) and mention logging fields or env toggles to keep DX consistent.

## Coding Style & Naming Conventions
Use TypeScript with strict mode enabled and 2-space indentation. Prefer explicit return types on exported functions, `zod` schemas for all tool inputs, and descriptive FastMCP tool IDs (`hol.search`, `hol.resolveUaid`). Filenames stay kebab-case (`hashnet-tool.ts`), while classes remain PascalCase and functions camelCase. Run `pnpm lint` (ESLint + `@typescript-eslint`) and `pnpm format` (Prettier) before pushing; both respect the repo’s `.editorconfig`.

## Testing Guidelines
Vitest powers unit tests, and supertest-style integration tests cover the Hono transport. Name files `*.spec.ts` for unit scope and `*.int.spec.ts` for transport flows. Mock the broker via dependency injection so tests never hit the live Registry API; only allow network calls inside smoke tests guarded by `BROKER_E2E=1`. Maintain >90% branch coverage for `src/mcp.ts` and `src/broker.ts`, since they enforce tool contracts.

## Commit & Pull Request Guidelines
Follow Conventional Commits (`feat: add UAID validator`, `fix: guard vector search limit`). Bundle related file changes and keep commit bodies focused on the “why.” PRs should include: purpose summary, testing evidence (`pnpm test --run --coverage`), config diffs when touching `.env`, and screenshots or curl snippets for new transport endpoints. Link issues or TODO references in the description so MCP consumers understand the lifecycle.

## Security & Configuration Tips
Never commit `.env` or keys; ship a `.env.example` with placeholder values. Treat `HEDERA_PRIVATE_KEY` as production-only and load it via secrets management when deploying. Prefer `process.env` lookups consolidated in a single `src/config.ts` module to avoid desync. When testing auto top-ups, set throttles via `Bottleneck` in `broker.ts` to keep Registry traffic predictable.

## Observability & Operations
- `pino` logging is centralized in `src/logger.ts`; set `LOG_LEVEL=fatal|error|warn|info|debug|trace`.
- `/healthz` replies with `{ status, uptime, tools }` for Fly/Cloud Run probes.
- Enable distributed throttling by setting `BROKER_MAX_CONCURRENT`, `BROKER_MIN_TIME_MS`, and `BROKER_RATE_LIMIT_REDIS_URL`; `withBroker` automatically queues calls.

## Deployment & MCP Clients
- `deploy/fly.toml` and `deploy/Dockerfile`/`deploy/README.md` document Fly.io and Cloud Run rollouts (SSE endpoint exposed at `/mcp/stream`).
- Claude Desktop config: point to `pnpm dev:stdio` with the necessary Registry env vars; Claude Code/Cursor should target the SSE URL published by Fly/Cloud Run.

## NPX Installer
- `npx @hol-org/hashnet-mcp up --transport sse` bootstraps deps, copies `.env.example`, and launches the desired transport; `--install-only` skips the final run.
- The CLI lives in `src/cli/up.ts` (bundled to `dist/cli/up.js`) and doubles as the package `bin` for NPX installs.
