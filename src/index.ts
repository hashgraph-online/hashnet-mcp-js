import { runSSE, runStdio } from './transports';
import { logger } from './logger';

const transport = (process.env.MCP_TRANSPORT ?? 'sse').toLowerCase();

if (transport === 'stdio') {
  logger.info({ transport }, 'starting MCP server');
  runStdio().catch((err) => {
    logger.error({ err }, 'Failed to start stdio transport');
    process.exitCode = 1;
  });
} else {
  logger.info({ transport }, 'starting MCP server');
  runSSE().catch((err) => {
    logger.error({ err }, 'Failed to start SSE transport');
    process.exitCode = 1;
  });
}
