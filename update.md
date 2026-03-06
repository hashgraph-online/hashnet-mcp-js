# HOL MCP Server Update Plan

## Objective

Turn this repository from a working proof of concept into a production-grade MCP server that is easy for AI agents to discover, trust, invoke, recover from, and operate at scale.

## What the current codebase already does well

- Keeps the implementation small and understandable.
- Uses the official MCP SDK rather than inventing a protocol layer.
- Separates transports, tool registration, broker access, config, and logging cleanly.
- Avoids stubbed tool behavior and exercises at least one real end-to-end MCP path.
- Starts from a safer-than-default local HTTP posture.

## Current gaps observed in this repository

- HTTP sessions are stored in an in-memory map with no idle timeout, no maximum session count, and no eviction policy.
- `workflow.discovery` allows arbitrary `filters` to overwrite its normalized `query` and `limit`, which defeats the point of the workflow abstraction.
- Only `hol.stats` declares an `outputSchema`; the rest of the tool surface returns ad hoc payloads.
- Tool errors are text-only, so agents cannot reliably branch on error type, retryability, auth failures, validation failures, or upstream broker failures.
- `hol.chat.sendMessage` supports auto-session creation but not the richer session options supported by `hol.chat.createSession`, so the simple path is weaker than the manual path.
- Observability exists mostly as logging; the telemetry helper is currently unused.
- The test suite proves the happy path for `hol.stats`, but most security, lifecycle, workflow, and failure paths are not covered.
- Several environment flags and secret fields are defined but not yet wired into runtime behavior, which increases cognitive load for operators.

## Product principles for massive adoption

- Every tool should be predictable for machines first and readable for humans second.
- Every error should be machine-classifiable.
- Every long-running action should support progress, cancellation, timeout control, and resumability.
- Every transport should behave consistently enough that clients do not need transport-specific workarounds.
- Every deployment path should be easy to bootstrap in under five minutes.
- Every public contract should be versioned and explicitly documented.

## P0: Must-fix implementation work

- Add session TTLs, idle reaping, and a hard session cap for HTTP transports.
- Track session creation time, last activity time, client info, and transport type in a dedicated session registry instead of a plain object map.
- Expose server health endpoints such as `/healthz`, `/readyz`, and `/metrics`.
- Add broker request timeouts, retry policy, connection pooling, and circuit breaking.
- Make `workflow.discovery` preserve `query` and `limit` as authoritative workflow inputs even when filters are supplied.
- Replace free-form workflow `filters` with a validated allowlist of supported search fields.
- Add `outputSchema` to every tool and workflow.
- Standardize tool results into a small set of stable envelopes such as `success`, `data`, `meta`, and `error`.
- Return structured errors with fields like `code`, `category`, `retryable`, `statusCode`, `upstream`, and `details`.
- Add agent-friendly summaries that are short and deterministic, while keeping full raw data in structured content.
- Add pagination metadata everywhere results can be truncated.
- Add stable identifiers for result objects so agents can refer back to prior outputs safely.
- Add explicit schema versioning to tool outputs.
- Add validation that rejects contradictory or ambiguous inputs early with actionable messages.
- Extend `hol.chat.sendMessage` so the auto-session path accepts the same session creation options as `hol.chat.createSession`.
- Add first-class support for conversation continuation and resumable session lookup by a client-supplied idempotency key.
- Add request idempotency keys for all paid or state-changing tools.
- Add safe cancellation propagation for all broker-backed operations, not only registration waiting.
- Add per-tool timeout controls with sane defaults and hard upper bounds.
- Add a `server.info` or `hol.capabilities` tool that returns version, supported transports, feature flags, limits, auth requirements, and broker reachability.

## P0: Agent ergonomics

