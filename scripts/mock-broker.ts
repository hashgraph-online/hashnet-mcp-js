#!/usr/bin/env tsx
import type { IncomingMessage, ServerResponse } from 'node:http';
import http from 'node:http';

const port = Number(process.env.MOCK_BROKER_PORT ?? 4545);

const server = http.createServer(async (req: IncomingMessage, res: ServerResponse) => {
  if (!req.url?.startsWith('/mcp/stream')) {
    res.writeHead(404).end();
    return;
  }

  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }
  const body = Buffer.concat(chunks).toString();
  const request = body ? JSON.parse(body) : {};

  if (request.method === 'tools/call') {
    return handleToolCall(request, res);
  }

  res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', result: {}, id: request.id ?? null }));
});

server.listen(port, () => {
  console.log(`Mock broker listening on ${port}`);
});

const handlers: Record<string, (payload: any) => any> = {
  'rb.search': () => ({ hits: [] }),
  'rb.vectorSearch': () => ({ hits: [] }),
  'rb.getRegistrationQuote': () => ({ fee: '1 hbar' }),
  'rb.registerAgent': () => ({ attemptId: 'mock-attempt' }),
  'rb.waitForRegistrationCompletion': () => ({ result: { uaid: 'uaid:mock' } }),
  'rb.chat.createSession': () => ({ sessionId: 'mock-session' }),
  'rb.chat.sendMessage': () => ({ ok: true }),
  'rb.chat.getHistory': () => ({ entries: [] }),
  'rb.chat.compactHistory': () => ({ ok: true }),
  'rb.chat.endSession': () => ({ ok: true }),
  'rb.listProtocols': () => ({ protocols: [] }),
  'rb.detectProtocol': () => ({ protocol: 'mock' }),
  'rb.stats': () => ({ total: 0 }),
  'rb.metricsSummary': () => ({ ok: true }),
  'rb.dashboardStats': () => ({ ok: true }),
};

function handleToolCall(request: any, res: ServerResponse) {
  const name = request.params?.name;
  const handler = handlers[name];
  const result = handler ? handler(request.params?.arguments) : { note: 'mock result' };

  res.writeHead(200, { 'content-type': 'application/json' }).end(
    JSON.stringify({ jsonrpc: '2.0', result: { content: [{ type: 'object', object: result }] }, id: request.id ?? null }),
  );
}
