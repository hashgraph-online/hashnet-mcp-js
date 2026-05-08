# Hashnet MCP JS

[![npm version](https://img.shields.io/npm/v/%40hol-org%2Fhashnet-mcp?logo=npm)](https://www.npmjs.com/package/@hol-org/hashnet-mcp)
[![npm downloads](https://img.shields.io/npm/dm/%40hol-org%2Fhashnet-mcp?logo=npm)](https://www.npmjs.com/package/@hol-org/hashnet-mcp)
[![Node version](https://img.shields.io/node/v/%40hol-org%2Fhashnet-mcp)](https://www.npmjs.com/package/@hol-org/hashnet-mcp)
[![Bundle size](https://img.shields.io/bundlephobia/minzip/%40hol-org%2Fhashnet-mcp)](https://bundlephobia.com/package/@hol-org/hashnet-mcp)
[![Publish](https://github.com/hashgraph-online/hashnet-mcp-js/actions/workflows/publish.yml/badge.svg?branch=master)](https://github.com/hashgraph-online/hashnet-mcp-js/actions/workflows/publish.yml)
[![Canary](https://github.com/hashgraph-online/hashnet-mcp-js/actions/workflows/publish-canary.yml/badge.svg?branch=master)](https://github.com/hashgraph-online/hashnet-mcp-js/actions/workflows/publish-canary.yml)
[![License](https://img.shields.io/github/license/hashgraph-online/hashnet-mcp-js)](https://github.com/hashgraph-online/hashnet-mcp-js/blob/master/LICENSE)
[![CodeSandbox](https://img.shields.io/badge/CodeSandbox-Open-151515?logo=codesandbox)](https://codesandbox.io/p/sandbox/github/hashgraph-online/hashnet-mcp-js/tree/master)

Universal MCP server for discovery, chat, registration, credits, and workflow automation across the HOL Registry Broker ecosystem.

## Ecosystem

| Surface | Link |
| --- | --- |
| npm package | [`@hol-org/hashnet-mcp`](https://www.npmjs.com/package/@hol-org/hashnet-mcp) |
| GitHub repo | [hashgraph-online/hashnet-mcp-js](https://github.com/hashgraph-online/hashnet-mcp-js) |
| GitHub releases | [Releases](https://github.com/hashgraph-online/hashnet-mcp-js/releases) |
| Documentation | [hol.org/mcp](https://hol.org/mcp) |
| CodeSandbox | [Open examples in browser](https://codesandbox.io/p/sandbox/github/hashgraph-online/hashnet-mcp-js/tree/master) |

## Quickstart

```bash
pnpm install
cp .env.example .env
pnpm dev:http
```

Common launch modes:

- `pnpm dev:stdio`
- `pnpm dev:http`
- `pnpm dev:http:compat`
- `npx @hol-org/hashnet-mcp --help`
- `npx @hol-org/hashnet-mcp --stdio`
- `npx @hol-org/hashnet-mcp --http --host 127.0.0.1 --port 3333`

When installed globally or linked locally, the binary is `hashnet-mcp`.

## Supported Transports

| Transport | Endpoint(s) | Notes |
| --- | --- | --- |
| stdio | process stdin/stdout | best for local agent runtimes |
| Streamable HTTP | `/mcp`, `/mcp/stream` | recommended HTTP transport |
| legacy HTTP + SSE | `/mcp/sse`, `/mcp/messages` | enabled with `FEATURE_LEGACY_SSE=1` |

Runtime utility endpoints:

- `/healthz`
- `/readyz`
- `/metrics`

## Tool Surface

- Discovery: `hol.stats`, `hol.capabilities`, `hol.search`, `hol.vectorSearch`, `hol.resolveUaid`
- Chat: `hol.chat.readiness`, `hol.chat.createSession`, `hol.chat.sendMessage`, `hol.chat.retry`, `hol.chat.history`, `hol.chat.resume`, `hol.chat.end`
- Registration: `hol.getRegistrationQuote`, `hol.registerAgent`, `hol.waitForRegistrationCompletion`
- Workflows: `workflow.discovery`, `workflow.delegate`, `workflow.registration`

Tool success responses use structured envelopes in `structuredContent`:

- `ok`
- `data`
- `meta`

Tool failures return `isError: true` with structured machine-readable error fields (`code`, `category`, `retryable`).

## Configuration

| Variable | Required | Notes |
| --- | --- | --- |
| `REGISTRY_BROKER_API_URL` | no | defaults to `https://hol.org/registry/api/v1` |
| `REGISTRY_BROKER_API_KEY` | no | enables paid tools with a static broker API key |
| `BROKER_REQUEST_TIMEOUT_MS` | no | default upstream request timeout is `60000` |
| `MCP_TRANSPORT` | no | `http` (default) or `stdio` |
| `MCP_HOST` | no | defaults to `127.0.0.1` |
| `MCP_PORT` | no | defaults to `3333` |
| `MCP_ALLOWED_ORIGINS` | no | comma-separated allow list |
| `MCP_SERVER_BEARER_TOKEN` | no | required when binding to a non-local host (for example `0.0.0.0`) |
| `MCP_SESSION_IDLE_TTL_MS` | no | defaults to `900000` |
| `MCP_SESSION_MAX_COUNT` | no | defaults to `250` |
| `MCP_SESSION_REAP_INTERVAL_MS` | no | defaults to `60000` |
| `LEDGER_ACCOUNT_ID` | no | generic ledger identity fallback |
| `HEDERA_ACCOUNT_ID` | no | Hedera account id |
| `HEDERA_NETWORK` | no | e.g. `hedera:testnet` |
| `HEDERA_PRIVATE_KEY` | no | Hedera private key |
| `EVM_LEDGER_NETWORK` | no | e.g. `eip155:1` |
| `ETH_PK` | no | EVM private key |

## Security Defaults

- Binds to `127.0.0.1` by default.
- Validates `Origin` for HTTP requests when present.
- Enforces bearer-token auth when binding to non-local hosts.
- Reaps idle HTTP sessions and enforces max active sessions.
- Redacts sensitive values in logs.

## Development

| Command | Purpose |
| --- | --- |
| `pnpm build` | compile distributable artifacts |
| `pnpm start` | run compiled server |
| `pnpm lint` | run ESLint |
| `pnpm typecheck` | run TypeScript checks |
| `pnpm test:run` | run Vitest once |
| `pnpm test:coverage` | run Vitest with coverage |
| `pnpm check:no-stubs` | enforce no-stubs contract |
| `pnpm smoke:http` | streamable HTTP smoke test |
| `pnpm smoke:stdio` | stdio smoke test |

## Release Notes Automation

GitHub releases are generated automatically from merged pull requests:

- release tags are created during publish (`vX.Y.Z`)
- GitHub release notes are generated with GitHub's release-note engine
- changelog categories are controlled via `.github/release.yml`
- canonical docs links are appended to each release
