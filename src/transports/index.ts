import http, { IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { PassThrough } from 'node:stream';
import { mcp, registeredTools } from '../mcp';
import { config } from '../config';
import { logger } from '../logger';

const LOOPBACK = '127.0.0.1';

export async function runStdio() {
  logger.info('Starting stdio transport');
  await mcp.stdio();
  logger.info('Stdio transport exited');
}

export async function runSSE() {
  const upstreamPort = config.httpStreamPort ?? config.port + 1;
  await startHttpStreamBackend(upstreamPort);

  const gateway = createGatewayServer(upstreamPort);
  await new Promise<void>((resolve, reject) => {
    gateway.once('error', reject);
    gateway.listen(config.port, () => {
      logger.info({ port: config.port, upstreamPort }, 'Gateway listening');
      resolve();
    });
  });
}

async function startHttpStreamBackend(port: number) {
  await mcp.start({
    transportType: 'httpStream',
    httpStream: {
      port,
      host: LOOPBACK,
      endpoint: '/mcp/stream',
      enableJsonResponse: false,
    },
  });
  logger.info({ port }, 'HTTP stream backend ready');
}

export function createGatewayServer(upstreamPort: number) {
  return http.createServer(createGatewayHandler(upstreamPort));
}

export function createGatewayHandler(upstreamPort: number) {
  return (req: IncomingMessage, res: ServerResponse) => {
    if (!req.url) {
      res.writeHead(400).end('Missing URL');
      return;
    }
    if (req.url.startsWith('/healthz')) {
      const body = JSON.stringify({
        status: 'ok',
        uptime: process.uptime(),
        tools: registeredTools.length,
        requestId: randomUUID(),
      });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(body);
      return;
    }
    proxyRequest(req, res, upstreamPort);
  };
}

function proxyRequest(req: IncomingMessage, res: ServerResponse, upstreamPort: number) {
  logger.debug({ method: req.method, url: req.url }, 'gateway.forward');
  const proxyReq = http.request(
    {
      hostname: LOOPBACK,
      port: upstreamPort,
      method: req.method,
      path: req.url,
      headers: {
        ...req.headers,
        host: `${LOOPBACK}:${upstreamPort}`,
      },
    },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
      proxyRes.pipe(res);
    },
  );

  proxyReq.on('error', (error) => {
    logger.error({ error }, 'proxy.error');
    if (!res.headersSent) {
      res.writeHead(502);
    }
    res.end('Upstream error');
  });

  if (req.method && ['POST', 'PUT', 'PATCH'].includes(req.method)) {
    const tee = new PassThrough();
    let preview = '';
    tee.on('data', (chunk) => {
      if (preview.length < 512) {
        preview += chunk.toString();
      }
    });
    tee.on('end', () => {
      if (preview.length) {
        logger.debug({ preview: preview.slice(0, 512) }, 'proxy.preview');
      }
    });
    req.pipe(tee).pipe(proxyReq);
  } else {
    req.pipe(proxyReq);
  }
}
