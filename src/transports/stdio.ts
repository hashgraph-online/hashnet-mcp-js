import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { AppLogger } from "../observability/logger.js";

interface RunStdioOptions {
  logger: AppLogger;
}

export async function runStdio(server: McpServer, options: RunStdioOptions): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  options.logger.info("stdio transport connected");
}
