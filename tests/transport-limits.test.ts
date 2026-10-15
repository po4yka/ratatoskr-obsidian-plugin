import { createServer, type ServerResponse, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import type { HttpRequest } from '../src/api/http';
import { nodeTransport, TRANSPORT_LIMITS } from '../src/api/node-transport';

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map((server) => {
      server.closeAllConnections();
      return new Promise((done) => server.close(done));
    }),
  );
});

/** A local HTTP server on a free port that answers each request with `answer`. */
async function serve(answer: (response: ServerResponse) => void): Promise<string> {
  const server = createServer((request, response) => {
    request.resume();
    request.on('end', () => answer(response));
  });
  servers.push(server);
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

function manifestTo(origin: string): HttpRequest {
  return { origin, method: 'POST', path: '/v1/notes/connections/c/manifest', headers: { 'Content-Type': 'application/json' }, body: '{}' };
}

describe('the limits of the desktop transport', () => {
  it('a body larger than 8 MiB is refused', async () => {
    expect(TRANSPORT_LIMITS.maxBodyBytes).toBe(8 * 1024 * 1024);
    const origin = await serve((response) => {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(`"${'x'.repeat(TRANSPORT_LIMITS.maxBodyBytes - 1)}"`);
    });

    await expect(nodeTransport()(manifestTo(origin))).rejects.toThrow(/8 MiB/);
  });

  it('a file answer may pass 8 MiB and stops at 64 MiB', async () => {
    expect(TRANSPORT_LIMITS.maxContentBytes).toBe(64 * 1024 * 1024);
    const origin = await serve((response) => {
      response.writeHead(200, { 'Content-Type': 'application/octet-stream' });
      response.end(Buffer.alloc(response.req.url === '/large' ? TRANSPORT_LIMITS.maxContentBytes + 1 : TRANSPORT_LIMITS.maxBodyBytes + 1));
    });
    const content = (path: string): HttpRequest => ({ origin, method: 'GET', path, headers: {}, answer: 'bytes' });

    const answer = await nodeTransport()(content('/medium'));

    expect(answer.bytes?.length).toBe(TRANSPORT_LIMITS.maxBodyBytes + 1);
    await expect(nodeTransport()(content('/large'))).rejects.toThrow(/64 MiB/);
  });

  it('a slow answer stops at the total deadline', async () => {
    // One byte each 20 ms keeps the idle timeout from firing; only the deadline can stop it.
    const origin = await serve((response) => {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      let left = 40;
      const drip = setInterval(() => {
        left -= 1;
        if (left === 0 || response.destroyed) {
          clearInterval(drip);
          response.end(' ');
        } else {
          response.write(' ');
        }
      }, 20);
    });
    const limits = { ...TRANSPORT_LIMITS, deadlineMs: 200, idleMs: 500 };

    await expect(nodeTransport(undefined, limits)(manifestTo(origin))).rejects.toThrow(/in time/);
  });
});
