import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { nodeTransport } from '../src/api/node-transport';
import { PAIRED } from './support/fake-edge';

interface Received {
  readonly method: string | undefined;
  readonly url: string | undefined;
  readonly authorization: string | undefined;
  readonly body: string;
}

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((done) => server.close(done))));
});

/** A local HTTP server on a free port. It records each request and answers with `answer`. */
async function serve(answer: (request: IncomingMessage) => { status: number; headers?: Record<string, string> }) {
  const received: Received[] = [];
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      const { method, url, headers } = request;
      received.push({ method, url, authorization: headers.authorization, body: Buffer.concat(chunks).toString('utf8') });
      const { status, headers: extra } = answer(request);
      response.writeHead(status, { 'Content-Type': 'application/json', ...extra });
      response.end('{}');
    });
  });
  servers.push(server);
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  return { origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, received };
}

describe('the desktop transport', () => {
  it.each([307, 308])('a redirect to another origin sends no secret there (%i)', async (status) => {
    const other = await serve(() => ({ status: 200 }));
    const edge = await serve((request) => ({ status, headers: { Location: `${other.origin}${request.url ?? '/'}` } }));

    const answer = await nodeTransport()({
      origin: edge.origin,
      method: 'POST',
      path: '/v1/sessions/refresh',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${PAIRED.credential}` },
      body: JSON.stringify({ refresh_token: PAIRED.refresh_token }),
    });

    expect(other.received).toEqual([]);
    expect(edge.received).toHaveLength(1);
    expect(answer.status).toBe(status);
  });
});
