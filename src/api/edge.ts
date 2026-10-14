import type { components } from './generated/schema';
import { EdgeError, type HttpRequest, type Transport } from './http';
import type {
  BatchCommitted,
  ChangeBatch,
  ConnectAccepted,
  ConnectRequest,
  Manifest,
  ManifestAnswer,
} from './notes';

type Schemas = components['schemas'];
export type PairDevice = Schemas['PairDevice'];
export type Paired = Schemas['Paired'];
export type OpenDeviceSession = Schemas['OpenDeviceSession'];
export type DeviceSessionOpened = Schemas['DeviceSessionOpened'];
export type RotatedCredentials = Schemas['RotatedCredentials'];
export type UploadSessionRequest = Schemas['UploadSessionRequest'];
export type UploadSessionOpened = Schemas['UploadSessionOpened'];
export type UploadChunkReceipt = Schemas['UploadChunkReceipt'];
export type UploadCompletionOutcome = Schemas['UploadCompletionOutcome'];

/** The device kind that Platform registers for this plugin (Platform ADR-0016). */
export const DEVICE_KIND = 'obsidian_plugin';

/** The session credential and the Edge origin that issued it. The request goes only there. */
export interface Auth {
  readonly credential: string;
  readonly origin: string;
}

/** A call for one connection with the session credential. */
export interface ConnectionCall<T> {
  readonly auth: Auth;
  readonly connectionId: string;
  readonly body: T;
}

/** One chunk of an upload session. */
export interface Chunk {
  readonly token: string;
  readonly index: number;
  readonly bytes: Uint8Array;
}

const connectionPath = (id: string): string => `/v1/notes/connections/${encodeURIComponent(id)}`;

/** The Edge routes that the plugin calls. Each method returns the 2xx body or throws `EdgeError`. */
export class EdgeClient {
  readonly #transport: Transport;

  constructor(transport: Transport) {
    this.#transport = transport;
  }

  pair(call: { origin: string; body: PairDevice }): Promise<Paired> {
    return this.#send({ path: '/v1/devices/pair', ...call });
  }

  openDeviceSession(call: { origin: string; body: OpenDeviceSession }): Promise<DeviceSessionOpened> {
    return this.#send({ path: '/v1/sessions/device', ...call });
  }

  refresh(call: { origin: string; refreshToken: string }): Promise<RotatedCredentials> {
    return this.#send({ path: '/v1/sessions/refresh', origin: call.origin, body: { refresh_token: call.refreshToken } });
  }

  connect(call: { auth: Auth; body: ConnectRequest }): Promise<ConnectAccepted> {
    return this.#send({ path: '/v1/notes/connections', ...call });
  }

  sendChanges(call: ConnectionCall<ChangeBatch>): Promise<BatchCommitted> {
    return this.#send({ path: `${connectionPath(call.connectionId)}/changes`, ...call });
  }

  sendManifest(call: ConnectionCall<Manifest>): Promise<ManifestAnswer> {
    return this.#send({ path: `${connectionPath(call.connectionId)}/manifest`, ...call });
  }

  openUpload(call: ConnectionCall<UploadSessionRequest>): Promise<UploadSessionOpened> {
    return this.#send({ path: `${connectionPath(call.connectionId)}/blobs`, ...call });
  }

  putChunk(call: ConnectionCall<Chunk>): Promise<UploadChunkReceipt> {
    const { token, index, bytes } = call.body;
    const path = `${connectionPath(call.connectionId)}/blobs/${encodeURIComponent(token)}/chunks/${index}`;
    return this.#send({ method: 'PUT', path, auth: call.auth, raw: bytes });
  }

  finalizeUpload(call: ConnectionCall<{ token: string }>): Promise<UploadCompletionOutcome> {
    const path = `${connectionPath(call.connectionId)}/blobs/${encodeURIComponent(call.body.token)}/finalize`;
    return this.#send({ path, auth: call.auth, body: { resumption_token: call.body.token } });
  }

  async #send<T>(request: {
    method?: 'POST' | 'PUT';
    path: string;
    origin?: string;
    auth?: Auth;
    body?: unknown;
    raw?: Uint8Array;
  }): Promise<T> {
    const http: HttpRequest = {
      origin: originOf(request),
      headers: headersOf(request),
      method: request.method ?? 'POST',
      path: request.path,
      body: request.raw ?? JSON.stringify(request.body),
    };
    const response = await this.#transport(http);
    if (response.status < 200 || response.status > 299) {
      throw new EdgeError(response);
    }
    return response.body as T;
  }
}

/** An authenticated request goes to the origin of its credential, never to another one. */
function originOf(request: { origin?: string; auth?: Auth }): string {
  return request.auth?.origin ?? request.origin ?? '';
}

function headersOf(request: { auth?: Auth; raw?: Uint8Array }): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': request.raw === undefined ? 'application/json' : 'application/octet-stream',
  };
  if (request.auth !== undefined) {
    headers['Authorization'] = `Bearer ${request.auth.credential}`;
  }
  return headers;
}
