# Repository Guidelines

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
- `pnpm test:tools` — end-to-end harness that connects to the HTTP-stream gateway via the official MCP client (Streamable HTTP transport) and calls every `rb.*` tool using sample payloads (set `TEST_UAID`, `TEST_CHAT_UAID`, `TEST_REGISTRATION_ATTEMPT_ID` to cover UAID/chat flows).

## Coding Style & Naming Conventions
Use TypeScript with strict mode enabled and 2-space indentation. Prefer explicit return types on exported functions, `zod` schemas for all tool inputs, and descriptive FastMCP tool IDs (`rb.search`, `rb.resolveUaid`). Filenames stay kebab-case (`hashnet-tool.ts`), while classes remain PascalCase and functions camelCase. Run `pnpm lint` (ESLint + `@typescript-eslint`) and `pnpm format` (Prettier) before pushing; both respect the repo’s `.editorconfig`.

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
- `npx @hol/hashnet-mcp up --transport sse` bootstraps deps, copies `.env.example`, and launches the desired transport; `--install-only` skips the final run.
- The CLI lives in `src/cli/up.ts` (bundled to `dist/cli/up.js`) and doubles as the package `bin` for NPX installs.
