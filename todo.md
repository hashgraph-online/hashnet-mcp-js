# HOL MCP Server POC Master TODO

This is the execution plan to build the no-stubs HOL MCP Server POC end-to-end, in order.

## 0. Ground Rules (Do First)

- [x] Use Node.js `>=20` and `pnpm`.
- [x] Treat this as a no-stubs build:
  - [x] No `throw new Error("Not implemented")`
  - [x] No `TODO(STUB)`
  - [x] No fake data returned where live Broker calls are required
- [x] Keep credentials out of code and logs.
- [x] Default runtime mode to localhost-only unless explicit auth is configured.

## 1. Repository Bootstrap

- [x] Create baseline structure:
  - [x] `.github/workflows/`
  - [x] `docs/`
  - [x] `scripts/e2e/`
  - [x] `scripts/tool-suite/`
  - [x] `src/cli/`
  - [x] `src/config/`
  - [x] `src/mcp/tools/`
  - [x] `src/mcp/workflows/`
  - [x] `src/mcp/schemas/`
  - [x] `src/broker/`
  - [x] `src/transports/`
  - [x] `src/observability/`
  - [x] `tests/unit/`
  - [x] `tests/integration/`
- [x] Add root files:
  - [x] `README.md`
  - [x] `LICENSE`
  - [x] `.env.example`
  - [x] `package.json`
  - [x] `tsconfig.json`
  - [x] `tsup.config.ts`
  - [x] `vitest.config.ts`
- [x] Define scripts:
  - [x] `dev:stdio`
  - [x] `dev:http`
  - [x] `dev:http:compat`
  - [x] `build`
  - [x] `start`
  - [x] `test`
  - [x] `test:run`
  - [x] `test:coverage`
  - [x] `smoke:http`
  - [x] `smoke:stdio`
  - [x] `typecheck`

## 2. Dependencies and Toolchain

- [x] Install runtime deps:
  - [x] `@modelcontextprotocol/sdk`
  - [x] `@hashgraphonline/standards-sdk`
  - [x] `zod`
  - [x] `dotenv`
  - [x] `pino`
  - [x] `express`
  - [x] `bottleneck`
  - [x] `undici` (optional polyfill)
- [x] Install dev deps:
  - [x] `typescript`
  - [x] `tsx`
  - [x] `tsup`
  - [x] `vitest`
  - [x] `@vitest/coverage-v8`
  - [x] `@types/node`
- [x] Configure `package.json`:
  - [x] `engines.node: >=20`
  - [x] set `packageManager`
  - [x] `type: module`

## 3. Environment and Feature Flags

- [x] Implement `src/config/env.ts`:
  - [x] strict env parsing
  - [x] defaults (`REGISTRY_BROKER_API_URL=https://hol.org/registry/api/v1`, `MCP_HOST=127.0.0.1`, `MCP_PORT=3333`)
  - [x] `redactEnvForLogs`
  - [x] mode-aware validation (stdio/http)
- [x] Implement `src/config/featureFlags.ts`:
  - [x] `FEATURE_LEGACY_SSE`
  - [x] `FEATURE_MEMORY_SQLITE`
  - [x] `FEATURE_MEMORY_REDIS`
  - [x] `FEATURE_LEDGER_AUTH`
  - [x] `FEATURE_ENCRYPTED_CHAT`
- [x] Create `.env.example` with:
  - [x] `REGISTRY_BROKER_API_URL`
  - [x] `REGISTRY_BROKER_API_KEY`
  - [x] `MCP_TRANSPORT`
  - [x] `MCP_HOST`
  - [x] `MCP_PORT`
  - [x] `MCP_ALLOWED_ORIGINS`
  - [x] `MCP_SERVER_BEARER_TOKEN`
  - [x] optional Hedera/EVM/encryption vars

## 4. Observability and Safety Foundations

- [x] Implement `src/observability/logger.ts`:
  - [x] pino logger
  - [x] redact API keys, private keys, bearer tokens
  - [x] ensure no stdout pollution in stdio mode
- [x] Add request correlation:
  - [x] generate request IDs per tool call
  - [x] propagate trace headers to Broker client
- [x] Implement startup safety checks:
  - [x] reject `0.0.0.0` bind if no `MCP_SERVER_BEARER_TOKEN`
  - [x] clear startup diagnostics without secret leakage

## 5. Broker Client Integration Layer

- [x] Implement `src/broker/client.ts`:
  - [x] `createRegistryBrokerClient(env)`
  - [x] set base URL and API key
  - [x] attach default headers (`x-app-id`, `x-trace-id` where available)
