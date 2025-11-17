import pino from 'pino';
import { config } from './config';

// Log to stderr so stdio MCP transport keeps stdout reserved for protocol traffic.
export const logger = pino(
  {
    level: config.logLevel,
    base: undefined,
  },
  pino.destination(2),
);
