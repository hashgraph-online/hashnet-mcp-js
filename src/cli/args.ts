export interface CliParseResult {
  env: Record<string, string>;
  helpText?: string;
}

const HELP_TEXT = `HOL MCP Server

Usage:
  npx @hol-org/hashnet-mcp [options]

Options:
  --transport <stdio|http>       Select MCP transport
  --stdio                        Shortcut for --transport stdio
  --http                         Shortcut for --transport http
  --host <host>                  HTTP bind host
  --port <port>                  HTTP bind port
  --allowed-origins <csv>        Comma-separated HTTP origin allowlist
  --broker-url <url>             Registry Broker base URL
  --bearer-token <token>         HTTP bearer token gate
  --log-level <level>            Pino log level
  --legacy-sse                   Enable legacy SSE compatibility routes
  --help                         Show this help

Examples:
  npx @hol-org/hashnet-mcp --stdio
  npx @hol-org/hashnet-mcp --http --host 127.0.0.1 --port 3333
  REGISTRY_BROKER_API_KEY=... npx @hol-org/hashnet-mcp --stdio
`;

function requireValue(argv: string[], index: number, flag: string): string {
  const value = argv[index];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }

  return value;
}

function parsePort(value: string): string {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`--port must be a positive integer, received "${value}"`);
  }

  return String(parsed);
}

export function parseCliArgs(argv: string[]): CliParseResult {
  const env: Record<string, string> = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    switch (arg) {
      case "--help":
        return {
          env,
          helpText: HELP_TEXT,
        };
      case "--transport": {
        const value = requireValue(argv, index + 1, "--transport");
        if (value !== "stdio" && value !== "http") {
          throw new Error(`--transport must be "stdio" or "http", received "${value}"`);
        }
        env.MCP_TRANSPORT = value;
        index += 1;
        break;
      }
      case "--stdio":
        env.MCP_TRANSPORT = "stdio";
        break;
      case "--http":
        env.MCP_TRANSPORT = "http";
        break;
      case "--host":
        env.MCP_HOST = requireValue(argv, index + 1, "--host");
        index += 1;
        break;
      case "--port":
        env.MCP_PORT = parsePort(requireValue(argv, index + 1, "--port"));
        index += 1;
        break;
      case "--allowed-origins":
        env.MCP_ALLOWED_ORIGINS = requireValue(argv, index + 1, "--allowed-origins");
        index += 1;
        break;
      case "--broker-url":
        env.REGISTRY_BROKER_API_URL = requireValue(argv, index + 1, "--broker-url");
        index += 1;
        break;
      case "--bearer-token":
        env.MCP_SERVER_BEARER_TOKEN = requireValue(argv, index + 1, "--bearer-token");
        index += 1;
        break;
      case "--log-level":
        env.LOG_LEVEL = requireValue(argv, index + 1, "--log-level");
        index += 1;
        break;
      case "--legacy-sse":
        env.FEATURE_LEGACY_SSE = "1";
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return { env };
}

export function getCliHelpText(): string {
  return HELP_TEXT;
}
