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

/** The route template of a path: the ids in it become `{id}`, `{token}` and `{index}`. */
export function routeOf(path: string): string {
  return path
    .replace(/^\/v1\/notes\/connections\/[^/]+/, '/v1/notes/connections/{id}')
    .replace(/\/blobs\/[^/]+/, '/blobs/{token}')
    .replace(/\/chunks\/[^/]+$/, '/chunks/{index}');
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
