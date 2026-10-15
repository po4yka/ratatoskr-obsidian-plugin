import type { HttpRequest, HttpResponse } from '../../src/api/http';
import { routeOf, type FakeEdge } from './fake-edge';
import { FakeObsidian } from './fake-obsidian';
import { factsOf } from './fake-vault';
import { startPlugin, type Running } from './plugin';

// The device queue of `ratatoskr-notes` (`services/notes/src/api/device_operations.rs`), as the
// tests of the write-back answer it (workspace change `add-notes-write-back`, design D5).

export const QUEUE = 'GET /v1/notes/connections/{id}/device-operations';
export const CONTENT = 'GET /v1/notes/connections/{id}/device-operations/{operation}/content';
export const RESULT = 'POST /v1/notes/connections/{id}/device-operations/{operation}/result';
export const UPLOAD = [
  'POST /v1/notes/connections/{id}/blobs',
  'PUT /v1/notes/connections/{id}/blobs/{token}/chunks/{index}',
  'POST /v1/notes/connections/{id}/blobs/{token}/finalize',
];

export const FIRST = '0199a1b2-0000-7000-8000-0000000e0001';
export const SECOND = '0199a1b2-0000-7000-8000-0000000e0002';

export interface Page {
  readonly after: string | null;
  readonly next_cursor: string;
  readonly operations: readonly Record<string, unknown>[];
}

export interface Queue {
  readonly pages: readonly Page[];
  /** The bytes that the content route streams, by operation id. */
  readonly contents?: Record<string, string>;
}

export const sha = (text: string): string => factsOf(text).sha256;
export const operationOf = (path: string): string => path.split('/device-operations/')[1]?.split('/')[0] ?? '';
export const afterOf = (request: HttpRequest): string | null => new URL(request.path, 'https://edge.example').searchParams.get('after');
const routeOfRequest = (request: HttpRequest): string => `${request.method} ${routeOf(request.path)}`;

/** The notes-owned `BlobRef` of a text. */
export function blobRef(text: string, mediaType = 'text/markdown'): Record<string, unknown> {
  const facts = factsOf(text);
  return { owner_service: 'ratatoskr-notes', digest: { algorithm: 'sha256', hex: facts.sha256 }, media_type: mediaType, length_bytes: facts.length };
}

/** One operation of the device queue, with the fields that `ratatoskr-notes` lists for it. */
export function operation(fields: { operation_id: string; kind: string; path: string } & Record<string, unknown>): Record<string, unknown> {
  return { cursor: '1', target_path: null, base_hash: null, content: null, property_key: null, property_change: null, expected_sha256: null, ...fields };
}

/** A queue of one page that holds `operations`. */
export function onePage(...operations: Record<string, unknown>[]): readonly Page[] {
  return [{ after: null, next_cursor: '1', operations }];
}

/**
 * Answers the device queue as `ratatoskr-notes` does: the page after the cursor that the request
 * sends back, the bytes of an operation, and `200` to a result. An operation leaves the queue when
 * its result arrives.
 */
export function serveQueue(edge: FakeEdge, queue: Queue): void {
  const ended = new Set<string>();
  edge.routes.set(QUEUE, (request) => {
    const page = queue.pages.find((candidate) => candidate.after === afterOf(request));
    const operations = page?.operations.filter((listed) => !ended.has(String(listed['operation_id']))) ?? [];
    return { status: 200, body: { operations, next_cursor: page?.next_cursor ?? afterOf(request) ?? '0' } };
  });
  edge.routes.set(CONTENT, (request) => ({ status: 200, body: null, bytes: Buffer.from(queue.contents?.[operationOf(request.path)] ?? '', 'utf8') }));
  edge.routes.set(RESULT, (request) => {
    ended.add(operationOf(request.path));
    return { status: 200, body: { operation_id: operationOf(request.path), state: 'succeeded' } };
  });
}

/** Answers the first result with `409` `notes.channel.bytes_missing` for `missing`, and the next ones as before. */
export function bytesMissingOnce(edge: FakeEdge, missing: readonly string[]): void {
  const route = edge.routes.get(RESULT);
  let answered = false;
  edge.routes.set(RESULT, (request, body): HttpResponse => {
    if (answered || route === undefined) {
      return route?.(request, body) ?? { status: 500, body: null };
    }
    answered = true;
    return { status: 409, body: { code: 'notes.channel.bytes_missing', message: 'Upload the bytes first.', retryable: false, missing_sha256: missing } };
  });
}

const started: Running[] = [];

/** Removes the test vaults of the plugins that `startWithQueue` started. */
export function removeVaults(): void {
  for (const running of started.splice(0)) {
    running.vault.remove();
  }
}

/** A paired and connected plugin over the fake vault API, whose vault events reach the core. */
export async function startWithQueue(edge: FakeEdge, setup: { files: Record<string, string>; queue: Queue }) {
  serveQueue(edge, setup.queue);
  const obsidian = new FakeObsidian(setup.files);
  const plugin = await startPlugin(edge, { reader: () => obsidian, app: obsidian });
  started.push(plugin);
  obsidian.onEvent = (event) => void plugin.core.accept(event);
  return { obsidian, core: plugin.core };
}

/** The results that reached Edge, in order. */
export function results(edge: FakeEdge): { operation: string; body: unknown }[] {
  return edge.requests
    .filter((request) => routeOfRequest(request) === RESULT)
    .map((request) => ({ operation: operationOf(request.path), body: JSON.parse(String(request.body)) as unknown }));
}

/** The cursors that the reads of the queue sent, in order. */
export function queueReads(edge: FakeEdge): (string | null)[] {
  return edge.requests.filter((request) => routeOfRequest(request) === QUEUE).map(afterOf);
}
