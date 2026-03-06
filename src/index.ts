import { createBrokerRateLimiter } from "./broker/rateLimit.js";
import { loadEnv, redactEnvForLogs } from "./config/env.js";
import { getFeatureFlags } from "./config/featureFlags.js";
import { createMcpServer } from "./mcp/createServer.js";
import { createLogger } from "./observability/logger.js";
import { runStreamableHttp } from "./transports/httpStreamable.js";
import { runStdio } from "./transports/stdio.js";

async function main(): Promise<void> {
  const env = loadEnv();
  const flags = getFeatureFlags(process.env);
  const logger = createLogger(env);
  const rateLimiter = createBrokerRateLimiter(env);

  logger.info({ env: redactEnvForLogs(env), flags }, "starting HOL MCP server POC");

  const createServer = () =>
    createMcpServer({
      env,
      flags,
      logger,
      rateLimiter,
    });

  const shutdown = async () => {
    logger.info("shutdown requested");
    await rateLimiter.stop();
  };

  process.once("SIGINT", () => {
    void shutdown();
  });
  process.once("SIGTERM", () => {
    void shutdown();
  });

  if (env.mcpTransport === "stdio") {
    const server = createServer();
    await runStdio(server, { logger });
    return;
  }

  await runStreamableHttp({
    env,
    flags,
    logger,
    createServer,
  });
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
