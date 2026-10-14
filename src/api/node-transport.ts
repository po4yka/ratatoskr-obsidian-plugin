import type { HttpResponse, Transport } from './http';

/**
 * The transport of the desktop app: one request to `origin` + `path`.
 *
 * Plain form: `fetch` follows a redirect, as Obsidian `requestUrl` does. OBS-023 task 11.14 replaces
 * it.
 */
export function nodeTransport(): Transport {
  return async (request): Promise<HttpResponse> => {
    const body = typeof request.body === 'string' || request.body === undefined ? request.body : request.body.slice();
    const response = await fetch(`${request.origin}${request.path}`, {
      method: request.method,
      headers: { ...request.headers },
      ...(body === undefined ? {} : { body }),
    });
    const text = await response.text();
    try {
      return { status: response.status, body: JSON.parse(text) as unknown };
    } catch {
      return { status: response.status, body: null };
    }
  };
}
