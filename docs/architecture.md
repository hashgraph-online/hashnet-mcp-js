# Architecture

The server is split into these layers:

- `transports/`: stdio, Streamable HTTP, and optional legacy SSE compatibility.
- `mcp/`: MCP server construction, tool registration, workflow composition.
- `broker/`: standards-sdk client factory, rate limiting, error mapping.
- `observability/`: structured logging and request correlation.
- `config/`: environment parsing and feature flags.

All discovery/chat/registration calls route through the broker layer and execute real Registry Broker requests.
