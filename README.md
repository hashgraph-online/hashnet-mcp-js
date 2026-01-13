# HOL Hashnet MCP

Model Context Protocol (MCP) server for Hashgraph Online’s Registry Broker. It gives AI agents a first-class tool suite to discover, register, and chat with agents/servers on the Hashgraph network, plus workflow shortcuts for common journeys.

## Why use this server?
- **Discovery & chat in one place**: Find UAIDs/agents/MCP servers, validate them, open chat sessions, and send messages via a single MCP endpoint.
- **Registration flows**: Request quotes, submit HCS-11 registrations, and wait for completion with built-in pipelines.
- **Ops & credits**: Inspect broker health/metrics, and manage credits (HBAR or X402), with guardrails for required approvals.
- **DX for agent platforms**: Ships both stdio (great for Claude Desktop) and HTTP streaming/SSE (great for Cursor/Claude Code/Codex).

## Quickstart
Prereqs: Node 18+, `pnpm` (or npm), and a broker API key.

You can get a API key at [hol.org/regsitry](https://hol.org/registry)

1) Install deps and env:
```bash
pnpm install
cp .env.example .env  # add REGISTRY_BROKER_API_KEY + URL
```
2) Run (HTTP streaming, default port 3333):
```bash
npx @hol-org/hashnet-mcp@latest up --transport sse --port 3333
# or from source: pnpm dev:sse
```
3) Point your MCP client at `http://localhost:3333/mcp/stream` (or `/mcp/sse` if it prefers SSE).

### Zero-touch quickstart
```bash
pnpm quickstart
```
Guides you through copying `.env`, installing deps, running smoke checks, and launching your chosen transport (stdio or sse).

## Architecture (mental model)
```
Client (Cursor / Claude Code / Claude Desktop / Codex)
   │  stdio (dev:stdio) or HTTP stream/SSE (dev:sse)
   ▼
Hashnet MCP (FastMCP)
   ├─ mcp.ts (tools + schemas + instructions)
   ├─ workflows/* (pipelines like discovery, registration, chat)
   └─ broker.ts (RegistryBrokerClient wrapper + rate limits)
   ▼
Hashgraph Online Registry Broker API
```

## MCP client setup
### Cursor / Claude Code (HTTP)
```json
{
  "mcpServers": {
    "hashnet-mcp": {
      "enabled": true,
      "type": "http",
      "url": "http://localhost:3333/mcp/stream"
    }
  }
}
```
Use `"type": "sse"` if your build expects it.

### Claude Desktop (stdio)
```json
{
  "mcpServers": {
    "hashnet": {
      "type": "stdio",
      "command": "npx",
      "args": [
        "-y",
        "@hol-org/hashnet-mcp",
        "up"
      ],
      "env": {
        "REGISTRY_BROKER_API_URL": "https://registry.hashgraphonline.com/api/v1",
        "REGISTRY_BROKER_API_KEY": "<your HOL API key>"
      }
    }
  }
}
```

## Commands
- Dev transports: `pnpm dev:stdio` (stdio), `pnpm dev:sse` (HTTP stream/SSE)
- Build / prod: `pnpm build` then `pnpm start`
- NPX runner: `npx @hol-org/hashnet-mcp up --transport sse --port 3333`
- Local TS runner: `pnpm cli:up -- --transport sse`
- Guided DX: `pnpm quickstart` (env copy → deps → smoke → launch)
- Manual chat smoke: `pnpm chat:smoke --uaid <uaid> [--auth-token <token>] [--top-up --account-id <id> --private-key <key>]`
- Workflows: `pnpm workflow:list`, `pnpm workflow:run <name> --payload examples/workflows/<file>.json`
- Tests: `pnpm test --run --coverage`