- [x] Implement `src/broker/errors.ts`:
  - [x] map `RegistryBrokerError` to MCP tool errors
  - [x] map `RegistryBrokerParseError` to explicit schema mismatch errors
  - [x] safe error serialization (no secrets)
- [x] Implement `src/broker/rateLimit.ts`:
  - [x] Bottleneck wrapper
  - [x] configurable QPS + concurrency
  - [x] helper used by all Broker-bound tool calls

## 6. MCP Server Core

- [x] Implement `src/mcp/createServer.ts`:
  - [x] server metadata (`name`, `version`)
  - [x] capabilities (tools, logging)
  - [x] register discovery, chat, registration, workflows
- [x] Implement shared tool runner:
  - [x] input validation via Zod
  - [x] common success/error response shape
  - [x] request ID attachment
- [x] Add cancellation support:
  - [x] support abort for long-poll operations (registration wait)
  - [x] ensure initialize is not cancellable
- [x] Define at least one `outputSchema` (recommended `hol.stats`) and enforce it.

## 7. Transport: stdio

- [x] Implement `src/transports/stdio.ts`:
  - [x] connect server over stdio transport
  - [x] ensure protocol frames only on stdout
- [x] Wire `src/index.ts`:
  - [x] select `stdio` vs `http` from `MCP_TRANSPORT`
  - [x] handle startup errors cleanly
- [x] Smoke validate stdio path:
  - [x] initialize
  - [x] tools/list
  - [x] `hol.stats`
  - [x] `hol.search`

## 8. Transport: Streamable HTTP + Security

- [x] Implement `src/transports/originValidation.ts`:
  - [x] parse allowlist from `MCP_ALLOWED_ORIGINS`
  - [x] if Origin present and disallowed -> `403`
  - [x] allow non-browser requests with no Origin
- [x] Implement `src/transports/httpStreamable.ts`:
  - [x] Express app with JSON body parsing
  - [x] Streamable HTTP endpoint `/mcp`
  - [x] alias endpoint `/mcp/stream`
  - [x] session transport map using `mcp-session-id`
  - [x] enforce `MCP-Protocol-Version` on non-initialize requests
  - [x] optional Bearer auth gate
  - [x] host/port startup logging
- [x] Implement method handling:
  - [x] support `POST` requests
  - [x] include `GET` and `DELETE` behavior if required by SDK transport semantics

## 9. Legacy SSE Compatibility (Feature-Flagged)

- [x] Implement `src/transports/httpLegacySse.ts`:
  - [x] `GET /mcp/sse` for event stream
  - [x] `POST /mcp/messages?sessionId=...` for client messages
  - [x] session lifecycle cleanup on close
- [x] Gate behind `FEATURE_LEGACY_SSE=1`.
- [x] Verify compatibility smoke scenario for older SSE clients.

## 10. Discovery Tools (Live Broker Calls)

- [x] Implement `src/mcp/tools/discovery.ts` tools:
  - [x] `hol.stats`
  - [x] `hol.search`
  - [x] `hol.vectorSearch`
  - [x] `hol.resolveUaid`
- [x] `hol.search` input schema:
  - [x] accept both `q` and `query`
  - [x] normalize to Broker call
  - [x] support `limit`, `type`, and filters
- [x] `hol.vectorSearch`:
  - [x] pass `query`, optional `limit`, optional `filter`
- [x] `hol.resolveUaid`:
  - [x] validate UAID input
  - [x] return Broker resolution payload
- [x] Ensure all discovery errors are mapped to MCP error format.

## 11. Chat Tools (Authenticated/ Paid Path)

- [x] Implement `src/mcp/tools/chat.ts` tools:
  - [x] `hol.chat.createSession`
  - [x] `hol.chat.sendMessage`
  - [x] `hol.chat.history`
  - [x] `hol.chat.end`
- [x] Access control:
  - [x] block paid chat tools when auth preconditions are missing
  - [x] return actionable `isError: true` responses
- [x] `sendMessage` behavior:
  - [x] support provided `sessionId`
  - [x] optional auto-create session when `sessionId` absent and target provided

## 12. Registration Tools (Onboarding Vertical Slice)

- [x] Implement `src/mcp/tools/registration.ts` tools:
  - [x] `hol.getRegistrationQuote`
  - [x] `hol.registerAgent`
  - [x] `hol.waitForRegistrationCompletion`
- [x] `hol.waitForRegistrationCompletion`:
  - [x] poll progress endpoint with interval + timeout controls
  - [x] deterministic timeout response
  - [x] cancellation-aware loop
