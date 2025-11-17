import http, { IncomingMessage, ServerResponse } from 'node:http';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

const startMock = vi.fn().mockResolvedValue(undefined);

vi.mock('../../src/mcp', () => ({
  mcp: {
    start: startMock,
  },
  registeredTools: [{ name: 'hol.search' }],
}));

const createServerSpy = vi.spyOn(http, 'createServer');
const listenSpy = vi.fn();

beforeEach(() => {
  startMock.mockClear();
  listenSpy.mockReset();

  const fakeServer = {
    listen: listenSpy.mockImplementation(function (this: http.Server, _port: number, cb?: () => void) {
      cb?.();
      return this;
    }),
    once: vi.fn(),
  } as unknown as http.Server;

  createServerSpy.mockReturnValue(fakeServer);
});

afterEach(() => {
  createServerSpy.mockReset();
});

describe('transports', () => {
  it('invokes stdio transport when requested', async () => {
    const { runStdio } = await import('../../src/transports');
    await runStdio();
    expect(startMock).toHaveBeenCalledWith(expect.objectContaining({ transportType: 'stdio' }));
  });

  it('starts upstream HTTP stream backend and gateway server', async () => {
    const { runSSE } = await import('../../src/transports');
    await runSSE();
    expect(startMock).toHaveBeenCalledWith(expect.objectContaining({ transportType: 'httpStream' }));
    expect(listenSpy).toHaveBeenCalled();
  });

  it('handles /healthz locally', async () => {
    const { createGatewayHandler } = await import('../../src/transports');
    const handler = createGatewayHandler(9999);
    const req = new IncomingMessage(null);
    req.url = '/healthz';
    const res = new ServerResponse(req);
    const endMock = vi.spyOn(res, 'end').mockImplementation(() => res);

    handler(req, res);
    expect(endMock).toHaveBeenCalled();
    const responseBody = endMock.mock.calls[0][0] as string;
    expect(JSON.parse(responseBody).status).toBe('ok');
  });
});