## Tooling at a glance
Categories are exposed as MCP tools (`hol.*`) plus workflows (`workflow.*`):
- **Discovery**: `hol.search`, `hol.vectorSearch`, `hol.agenticSearch`, `hol.delegate.suggest`, `hol.registrySearchByNamespace`, `hol.resolveUaid`
- **Registration**: `hol.getRegistrationQuote`, `hol.registerAgent`, `hol.waitForRegistrationCompletion`, `hol.updateAgent`
- **Chat**: `hol.chat.createSession` (uaid or agentUrl), `hol.chat.sendMessage` (sessionId or uaid/agentUrl; auto-creates session), `hol.chat.history`, `hol.chat.compact`, `hol.chat.end`, `hol.closeUaidConnection`; encrypted helpers: `hol.chat.ensureEncryptionKey`, `hol.chat.startEncryptedConversation`, `hol.chat.acceptEncryptedConversation`, `hol.chat.sendEncrypted`
- **Protocols/Ops**: `hol.listProtocols`, `hol.detectProtocol`, `hol.stats`, `hol.metricsSummary`, `hol.dashboardStats`, `hol.websocketStats`
- **Credits**: `hol.credits.balance`, `hol.purchaseCredits.hbar`, `hol.x402.minimums`, `hol.x402.buyCredits`
- **Ledger**: `hol.ledger.challenge`, `hol.ledger.authenticate`
- **Workflows** (pipelines): discovery, registration, full registration, chat smoke, encrypted chat, ops check, ERC-8004 and X402 helpers, OpenRouter chat, registry showcase, Agentverse bridge. See `examples/workflows/` for payloads.

## Usage patterns
- **Delegation (default)**: `workflow.delegate { task }` to discover a top candidate and message them immediately (set `REGISTRY_BROKER_API_KEY` or authenticate with the ledger if chat is protected).
- **Delegation (pick-first)**: `hol.delegate.suggest { task }` then `hol.chat.sendMessage { uaid, message }` to ask a specialized registry agent for a focused deliverable.
- **Discovery**: `workflow.discovery { query?, limit? }` or `hol.search` / `hol.vectorSearch` / `hol.agenticSearch` with filters (`capabilities`, `metadata`, `type=ai-agents|mcp-servers`).
- **Registration**: `workflow.registerMcp { payload }` (quote → register → wait) or `workflow.fullRegistration` to add discovery/chat/ops.
- **Chat**: Start with `hol.chat.sendMessage { uaid, message }` if you don’t have a sessionId— it will create a session and send. Otherwise use `hol.chat.createSession` then `hol.chat.sendMessage { sessionId, message }`. Manage with `hol.chat.history/compact/end`. For end-to-end encrypted sessions, run `workflow.encryptedChat` or the `hol.chat.start/accept/sendEncrypted` trio after calling `hol.chat.ensureEncryptionKey`.
- **Ops/Health**: `workflow.opsCheck` or the `hol.stats`/`hol.metricsSummary`/`hol.dashboardStats` trio.
- **Credits**: Always check `hol.credits.balance` before purchasing; use HBAR or X402 tools with explicit approval.
- **Memory**: When `MEMORY_ENABLED=1`, workflows (chatSmoke, openrouterChat, historyTopUp, registryBrokerShowcase, fullRegistration) will load scoped context and append chat/discovery traces; pass `disableMemory: true` to skip.

## Memory (how it works)
- Enable with `MEMORY_ENABLED=1` (defaults to a file-backed store at `MEMORY_STORAGE_PATH`; use `MEMORY_STORE=memory` for in-memory only, or `MEMORY_STORE=sqlite` if you want SQLite and have native build tools installed). Tune `MEMORY_MAX_ENTRIES_PER_SCOPE`, `MEMORY_DEFAULT_TTL_SECONDS`, `MEMORY_SUMMARY_TRIGGER`, `MEMORY_MAX_RETURN_ENTRIES`, and `MEMORY_CAPTURE_TOOLS`.
- MCP tools: `hol.memory.context`, `hol.memory.note`, `hol.memory.search`, `hol.memory.clear` (see `help://hol/memory`). Scopes use `uaid`, `sessionId`, `namespace`, or `userId`.
- Automatic capture: `hol.chat.sendMessage` logs user/assistant exchanges; tool wrapper can log tool calls/results when `MEMORY_CAPTURE_TOOLS=1`.
- Workflows: `chatSmoke`, `openrouterChat`, `historyTopUp`, `registryBrokerShowcase`, and `fullRegistration` load prior context and append transcripts/results when memory is enabled. Add `disableMemory: true` in workflow inputs to opt out.
- Guardrails: entries are truncated to stay within size budgets, secrets are redacted, TTL + max-entries bounds keep storage from growing unbounded. Summaries are generated heuristically once thresholds are exceeded.

## Tool catalog (what each does)
**Discovery**
- `hol.search` — keyword discovery with filters (capabilities, metadata, type).
- `hol.vectorSearch` — semantic similarity search for agents.
- `hol.agenticSearch` — hybrid semantic + lexical search (uses broker `/search/agentic` when available).
- `hol.delegate.suggest` — shortlist candidates for delegating a subtask (includes message templates).
- `hol.registrySearchByNamespace` — search within a specific registry.
- `hol.resolveUaid` — resolve + validate + connection status for a UAID.
- `hol.closeUaidConnection` — force-close a UAID connection.

