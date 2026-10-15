import type { HttpRequest, HttpResponse, Transport } from '../../src/api/http';
import type { Change } from '../../src/core/types';

/** Values that no file of a test vault can contain by chance. */
export const PAIRED = {
  device_id: '0199a1b2-0000-7000-8000-00000000d001',
  user_id: '0199a1b2-0000-7000-8000-00000000a001',
  device_secret: 'dsec_7Qm2vX9pL4wR8tY1zK6nB3cF5hJ0aE',
  credential: 'cred_X3vN8qL1mP6sR9tW2yB5dF7hJ0kZ4c',
  expires_at: '2026-10-14T13:00:00Z',
  refresh_token: 'rft_M9bV2cX7nL4kJ1hG8fD5sA3pO6iU0y',
  refresh_expires_at: '2026-11-13T12:00:00Z',
} as const;

export const CONNECTION_ID = '0199a1b2-0000-7000-8000-0000000c0001';
export const UPLOAD_TOKEN = 'rst_0v8k4a2j9pm1d7n5tp3es6uabfhij1cm4nop5qrs';

/** The SHA-256 of no bytes. */
export const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

/** The size limit of a file in `ratatoskr-notes` when its configuration sets none. */
export const MAX_FILE_BYTES = 64 * 1024 * 1024;

/** Whether `ratatoskr-notes` needs the bytes of a file: `.obsidian` and `.trash` by first segment, in any case. */
function needsBytes(file: { path: string; sha256?: string; length_bytes?: number }): boolean {
  const first = file.path.split('/')[0]?.toLowerCase();
  return (
    file.sha256 !== undefined &&
    file.sha256 !== EMPTY_SHA256 &&
    (file.length_bytes ?? 0) <= MAX_FILE_BYTES &&
    first !== '.obsidian' &&
    first !== '.trash'
  );
}

/** The route template of a path: the ids in it become `{id}`, `{token}`, `{index}` and `{operation}`, and the query goes. */
export function routeOf(path: string): string {
  return path
    .replace(/\?.*$/, '')
    .replace(/^\/v1\/notes\/connections\/[^/]+/, '/v1/notes/connections/{id}')
    .replace(/\/blobs\/[^/]+/, '/blobs/{token}')
    .replace(/\/chunks\/[^/]+$/, '/chunks/{index}')
    .replace(/\/device-operations\/[^/]+/, '/device-operations/{operation}');
}

type Route = (request: HttpRequest, body: Record<string, unknown>) => HttpResponse;

/** An Edge stand-in. It records each request and answers from its routes. */
export class FakeEdge {
  readonly requests: HttpRequest[] = [];
  readonly routes = new Map<string, Route>();

  constructor() {
    this.routes.set('POST /v1/devices/pair', () => ({ status: 201, body: { ...PAIRED } }));
    this.routes.set('POST /v1/notes/connections', () => ({
      status: 202,
      body: { connection_id: CONNECTION_ID, channel: 'plugin', state: 'connecting' },
    }));
    this.routes.set('POST /v1/notes/connections/{id}/changes', (_request, body) => {
      const changes = body['changes'] as Change[];
      return { status: 200, body: { committed_sequence: changes.at(-1)?.sequence ?? 0 } };
    });
    this.routes.set('POST /v1/notes/connections/{id}/manifest', () => ({
      status: 200,
      body: { needed_sha256: [], committed_sequence: 0 },
    }));
    this.routes.set('POST /v1/notes/connections/{id}/blobs', (_request, body) => ({
      status: 201,
      body: { resumption_token: UPLOAD_TOKEN, chunk_size_bytes: body['chunk_size_bytes'], expires_at: '2026-10-14T13:00:00Z' },
    }));
    this.routes.set('PUT /v1/notes/connections/{id}/blobs/{token}/chunks/{index}', (request) => ({
      status: 200,
      body: { resumption_token: UPLOAD_TOKEN, chunk_index: Number(request.path.split('/').at(-1)), received_chunks_count: 1, idempotent_replay: false },
    }));
    this.routes.set('POST /v1/notes/connections/{id}/blobs/{token}/finalize', () => ({
      status: 200,
      body: { outcome: 'stored', blob_ref: {} },
    }));
  }

  /** Answers one route with a fixed response. */
  answer(route: string, response: HttpResponse): void {
    this.routes.set(route, () => response);
  }

  /**
   * Answers the batch and the manifest as `ratatoskr-notes` does: they name the hashes whose bytes
   * this connection did not upload. An empty file, a file over 64 MiB and a path under `.obsidian/`
   * or `.trash/` need no bytes (the README of `ratatoskr-notes`, "Device channels").
   */
  keepNotesBytes(): void {
    const stored = new Set<string>();
    let declared = '';
    const missing = (files: readonly { path: string; sha256?: string; length_bytes?: number }[]): string[] =>
      [...new Set(files.filter((file) => needsBytes(file) && !stored.has(file.sha256 ?? '')).map((file) => file.sha256 ?? ''))].sort();
    this.routes.set('POST /v1/notes/connections/{id}/blobs', (_request, body) => {
      declared = String((body['digest'] as { hex: string }).hex);
      return {
        status: 201,
        body: { resumption_token: UPLOAD_TOKEN, chunk_size_bytes: body['chunk_size_bytes'], expires_at: '2026-10-14T13:00:00Z' },
      };
    });
    this.routes.set('POST /v1/notes/connections/{id}/blobs/{token}/finalize', () => {
      stored.add(declared);
      return { status: 200, body: { outcome: 'stored', blob_ref: {} } };
    });
    this.routes.set('POST /v1/notes/connections/{id}/changes', (_request, body) => {
      const changes = body['changes'] as Change[];
      const hashes = missing(changes);
      if (hashes.length > 0) {
        return { status: 409, body: { code: 'notes.channel.bytes_missing', message: 'Upload the bytes first.', retryable: false, missing_sha256: hashes } };
      }
      return { status: 200, body: { committed_sequence: changes.at(-1)?.sequence ?? 0 } };
    });
    this.routes.set('POST /v1/notes/connections/{id}/manifest', (_request, body) => ({
      status: 200,
      body: { needed_sha256: missing(body['entries'] as { path: string; sha256: string; length_bytes: number }[]), committed_sequence: 0 },
    }));
  }

  readonly transport: Transport = async (request) => {
    this.requests.push(request);
    const route = this.routes.get(`${request.method} ${routeOf(request.path)}`);
    if (route === undefined) {
      return { status: 404, body: { code: 'edge.route_not_found', message: 'No route.', retryable: false } };
    }
    const body = typeof request.body === 'string' ? (JSON.parse(request.body) as Record<string, unknown>) : {};
    return route(request, body);
  };

  /** The change batches that reached Edge, in order. */
  get batches(): Change[][] {
    return this.requests
      .filter((request) => request.path.endsWith('/changes'))
      .map((request) => (JSON.parse(String(request.body)) as { changes: Change[] }).changes);
  }

  sent(path: string): HttpRequest[] {
    return this.requests.filter((request) => request.path === path);
  }

  /** The route of each request after the first `count`, in order: `POST /v1/...{id}/changes`. */
  routesAfter(count: number): string[] {
    return this.requests.slice(count).map((request) => `${request.method} ${routeOf(request.path)}`);
  }
}
