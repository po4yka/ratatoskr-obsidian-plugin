import type { components } from './generated/schema';

export type ErrorEnvelope = components['schemas']['ErrorEnvelope'];

/** One request to Edge. `path` starts with `/v1/`; the transport adds the Edge address. */
export interface HttpRequest {
  readonly method: 'POST' | 'PUT';
  readonly path: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: string | Uint8Array;
}

/** The answer. `body` is the parsed JSON, or `null` when the answer has no JSON body. */
export interface HttpResponse {
  readonly status: number;
  readonly body: unknown;
}

/** The plugin uses Obsidian `requestUrl`; the tests use a fake Edge. */
export type Transport = (request: HttpRequest) => Promise<HttpResponse>;

/** An answer outside 2xx, with the contract error envelope when Edge sent one. */
export class EdgeError extends Error {
  readonly status: number;
  readonly envelope: Partial<ErrorEnvelope> & Record<string, unknown>;

  constructor(response: HttpResponse) {
    const envelope = isObject(response.body) ? response.body : {};
    super(`Edge answered ${response.status} ${String(envelope['code'] ?? '')}`.trim());
    this.name = 'EdgeError';
    this.status = response.status;
    this.envelope = envelope;
  }

  get code(): string | undefined {
    return typeof this.envelope.code === 'string' ? this.envelope.code : undefined;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