**Registration**
- `hol.getRegistrationQuote` — cost estimate for a registration payload.
- `hol.registerAgent` — submit HCS-11 registration.
- `hol.waitForRegistrationCompletion` — poll registration attempt until done.
- `hol.updateAgent` — update an existing registration payload.
- `hol.additionalRegistries` — catalog of additional registries/networks.

**Chat**
- `hol.chat.createSession` — open a session by `uaid` or `agentUrl`.
- `hol.chat.sendMessage` — send to an existing sessionId or auto-create via `uaid/agentUrl`.
- `hol.chat.history` / `hol.chat.compact` / `hol.chat.end` — manage chat lifecycle.
- Encrypted helpers: `hol.chat.ensureEncryptionKey`, `hol.chat.startEncryptedConversation`, `hol.chat.acceptEncryptedConversation`, `hol.chat.sendEncrypted` (encrypt/decrypt via broker-managed keys).

**Protocols / Ops**
- `hol.stats`, `hol.metricsSummary`, `hol.dashboardStats`, `hol.websocketStats` — broker health/metrics.

**Credits**
- `hol.credits.balance` — check balances (API key + optional Hedera/X402).
- `hol.purchaseCredits.hbar` — buy credits with HBAR.
- `hol.x402.minimums`, `hol.x402.buyCredits` — X402 purchase helpers.

**Ledger**
- `hol.ledger.challenge` — create ledger verification challenge.
- `hol.ledger.authenticate` — verify challenge (sets ledger API key).

**Workflows (pipelines)**
- Discovery: `workflow.discovery`, `workflow.erc8004Discovery`
- Registration: `workflow.registerMcp`, `workflow.fullRegistration`, `workflow.erc8004X402`, `workflow.x402Registration`, `workflow.registerAgentErc8004`
- Chat/Ops: `workflow.chatSmoke`, `workflow.encryptedChat`, `workflow.opsCheck`, `workflow.registryBrokerShowcase`, `workflow.openrouterChat`, `workflow.agentverseBridge`
- Utilities: see `examples/workflows/` for payloads and `pnpm workflow:list`

## Environment
Set in `.env` or your process:
- `REGISTRY_BROKER_API_URL` (default `https://registry.hashgraphonline.com/api/v1`)
- `REGISTRY_BROKER_API_KEY` (required for live broker)
- Optional: `HEDERA_ACCOUNT_ID`, `HEDERA_PRIVATE_KEY` (auto top-up), `LOG_LEVEL`, `PORT`, `HTTP_STREAM_PORT`, `BROKER_*` rate limit vars, `WORKFLOW_DRY_RUN`, `BROKER_AUTO_TOP_UP`.
- Encrypted chat defaults: `ENCRYPTED_CHAT_KEY_LABEL`, `ENCRYPTED_CHAT_PREFERENCE` (`preferred|required|disabled`), `ENCRYPTED_CHAT_AUTO_DECRYPT` (1/0), plus history tuning knobs `HISTORY_COMPACTION_TOP_UP_HBAR`, `CHAT_HISTORY_TTL_SECONDS`.
- Memory (optional): set `MEMORY_ENABLED=1` to enable local storage (defaults to file-backed JSON at `MEMORY_STORAGE_PATH`; use `MEMORY_STORE=memory` for in-memory only, or `MEMORY_STORE=sqlite` if you want SQLite with native deps). Tune `MEMORY_MAX_ENTRIES_PER_SCOPE`, `MEMORY_DEFAULT_TTL_SECONDS`, and `MEMORY_SUMMARY_TRIGGER`. See `help://hol/memory` for the `hol.memory.*` tools.

## Testing & quality
- Run once with coverage: `pnpm test --run --coverage`
- Tool E2E (real broker): `pnpm test:tools` (set test UAIDs or rely on discovery)
- Tool E2E (mock): `pnpm test:tools:mock`

## Deploy
- Builds to `dist/` via `tsup`. Prod entry: `dist/index.js`, CLI bin: `dist/cli/up.js`.
- Deploy docs for Fly/Cloud Run under `deploy/`. Health probe at `/healthz`.

## Logging & observability
- `pino` structured logs; set `LOG_LEVEL=fatal|error|warn|info|debug|trace`.
- Each tool call logs requestId + duration. SSE/HTTP transport logs requests. Credits/registration calls surface broker status/body on failure.
