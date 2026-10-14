import type * as Http from 'node:http';
import type { HttpResponse, Transport } from './http';

/** The Node clients that the desktop app has. A phone or a tablet has none. */
export interface NodeClients {
  readonly http: Pick<typeof Http, 'request'>;
  readonly https: Pick<typeof Http, 'request'>;
}

/** The limits of one request: the size of the answer body, the total time, and the time of silence. */
export interface TransportLimits {
  readonly maxBodyBytes: number;
  readonly deadlineMs: number;
  readonly idleMs: number;
}

const MIB = 1024 * 1024;

export const TRANSPORT_LIMITS: TransportLimits = { maxBodyBytes: 8 * MIB, deadlineMs: 60_000, idleMs: 30_000 };

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
export function nodeTransport(clients: NodeClients | undefined = nodeClients(), limits: TransportLimits = TRANSPORT_LIMITS): Transport {
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
        let size = 0;
        incoming.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > limits.maxBodyBytes) {
            fail(new Error(`the answer of Edge is larger than ${limits.maxBodyBytes / MIB} MiB`));
            return;
          }
          chunks.push(chunk);
        });
        incoming.on('error', fail);
        incoming.on('end', () => {
          clearTimeout(deadline);
          resolve(answer(incoming.statusCode ?? 0, Buffer.concat(chunks).toString('utf8')));
        });
      });
      // The idle timeout stops a silent Edge; the deadline also stops one that sends a byte at a time.
      const deadline = setTimeout(() => fail(new Error('Edge did not answer in time')), limits.deadlineMs);
      function fail(error: Error): void {
        clearTimeout(deadline);
        reject(error);
        outgoing.destroy();
      }
      outgoing.setTimeout(limits.idleMs, () => fail(new Error('Edge did not answer in time')));
      outgoing.on('error', fail);
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

/**
 * The transport of the platform, or `null` when the app cannot send safely.
 *
 * Obsidian mobile uses `requestUrl`, which follows a redirect and does not report where. A desktop app
 * uses the Node client, which follows no redirect. A desktop app without `process.getBuiltinModule`
 * (Node older than 20.16) gets no transport: it does not fall back to `requestUrl` or `window.require`.
 */
export function platformTransport(platform: Platform): Transport | null {
  if (platform.isMobileApp) {
    return platform.requestUrl;
  }
  return platform.clients === undefined ? null : nodeTransport(platform.clients);
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
