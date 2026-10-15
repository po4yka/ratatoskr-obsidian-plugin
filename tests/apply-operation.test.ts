import { afterEach, describe, expect, it } from 'vitest';
import type { HttpRequest } from '../src/api/http';
import { FakeEdge, routeOf } from './support/fake-edge';
import { FakeObsidian } from './support/fake-obsidian';
import { factsOf } from './support/fake-vault';
import { settle, startPlugin, type Running } from './support/plugin';

// Workspace change `add-notes-write-back` (OBS-024), design D5 and spec `notes-write-delivery`: the
// plugin reads the device queue of its connection, checks the base of each operation, applies it
// through the vault API of Obsidian, and reports the result. The wire shapes are those of
// `ratatoskr-notes` `services/notes/src/api/device_operations.rs`.

const QUEUE = 'GET /v1/notes/connections/{id}/device-operations';
const CONTENT = 'GET /v1/notes/connections/{id}/device-operations/{operation}/content';
const RESULT = 'POST /v1/notes/connections/{id}/device-operations/{operation}/result';

const FIRST = '0199a1b2-0000-7000-8000-0000000e0001';
const SECOND = '0199a1b2-0000-7000-8000-0000000e0002';

interface Page {
  readonly after: string | null;
  readonly next_cursor: string;
  readonly operations: readonly Record<string, unknown>[];
}

let running: Running | undefined;

afterEach(() => {
  running?.vault.remove();
  running = undefined;
});

const sha = (text: string): string => factsOf(text).sha256;
const operationOf = (path: string): string => path.split('/device-operations/')[1]?.split('/')[0] ?? '';
const afterOf = (request: HttpRequest): string | null => new URL(request.path, 'https://edge.example').searchParams.get('after');

/** The notes-owned `BlobRef` of a text. */
function blobRef(text: string): Record<string, unknown> {
  const facts = factsOf(text);
  return { owner_service: 'ratatoskr-notes', digest: { algorithm: 'sha256', hex: facts.sha256 }, media_type: 'text/markdown', length_bytes: facts.length };
}

/** One operation of the device queue, with the fields that `ratatoskr-notes` lists for it. */
function operation(fields: { operation_id: string; kind: string; path: string } & Record<string, unknown>): Record<string, unknown> {
  return { cursor: '1', target_path: null, base_hash: null, content: null, property_key: null, property_change: null, expected_sha256: null, ...fields };
}

/**
 * Answers the device queue as `ratatoskr-notes` does: the page after the cursor that the request
 * sends back, the bytes of an operation, and `200` to a result. An operation leaves the queue when
 * its result arrives.
 */