- [x] Preserve Broker status fields (`pending`, `partial`, success variants) without inventing statuses.

## 13. Workflow Tools

- [x] Implement `src/mcp/workflows/discoveryWorkflow.ts`:
  - [x] `workflow.discovery`
  - [x] orchestrate normalized discovery and top result selection
- [x] Implement `src/mcp/workflows/registrationWorkflow.ts`:
  - [x] `workflow.registration`
  - [x] sequence: quote -> register -> optional wait
  - [x] emit structured progress logs
- [x] Ensure workflow outputs are predictable and schema-valid.

## 14. HTTP/Auth Policy Controls

- [x] Implement HTTP Bearer gate:
  - [x] if `MCP_SERVER_BEARER_TOKEN` set, require exact `Authorization: Bearer ...`
  - [x] return `401` on missing/invalid token
- [x] Implement tool policy map:
  - [x] free tools: discovery/stats
  - [x] paid tools: chat + registration
- [x] Enforce preflight checks for paid operations before upstream call.

## 15. End-to-End Scripts and Test Harness

- [x] Implement `scripts/e2e/streamable-http-smoke.ts`:
  - [x] start server
  - [x] initialize
  - [x] tools/list
  - [x] call `hol.stats`
  - [x] call `hol.search`
- [x] Implement `scripts/e2e/stdio-smoke.ts`:
  - [x] spawn stdio server
  - [x] initialize
  - [x] tools/list
  - [x] call `hol.stats`
  - [x] call `hol.search`
- [x] Add `scripts/tool-suite/run-tool-suite.ts` for deterministic local validation.

## 16. Unit and Integration Tests

- [x] Unit tests:
  - [x] `tests/unit/toolSchemas.test.ts`
  - [x] `tests/unit/brokerErrors.test.ts`
  - [x] env parsing + redaction tests
  - [x] origin validation tests
- [x] Integration tests (mock network boundary only):
  - [x] `tests/integration/brokerClient.mock.test.ts`
  - [x] `tests/integration/mcp.toolCalls.http.test.ts`
- [x] Cover key error-path expectations:
  - [x] missing API key on paid tools
  - [x] Broker 401/403/429 mapping
  - [x] protocol header validation behavior

## 17. CI and Quality Gates

- [x] Create `.github/workflows/ci.yml`:
  - [x] setup Node 20 + pnpm
  - [x] install with lockfile
  - [x] build
  - [x] test run
  - [x] optional coverage upload
- [x] Add static no-stub enforcement:
  - [x] fail CI if any stub markers are present
  - [x] run from script in `scripts/tool-suite/`
- [x] Add optional manual `ci-live.yml` for live Broker smoke tests with secrets.

## 18. Documentation

- [x] `README.md`:
  - [x] project purpose
  - [x] env var matrix
  - [x] run commands
  - [x] transport compatibility table
  - [x] security notes
- [x] `docs/architecture.md`:
  - [x] layered architecture and component responsibilities
- [x] `docs/threat-model.md`:
  - [x] Origin validation / DNS rebinding mitigation
  - [x] auth boundaries
  - [x] log redaction rules
- [x] `docs/acceptance.md`:
  - [x] explicit no-stubs acceptance gates
- [x] `docs/runbooks.md`:
  - [x] local startup
  - [x] troubleshooting
  - [x] production-hardening next steps

## 19. Final Validation Gates (Release Blockers)

- [x] Gate A: static stub ban passes.
- [x] Gate B: `tools/list` includes all promised tools (discovery, chat, registration, workflows).
- [x] Gate C: live `hol.stats` succeeds against Broker.
- [x] Gate D: live discovery:
  - [x] `hol.search` works for known query
  - [x] `hol.vectorSearch` returns valid schema even if empty
- [ ] Gate E: live onboarding flow:
  - [ ] quote -> register -> wait works or times out deterministically
- [ ] Gate F: live chat flow:
  - [x] create session -> send -> history -> end
- [x] Gate G: both transport smoke tests pass:
  - [x] `smoke:http`
  - [x] `smoke:stdio`
- [ ] Gate H: CI green on clean checkout.

## 20. Phase-2 Backlog (Not in Initial POC)

- [ ] Full OAuth 2.1 MCP HTTP authorization model for hosted multi-tenant deployments.
- [ ] Durable workflow/task state with Redis/DB at scale.
- [ ] Encrypted chat key lifecycle and advanced workflow tooling.
- [ ] Credits purchasing flows (HBAR/Stripe/x402) with explicit interactive approval controls.
- [ ] Expanded observability dashboards and SLO burn-rate alerting.
