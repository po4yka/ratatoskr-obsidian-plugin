import type { components } from './generated/schema';
import { EdgeError, type HttpRequest, type HttpResponse, type Transport } from './http';
import type {
  BatchCommitted,
  ChangeBatch,
  ConnectAccepted,
  ConnectRequest,
  DeviceOperationPage,
  DeviceResult,
  DeviceResultAnswer,
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
const operationPath = (call: { connectionId: string; operationId: string }): string =>
  `${connectionPath(call.connectionId)}/device-operations/${encodeURIComponent(call.operationId)}`;

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

  /** The operations of the device queue after `after` (from the start when `null`). */
  listOperations(call: ConnectionCall<{ after: string | null }>): Promise<DeviceOperationPage> {
    const query = call.body.after === null ? '' : `?after=${encodeURIComponent(call.body.after)}`;
    return this.#send({ method: 'GET', path: `${connectionPath(call.connectionId)}/device-operations${query}`, auth: call.auth });
  }

  /** The bytes that an operation puts in the vault. */
  async readOperationContent(call: ConnectionCall<{ operationId: string }>): Promise<Uint8Array> {
    const path = `${operationPath({ connectionId: call.connectionId, operationId: call.body.operationId })}/content`;
    const response = await this.#exchange({ method: 'GET', path, auth: call.auth, answer: 'bytes' });
    if (response.bytes === undefined) {
      throw new Error('Edge answered the content of an operation without bytes');
    }
    return response.bytes;
  }

  sendOperationResult(call: ConnectionCall<{ operationId: string; result: DeviceResult }>): Promise<DeviceResultAnswer> {
    const path = `${operationPath({ connectionId: call.connectionId, operationId: call.body.operationId })}/result`;
    return this.#send({ path, auth: call.auth, body: call.body.result });
  }

  async #send<T>(request: EdgeRequest): Promise<T> {
    return (await this.#exchange(request)).body as T;
  }

  async #exchange(request: EdgeRequest): Promise<HttpResponse> {
    const http: HttpRequest = {
      origin: originOf(request),
      headers: headersOf(request),
      method: request.method ?? 'POST',
      path: request.path,
      body: request.raw ?? JSON.stringify(request.body),
      ...(request.answer === undefined ? {} : { answer: request.answer }),
    };
    const response = await this.#transport(http);
    if (response.status < 200 || response.status > 299) {
      throw new EdgeError(response);
    }
    return response;
  }
}

/** One call of the client, before the transport shape. A request without `method` is a `POST`. */
interface EdgeRequest {
  readonly method?: HttpRequest['method'];
  readonly path: string;
  readonly origin?: string;
  readonly auth?: Auth;
  readonly body?: unknown;
  readonly raw?: Uint8Array;
  readonly answer?: 'bytes';
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