- Rewrite tool titles and descriptions to be shorter, less broker-internal, and more action-oriented.
- Add examples for every tool input schema so agent frameworks can auto-generate better calls.
- Prefer one-step workflows over multi-step manual flows for common agent tasks.
- Add a `workflow.findAndChat` flow that discovers an agent, ranks candidates, creates a session, and sends the first message.
- Add a `workflow.resolveAndRegister` flow that validates a profile, fetches a quote, registers, and waits with progress events.
- Return small canonical fields such as `summary`, `topHits`, `selected`, `nextActions`, and `warnings`.
- Include explicit `requiresAuth` and `requiresPayment` flags in tool metadata or a capability-discovery tool.
- Return deterministic ordering for search results unless the caller explicitly opts into another sort.
- Normalize synonyms across tool inputs so agents do not need to remember `q` versus `query` or other duplicate field names.
- Add a compact mode for token-constrained agents and a verbose mode for debugging.
- Add machine-readable remediation hints for auth, quota, validation, and timeout failures.
- Ensure all tools are safe to call speculatively by clearly marking destructive operations and by offering dry-run modes first.

## P0: Security and trust

- Replace the bearer-token gate with proper MCP authorization aligned with current MCP auth expectations.
- Add scoped permissions so discovery, chat, and registration can be enabled independently.
- Introduce tenant-aware authorization and ownership checks for sessions and registration attempts.
- Add request size limits, rate limits by caller identity, and abuse protections per tool class.
- Add audit logging for state-changing operations with actor identity, tool name, and outcome.
- Redact sensitive data from tool outputs as well as logs.
- Add validation to prevent leaking broker-internal error payloads directly to clients when those payloads may contain sensitive context.
- Disable legacy SSE by default in all production examples and document its compatibility-only status prominently.

## P1: Reliability and scale

- Move session state to a pluggable backend with in-memory default plus Redis for shared deployment.
- Add optional durable workflow state for long-running registration and chat operations.
- Introduce an outbound broker client abstraction that supports retries, hedging, deadlines, and standardized failure mapping.
- Add caching for read-heavy discovery calls with configurable TTLs and cache-key normalization.
- Add bulkhead isolation so chat, discovery, and registration do not starve each other under load.
- Add concurrency budgets per tool family rather than one global broker limiter.
- Add backpressure metrics and request rejection modes when capacity is exhausted.
- Add graceful shutdown that stops accepting new work, drains active sessions, and exposes shutdown status.
- Add compatibility tests across stdio, streamable HTTP, and legacy SSE to verify identical logical behavior.
- Benchmark startup time, request latency, concurrent session count, and steady-state memory usage.
- Add explicit SLOs for discovery latency, chat round-trip latency, and registration completion polling behavior.
- Publish load-test scripts and reference performance numbers.

## P1: Protocol and SDK quality

- Add prompts and resources where they improve discoverability and composability, not just tools.
- Expose prompt templates that teach agents how to use discovery and registration safely.
- Add resources for server capabilities, example payloads, error codes, and operational status.
- Support streaming results for long-running chat and registration progress instead of collapsing everything into a final response.
- Emit MCP logging notifications consistently during workflows and high-latency operations.
- Add a transport-agnostic request context object so auth, telemetry, timeouts, and tracing are handled uniformly.
- Publish a JSON Schema bundle for all input and output contracts.
- Generate typed client helpers from the schema bundle for TypeScript consumers.
- Add a protocol-compatibility matrix by MCP SDK version and protocol version.
- Pin and test against multiple MCP SDK versions when feasible.

## P1: Developer and operator experience

- Publish the server as an installable package with a stable binary name.
- Add Docker, Docker Compose, and minimal cloud deployment examples.
- Add a `doctor` CLI command that validates environment variables, broker connectivity, auth setup, and transport reachability.
- Add a `print-config` CLI command that shows effective config with safe redaction.
- Add a `serve` CLI with explicit flags instead of relying mostly on environment variables.
- Provide example configs for local-only, LAN, container, and hosted deployments.
- Add structured startup validation that explains missing requirements by feature area.
- Add OpenTelemetry support for traces, metrics, and logs.
- Add dashboards and alert templates for common failure modes.
- Add release automation, semantic versioning, changelog generation, and compatibility notes.
- Add signed releases and provenance attestations if this is intended for broad public adoption.

