# Threat Model (POC)

## Assets

- Registry Broker credentials (`REGISTRY_BROKER_API_KEY`, ledger/private keys)
- Paid operations (chat + registration)
- Session identifiers and workflow attempt identifiers
- Tool call payloads and logs

## Trust Boundaries

- MCP client -> MCP server transport boundary (stdio or HTTP)
- MCP server -> Registry Broker API boundary
- Local config and environment secret boundary

## Key Threats and Mitigations

1. DNS rebinding / browser-origin abuse
- Mitigation: HTTP transport validates `Origin` against `MCP_ALLOWED_ORIGINS`.
- Mitigation: default bind host is `127.0.0.1`.
- Mitigation: non-local bind without `MCP_SERVER_BEARER_TOKEN` fails startup.

2. Broken authentication / unauthorized paid operations
- Mitigation: optional HTTP bearer gate (`MCP_SERVER_BEARER_TOKEN`).
- Mitigation: tool policy gate blocks paid tools if Broker credentials are not configured.

3. Credential leakage via logs
- Mitigation: structured logger redacts keys/tokens/private keys.
- Mitigation: startup diagnostics use redacted env rendering.

4. Abuse and request floods
- Mitigation: Broker-bound requests pass through Bottleneck rate limiter.
- Mitigation: limits are configurable by env for concurrency and minimum spacing.

5. Cross-session misuse (hosted future risk)
- Mitigation in POC: session IDs are transport-scoped and validated.
- Future hardening: tenant-aware authz around session/attempt ownership.

## Residual Risk (POC)

- OAuth resource-server semantics are not implemented in this POC.
- Multi-tenant object-level authorization is not implemented in this POC.
- Legacy SSE compatibility expands attack surface; keep feature-flagged.