function serveQueue(edge: FakeEdge, queue: { pages: readonly Page[]; contents?: Record<string, string> }): void {
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

/** A paired and connected plugin over the fake vault API, whose vault events reach the core. */
async function start(files: Record<string, string>, queue: { pages: readonly Page[]; contents?: Record<string, string> }) {
  const edge = new FakeEdge();
  serveQueue(edge, queue);
  const obsidian = new FakeObsidian(files);
  const plugin = await startPlugin(edge, { reader: () => obsidian, app: obsidian });
  running = plugin;
  obsidian.onEvent = (event) => void plugin.core.accept(event);
  return { edge, obsidian, core: plugin.core };
}

/** The results that reached Edge, in order. */
function results(edge: FakeEdge): { operation: string; body: unknown }[] {
  return edge.requests
    .filter((request) => `${request.method} ${routeOf(request.path)}` === RESULT)
    .map((request) => ({ operation: operationOf(request.path), body: JSON.parse(String(request.body)) as unknown }));
}

describe('the plugin applies the writes of Ratatoskr', () => {
  it('base mismatch is reported, not applied', async () => {
    const update = operation({
      operation_id: FIRST,
      kind: 'update',
      path: 'Notes/Plan.md',
      base_hash: sha('seen by ratatoskr\n'),
      content: blobRef('from ratatoskr\n'),
      expected_sha256: sha('from ratatoskr\n'),
    });
    const { edge, obsidian, core } = await start(
      { 'Notes/Plan.md': 'local edit\n' },
      { pages: [{ after: null, next_cursor: '1', operations: [update] }], contents: { [FIRST]: 'from ratatoskr\n' } },
    );

    await settle(core.flush(1_000));
    await settle(core.flush(2_000));

    expect(obsidian.files.get('Notes/Plan.md')).toBe('local edit\n');
    expect(obsidian.calls).toEqual([]);
    expect(results(edge)).toEqual([{ operation: FIRST, body: { outcome: 'base_mismatch', local_sha256: sha('local edit\n') } }]);
    expect(edge.batches.flat()).toContainEqual(expect.objectContaining({ kind: 'updated', path: 'Notes/Plan.md', sha256: sha('local edit\n') }));
  });

  it('rename uses fileManager.renameFile', async () => {
    const rename = operation({
      operation_id: FIRST,
      kind: 'rename',
      path: 'Projects/Alpha.md',
      target_path: 'Projects/Apollo.md',
      base_hash: sha('# Alpha\n'),
      expected_sha256: sha('# Alpha\n'),
    });
    const { edge, obsidian, core } = await start(
      { 'Projects/Alpha.md': '# Alpha\n', 'Daily/Today.md': 'See [[Alpha]].\n' },
      { pages: [{ after: null, next_cursor: '1', operations: [rename] }] },
    );

    await settle(core.flush(1_000));
    await settle(core.flush(2_000));

    expect(obsidian.calls).toEqual(['renameFile Projects/Alpha.md Projects/Apollo.md']);
    expect(results(edge)).toEqual([{ operation: FIRST, body: { outcome: 'applied', sha256: sha('# Alpha\n') } }]);
    // The files whose links Obsidian rewrote reach notes through the change channel.
    expect(edge.batches.flat()).toEqual([
      expect.objectContaining({ kind: 'renamed', path: 'Projects/Apollo.md', previous_path: 'Projects/Alpha.md', sha256: sha('# Alpha\n') }),
      expect.objectContaining({ kind: 'updated', path: 'Daily/Today.md', sha256: sha('See [[Apollo]].\n') }),
    ]);
  });

  it('operations apply in queue order', async () => {
    const rename = operation({
      operation_id: FIRST,
      cursor: '7',
      kind: 'rename',
      path: 'A.md',
      target_path: 'B.md',
      base_hash: sha('alpha\n'),
      expected_sha256: sha('alpha\n'),
    });
    const update = operation({
      operation_id: SECOND,
      cursor: '9',
      kind: 'update',
      path: 'B.md',
      base_hash: sha('alpha\n'),
      content: blobRef('beta\n'),
      expected_sha256: sha('beta\n'),
    });
    const pages = [
      { after: null, next_cursor: '7', operations: [rename] },
      { after: '7', next_cursor: '9', operations: [update] },
    ];
    const { edge, obsidian, core } = await start({ 'A.md': 'alpha\n' }, { pages, contents: { [SECOND]: 'beta\n' } });
    const before = edge.requests.length;

    await settle(core.flush(1_000));

    expect(obsidian.calls).toEqual(['renameFile A.md B.md', 'modifyBinary B.md']);
    expect(obsidian.files.get('B.md')).toBe('beta\n');
    expect(edge.routesAfter(before)).toEqual([QUEUE, RESULT, QUEUE, CONTENT, RESULT, QUEUE]);
    // The cursor goes back exactly as notes sent it.
    expect(edge.requests.filter((request) => `${request.method} ${routeOf(request.path)}` === QUEUE).map(afterOf)).toEqual([null, '7', '9']);
    expect(results(edge)).toEqual([
      { operation: FIRST, body: { outcome: 'applied', sha256: sha('alpha\n') } },
      { operation: SECOND, body: { outcome: 'applied', sha256: sha('beta\n') } },
    ]);
  });
});
