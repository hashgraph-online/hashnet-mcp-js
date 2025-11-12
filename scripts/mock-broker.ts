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

  if (request.method === 'initialize') {
    res
      .writeHead(200, { 'content-type': 'application/json' })
      .end(
        JSON.stringify({
          jsonrpc: '2.0',
          result: {
            protocolVersion: '2024-10-07',
            capabilities: { prompts: {}, tools: {}, resources: {} },
            serverInfo: { name: 'mock-broker', version: '0.0.0' },
          },
          id: request.id ?? null,
        }),
      );
    return;
  }

  if (request.method === 'tools/call') {
    return handleToolCall(request, res);
  }

  if (request.id !== undefined) {
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', result: {}, id: request.id ?? null }));
    return;
  }

  res.writeHead(204).end();
});

server.listen(port, () => {
  console.log(`Mock broker listening on ${port}`);
});

const handlers: Record<string, (payload: any) => any> = {
  'hol.search': () => ({ hits: [] }),
  'hol.vectorSearch': () => ({ hits: [] }),
  'hol.getRegistrationQuote': () => ({ fee: '1 hbar' }),
  'hol.registerAgent': () => ({ attemptId: 'mock-attempt' }),
  'hol.waitForRegistrationCompletion': () => ({ result: { uaid: 'uaid:mock' } }),
  'hol.chat.createSession': () => ({ sessionId: 'mock-session' }),
  'hol.chat.sendMessage': () => ({ ok: true }),
  'hol.chat.getHistory': () => ({ entries: [] }),
  'hol.chat.compactHistory': () => ({ ok: true }),
  'hol.chat.endSession': () => ({ ok: true }),
  'hol.listProtocols': () => ({ protocols: [] }),
  'hol.detectProtocol': () => ({ protocol: 'mock' }),
  'hol.stats': () => ({ total: 0 }),
  'hol.metricsSummary': () => ({ ok: true }),
  'hol.dashboardStats': () => ({ ok: true }),
};

function handleToolCall(request: any, res: ServerResponse) {
  const name = request.params?.name;
  const handler = handlers[name];
  const result = handler ? handler(request.params?.arguments) : { note: 'mock result' };

  res.writeHead(200, { 'content-type': 'application/json' }).end(
    JSON.stringify({
      jsonrpc: '2.0',
      result: {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result),
          },
        ],
        structuredContent: result,
      },
      id: request.id ?? null,
    }),
  );
}
