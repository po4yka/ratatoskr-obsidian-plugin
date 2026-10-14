import type * as Http from 'node:http';
import type { HttpResponse, Transport } from './http';

/** The Node clients that the desktop app has. A phone or a tablet has none. */
export interface NodeClients {
  readonly http: Pick<typeof Http, 'request'>;
  readonly https: Pick<typeof Http, 'request'>;
}

const TIMEOUT_MS = 60_000;

/** The Node clients of this runtime, or `undefined` where there is no Node (Obsidian mobile). */
export function nodeClients(): NodeClients | undefined {
  const load = (globalThis as { process?: { getBuiltinModule?: (id: string) => unknown } }).process?.getBuiltinModule;
  const http = load?.('node:http') as NodeClients['http'] | undefined;
  const https = load?.('node:https') as NodeClients['https'] | undefined;
  return http === undefined || https === undefined ? undefined : { http, https };
}

/**
 * The transport of the desktop app: one request to `origin` + `path`, and to no other address.
 *
 * The Node client follows no redirect, so a 3xx answer comes back as it is and the Edge client
 * refuses it. Obsidian `requestUrl` cannot do this: it follows a redirect and does not report where.
 */
export function nodeTransport(clients: NodeClients | undefined = nodeClients()): Transport {
  if (clients === undefined) {
    throw new Error('this runtime has no Node HTTP client');
  }
  return (request) =>
    new Promise<HttpResponse>((resolve, reject) => {
      const base = new URL(request.origin);
      const url = new URL(request.path, base);
      if (url.origin !== base.origin) {
        reject(new Error('the request path names another origin'));
        return;
      }
      const client = url.protocol === 'https:' ? clients.https : clients.http;
      const outgoing = client.request(url, { method: request.method, headers: { ...request.headers } }, (incoming) => {
        const chunks: Buffer[] = [];
        incoming.on('data', (chunk: Buffer) => chunks.push(chunk));
        incoming.on('error', reject);
        incoming.on('end', () => resolve(answer(incoming.statusCode ?? 0, Buffer.concat(chunks).toString('utf8'))));
      });
      outgoing.setTimeout(TIMEOUT_MS, () => outgoing.destroy(new Error('Edge did not answer in time')));
      outgoing.on('error', reject);
      outgoing.end(request.body);
    });
}

/** What the running app offers to send a request with. */
export interface Platform {
  /** Obsidian mobile. It has no Node, so `requestUrl` is its only transport. */
  readonly isMobileApp: boolean;
  readonly clients: NodeClients | undefined;
  readonly requestUrl: Transport;
}

/** The transport of the platform: the Node client, and `requestUrl` where there is none. */
export function platformTransport(platform: Platform): Transport {
  return platform.clients === undefined ? platform.requestUrl : nodeTransport(platform.clients);
}

function answer(status: number, text: string): HttpResponse {
  // A redirect is not followed and its body is not read: the caller sees only the status.
  if (status >= 300 && status < 400) {
    return { status, body: null };
  }
  try {
    return { status, body: JSON.parse(text) as unknown };
  } catch {
    return { status, body: null };
  }
}
