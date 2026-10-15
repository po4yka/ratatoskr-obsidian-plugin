import { afterEach, describe, expect, it } from 'vitest';
import type { HttpResponse } from '../src/api/http';
import { FIRST, QUEUE, RESULT, UNAVAILABLE, answerResultsInTurn, blobRef, onePage, operation, removeVaults, results, sha, startWithQueue } from './support/device-queue';
import { FakeEdge } from './support/fake-edge';
import { settle } from './support/plugin';

// Workspace change `add-notes-write-back` (OBS-024), task 11.20: a device sends a result again until
// notes answers `200`. Notes records nothing for a `5xx`, and it settles the rest of a group on a
// retry (`services/notes/src/api/device_operations.rs` at 7cdb2a2), so the plugin keeps the result
// of a write that it applied and sends that result again, instead of applying the write again.

afterEach(removeVaults);

const FAILURES: readonly (readonly [string, () => HttpResponse])[] = [
  ['a 503', () => ({ status: 503, body: { code: 'notes.service.unavailable', message: 'Try again.', retryable: true } })],
  [
    'a network error',
    () => {
      throw new Error('the connection was reset');
    },
  ],
];

describe('a result that does not reach notes', () => {
  it.each(FAILURES)('after %s the same result is sent again at the next pass, and the write is not applied again', async (_name, failure) => {
    const edge = new FakeEdge();
    const remove = operation({ operation_id: FIRST, kind: 'delete', path: 'Notes/Old.md', base_hash: sha('old\n') });
    const { obsidian, core } = await startWithQueue(edge, { files: { 'Notes/Old.md': 'old\n' }, queue: { pages: onePage(remove) } });
    const route = edge.routes.get(RESULT);
    let failed = false;
    edge.routes.set(RESULT, (request, body) => {
      if (!failed) {
        failed = true;
        return failure();
      }
      return route?.(request, body) ?? { status: 500, body: null };
    });

    await settle(core.flush(1_000));
    await settle(core.flush(10_000));

    expect(obsidian.calls).toEqual(['trash Notes/Old.md system=true']);
    expect(results(edge).map((result) => result.body)).toEqual([{ outcome: 'applied' }, { outcome: 'applied' }]);
  });
});

describe('a kept result', () => {
  it('survives a restart of the plugin and is sent again, not applied again', async () => {
    const edge = new FakeEdge();
    const remove = operation({ operation_id: FIRST, kind: 'delete', path: 'Notes/Old.md', base_hash: sha('old\n') });
    const { obsidian, core, reopen } = await startWithQueue(edge, { files: { 'Notes/Old.md': 'old\n' }, queue: { pages: onePage(remove) } });
    answerResultsInTurn(edge, UNAVAILABLE);

    await settle(core.flush(1_000));
    const restarted = await reopen();
    await settle(restarted.flush(10_000));

    expect(obsidian.calls).toEqual(['trash Notes/Old.md system=true']);
    expect(results(edge).map((result) => result.body)).toEqual([{ outcome: 'applied' }, { outcome: 'applied' }]);
  });

  it('of a rename group is sent again with its rewrites, and nothing is looked up again', async () => {
    const edge = new FakeEdge();
    const rename = operation({
      operation_id: FIRST,
      kind: 'rename',
      path: 'A.md',
      target_path: 'B.md',
      base_hash: sha('# A\n'),
      expected_sha256: sha('# A\n'),
      rewrites: [{ path: 'Daily/Today.md', base_hash: sha('See [[A]].\n'), expected_sha256: sha('See [[B]].\n') }],
    });
    const files = { 'A.md': '# A\n', 'Daily/Today.md': 'See [[A]].\n' };
    const { obsidian, core } = await startWithQueue(edge, { files, queue: { pages: onePage(rename) } });
    answerResultsInTurn(edge, UNAVAILABLE);

    await settle(core.flush(1_000));
    obsidian.lookups.length = 0;
    await settle(core.flush(10_000));

    const applied = { outcome: 'applied', sha256: sha('# A\n'), rewrites: [{ path: 'Daily/Today.md', outcome: 'applied', sha256: sha('See [[B]].\n') }] };
    expect(obsidian.calls).toEqual(['renameFile A.md B.md']);
    expect(obsidian.lookups).toEqual([]);
    expect(results(edge).map((result) => result.body)).toEqual([applied, applied]);
  });
});

describe('a kept result that notes can never accept', () => {
  it('is dropped after a 400, and the operation is checked again at the next pass', async () => {
    const edge = new FakeEdge();
    const remove = operation({ operation_id: FIRST, kind: 'delete', path: 'Notes/Old.md', base_hash: sha('old\n') });
    const { core } = await startWithQueue(edge, { files: { 'Notes/Old.md': 'old\n' }, queue: { pages: onePage(remove) } });
    answerResultsInTurn(edge, UNAVAILABLE, () => ({ status: 400, body: { code: 'notes.request.invalid', message: 'The request is invalid.', retryable: false } }));

    for (const now of [1_000, 10_000, 20_000]) {
      await settle(core.flush(now));
    }

    expect(results(edge).map((result) => result.body)).toEqual([{ outcome: 'applied' }, { outcome: 'applied' }, { outcome: 'base_mismatch', local_sha256: null }]);
  });

  it('is dropped when the bytes that notes names changed since, and the operation is checked again', async () => {
    const edge = new FakeEdge();
    const update = operation({ operation_id: FIRST, kind: 'update', path: 'A.md', base_hash: sha('alpha\n'), content: blobRef('beta\n'), expected_sha256: sha('beta\n') });
    const { obsidian, core } = await startWithQueue(edge, { files: { 'A.md': 'alpha\n' }, queue: { pages: onePage(update), contents: { [FIRST]: 'beta\n' } } });
    const missing = { code: 'notes.channel.bytes_missing', message: 'Upload the bytes first.', retryable: false, missing_sha256: [sha('beta\n')] };
    answerResultsInTurn(edge, UNAVAILABLE, () => ({ status: 409, body: missing }));

    await settle(core.flush(1_000));
    obsidian.files.set('A.md', 'gamma\n');
    await settle(core.flush(10_000));
    await settle(core.flush(20_000));

    const applied = { outcome: 'applied', sha256: sha('beta\n') };
    expect(results(edge).map((result) => result.body)).toEqual([applied, applied, { outcome: 'base_mismatch', local_sha256: sha('gamma\n') }]);
  });

  it('is dropped when a full pass no longer lists its operation', async () => {
    const edge = new FakeEdge();
    const remove = operation({ operation_id: FIRST, kind: 'delete', path: 'Notes/Old.md', base_hash: sha('old\n') });
    const { core } = await startWithQueue(edge, { files: { 'Notes/Old.md': 'old\n' }, queue: { pages: onePage(remove) } });
    answerResultsInTurn(edge, UNAVAILABLE);
    const listed = edge.routes.get(QUEUE);
    let hidden = false;
    edge.routes.set(QUEUE, (request, body) => (hidden ? { status: 200, body: { operations: [], next_cursor: '0' } } : (listed?.(request, body) ?? { status: 500, body: null })));

    await settle(core.flush(1_000));
    hidden = true;
    await settle(core.flush(10_000));
    hidden = false;
    await settle(core.flush(20_000));

    expect(results(edge).map((result) => result.body)).toEqual([{ outcome: 'applied' }, { outcome: 'base_mismatch', local_sha256: null }]);
  });
});
