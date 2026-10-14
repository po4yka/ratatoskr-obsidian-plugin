import type { components } from './generated/schema';
import { EdgeError, type HttpRequest, type Transport } from './http';
import type { BatchCommitted, ChangeBatch, ConnectAccepted, ConnectRequest } from './notes';

type Schemas = components['schemas'];
export type PairDevice = Schemas['PairDevice'];
export type Paired = Schemas['Paired'];

/** The device kind that Platform registers for this plugin (Platform ADR-0016). */
export const DEVICE_KIND = 'obsidian_plugin';

interface Authorized<T> {
  readonly credential: string;
  readonly body: T;
}

/** The Edge routes that the plugin calls. Each method returns the 2xx body or throws `EdgeError`. */
export class EdgeClient {
  readonly #transport: Transport;

  constructor(transport: Transport) {
    this.#transport = transport;
  }

  pair(body: PairDevice): Promise<Paired> {
    return this.#json<Paired>({ path: '/v1/devices/pair', body });
  }

  connect(request: Authorized<ConnectRequest>): Promise<ConnectAccepted> {
    return this.#json<ConnectAccepted>({ path: '/v1/notes/connections', ...request });
  }

  sendChanges(request: Authorized<ChangeBatch> & { readonly connectionId: string }): Promise<BatchCommitted> {
    const path = `/v1/notes/connections/${encodeURIComponent(request.connectionId)}/changes`;
    return this.#json<BatchCommitted>({ path, credential: request.credential, body: request.body });
  }

  async #json<T>(request: { path: string; body: unknown; credential?: string }): Promise<T> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (request.credential !== undefined) {
      headers['Authorization'] = `Bearer ${request.credential}`;
    }
    const http: HttpRequest = { method: 'POST', path: request.path, headers, body: JSON.stringify(request.body) };
    const response = await this.#transport(http);
    if (response.status < 200 || response.status > 299) {
      throw new EdgeError(response);
    }
    return response.body as T;
  }
}
