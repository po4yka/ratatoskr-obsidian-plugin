import { afterEach, describe, expect, it } from 'vitest';
import type { HttpResponse } from '../src/api/http';
import { FIRST, RESULT, onePage, operation, removeVaults, results, sha, startWithQueue } from './support/device-queue';
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