## P1: Testing expansion

- Add integration tests for all tools, not only `hol.stats`.
- Add explicit tests for auth failures, origin failures, missing protocol headers, and invalid session ids.
- Add tests for session cleanup, idle timeout, and max-session enforcement.
- Add tests for workflow input collision cases, especially `workflow.discovery` filter overrides.
- Add tests for all structured error categories.
- Add broker-mock tests for retryable versus non-retryable upstream failures.
- Add cancellation tests for aborted requests.
- Add smoke tests that verify both machine-readable structured content and human-readable text content.
- Add regression tests that assert tool metadata stability.
- Add live acceptance tests gated by environment so production-like validation remains easy to run.

## P2: Adoption accelerators

- Publish copy-paste integration guides for Claude, ChatGPT, Cursor, VS Code, Windsurf, and generic MCP hosts.
- Provide one-command local startup flows for `npx`, Docker, and Homebrew-style install paths.
- Publish a public compatibility badge matrix showing transports, auth modes, and tested hosts.
- Add sample agent recipes for common use cases such as agent discovery, ranking, chat bootstrap, and registration.
- Provide canonical prompts and tool-call examples optimized for LLM planners.
- Add a hosted sandbox mode with demo credentials for evaluation.
- Publish a public error-code reference and troubleshooting guide keyed by exact machine-readable codes.
- Add migration guides between versions whenever schemas change.
- Add example repos showing how to embed this server inside larger agent platforms.
- Publish benchmark reports and cost guidance for hosted deployment.
- Provide a conformance test kit for downstream forks and integrators.
- Establish a deprecation policy so client builders can trust the contract over time.

## Suggested file-level refactors in this repository

- Split transport session management out of `src/transports/httpStreamable.ts` into a dedicated session manager module.
- Introduce result and error envelope builders in `src/mcp/tools/result.ts` that enforce a single contract shape.
- Add output schemas next to the existing input schemas in `src/mcp/schemas/common.ts` or split them into per-domain schema files.
- Move repeated `traceIdFrom` helpers into a shared utility.
- Introduce a broker service layer that handles deadlines, retries, telemetry, and common error mapping once.
- Add an auth module that is transport-agnostic and future-proof for OAuth-style MCP auth.
- Add a discovery adapter layer that normalizes broker responses into agent-friendly domain objects before returning them to MCP clients.
- Add a config schema with richer validation and feature-dependent requirements.
- Wire `src/observability/telemetry.ts` into every tool and workflow path or remove it until used.
- Add a `src/serverInfo` or `src/capabilities` module for host and agent discovery.

## Recommended milestone order

1. Lock down contract quality: structured outputs, structured errors, output schemas, and workflow input fixes.
2. Add operational safety: session lifecycle controls, timeouts, retries, health checks, and richer tests.
3. Improve agent UX: one-step workflows, capability discovery, examples, deterministic summaries, and dry-run flows.
4. Add production deployment features: durable state, auth hardening, metrics, packaging, and release automation.
5. Expand ecosystem reach: docs, client helpers, benchmarks, conformance suite, and host-specific integration guides.

## Suggested acceptance criteria for the next major iteration

- Every tool and workflow exposes both input and output schemas.
- Every error returned to clients includes a stable machine-readable code.
- HTTP session count is bounded and idle sessions are reaped automatically.
- Discovery, chat, and registration flows each have deterministic happy-path and failure-path integration tests.
- The server can be installed and started through at least two frictionless paths.
- A generic MCP host can discover tool capabilities without reading the source code.
- A token-constrained LLM can complete the main workflows using only concise structured outputs.
- Operational metrics exist for request rate, latency, error rate, active sessions, retries, and upstream broker status.

## Bottom line

The fastest path to massive adoption is not adding more tools first. It is making the existing tools predictable, typed, observable, resumable, and easy for agents to use correctly on the first attempt.
