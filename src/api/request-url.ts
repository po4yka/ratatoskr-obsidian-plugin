import { edgeOrigin } from '../core/edge-address';
import type { HttpResponse, Transport } from './http';

/** The part of Obsidian `requestUrl` that the transport uses. `src/main.ts` gives the real one. */
export type RequestUrl = (param: {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string | ArrayBuffer;
  throw: boolean;
}) => Promise<{ readonly status: number; readonly text: string; readonly arrayBuffer: ArrayBuffer; readonly headers: Record<string, string> }>;

/**
 * The transport of Obsidian mobile, which has no Node. `requestUrl` follows a redirect and does not
 * report where: see the README for this limit. Each request goes to its own origin, which the core
 * sets; it never reads the settings.
 */
export function requestUrlTransport(requestUrl: RequestUrl): Transport {
  return async (request): Promise<HttpResponse> => {
    const origin = edgeOrigin(request.origin);
    const body = typeof request.body === 'string' || request.body === undefined ? request.body : request.body.slice().buffer;
    const response = await requestUrl({ url: `${origin}${request.path}`, method: request.method, headers: { ...request.headers }, ...(body === undefined ? {} : { body }), throw: false });
    if (request.answer === 'bytes' && response.status >= 200 && response.status < 300) {
      return { status: response.status, body: null, bytes: new Uint8Array(response.arrayBuffer) };
    }
    return { status: response.status, body: parseJson(response.text) };
  };
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}
