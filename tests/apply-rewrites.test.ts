import { afterEach, describe, expect, it } from 'vitest';
import { FIRST, QUEUE, RESULT, UPLOAD, bytesMissingOnce, onePage, operation, removeVaults, results, sha, startWithQueue } from './support/device-queue';
import { FakeEdge } from './support/fake-edge';
import { settle } from './support/plugin';

// Workspace change `add-notes-write-back` (OBS-024), task 11.18: notes delivers a rename with the
// link rewrites of its group (`services/notes/src/api/device_operations.rs`, `writes/group.rs`).
// The rename lists each linking note in `rewrites`, and the `applied` result names what the device
// did with each one. A linking note that the result does not name counts as not applied.

afterEach(removeVaults);

const FILES = { 'A.md': '# A\n', 'Daily/Today.md': 'See [[A]].\n', 'Other/Ref.md': 'Also [[A]].\n' };

/** A rename of `A.md` to `B.md` whose links notes rewrites in the two linking notes. */
function renameWithRewrites(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return operation({
    operation_id: FIRST,
    kind: 'rename',
    path: 'A.md',
    target_path: 'B.md',
    base_hash: sha('# A\n'),
    expected_sha256: sha('# A\n'),
    rewrites: [
      { path: 'Daily/Today.md', base_hash: sha('See [[A]].\n'), expected_sha256: sha('See [[B]].\n') },
      { path: 'Other/Ref.md', base_hash: sha('Also [[A]].\n'), expected_sha256: sha('Also [[B]].\n') },
    ],
    ...overrides,
  });
}

/** One flush against a queue that holds `rename`, in a vault with `files`. */
async function applyRename(setup: { files: Record<string, string>; rename: Record<string, unknown>; missing?: string[] }) {
  const edge = new FakeEdge();
  const { obsidian, core } = await startWithQueue(edge, { files: setup.files, queue: { pages: onePage(setup.rename) } });
  if (setup.missing !== undefined) {
    bytesMissingOnce(edge, setup.missing);
  }
  obsidian.lookups.length = 0;
  const before = edge.requests.length;
  await settle(core.flush(1_000));
  return { edge, obsidian, core, routes: edge.routesAfter(before) };
}

describe('a rename with the link rewrites of its group', () => {
  it('a rename reports the hash of each linking note in rewrites', async () => {
    const { edge, obsidian, routes } = await applyRename({ files: FILES, rename: renameWithRewrites() });

    expect(obsidian.calls).toEqual(['renameFile A.md B.md']);
    expect(routes).toEqual([QUEUE, RESULT, QUEUE]);
    expect(results(edge)).toEqual([
      {
        operation: FIRST,
        body: {
          outcome: 'applied',
          sha256: sha('# A\n'),
          rewrites: [
            { path: 'Daily/Today.md', outcome: 'applied', sha256: sha('See [[B]].\n') },
            { path: 'Other/Ref.md', outcome: 'applied', sha256: sha('Also [[B]].\n') },
          ],
        },
      },
    ]);
  });

  it('a linking note with another base refuses the group before the rename', async () => {
    const files = { ...FILES, 'Daily/Today.md': 'See [[A]], edited here.\n' };

    const { edge, obsidian, core } = await applyRename({ files, rename: renameWithRewrites() });
    await settle(core.flush(2_000));

    expect(obsidian.calls).toEqual([]);
    expect(results(edge)).toEqual([{ operation: FIRST, body: { outcome: 'base_mismatch', local_sha256: sha('# A\n') } }]);
    // The newer local note reaches notes, which raises the conflict.
    expect(edge.batches.flat()).toContainEqual(expect.objectContaining({ kind: 'updated', path: 'Daily/Today.md', sha256: sha('See [[A]], edited here.\n') }));
  });

  it('a linking note that Obsidian wrote another way is uploaded before the result', async () => {
    const rewrites = [
      { path: 'Daily/Today.md', base_hash: sha('See [[A]].\n'), expected_sha256: sha('See [[B|A]].\n') },
      { path: 'Other/Ref.md', base_hash: sha('Also [[A]].\n'), expected_sha256: sha('Also [[B]].\n') },
    ];

    const { edge, routes } = await applyRename({ files: FILES, rename: renameWithRewrites({ rewrites }) });

    expect(routes).toEqual([QUEUE, ...UPLOAD, RESULT, QUEUE]);
    expect(Buffer.from(edge.requests.find((request) => request.method === 'PUT')?.body ?? new Uint8Array()).toString('utf8')).toBe('See [[B]].\n');
    expect(results(edge)[0]?.body).toMatchObject({ rewrites: [{ path: 'Daily/Today.md', outcome: 'applied', sha256: sha('See [[B]].\n') }, expect.anything()] });
  });

  it('a linking note that bytes_missing names is uploaded from its own path', async () => {
    const { edge, routes } = await applyRename({ files: FILES, rename: renameWithRewrites(), missing: [sha('Also [[B]].\n')] });

    expect(routes).toEqual([QUEUE, RESULT, ...UPLOAD, RESULT, QUEUE]);
    expect(Buffer.from(edge.requests.find((request) => request.method === 'PUT')?.body ?? new Uint8Array()).toString('utf8')).toBe('Also [[B]].\n');
  });

  it('an unsafe rewrite path refuses the group before the vault is touched', async () => {
    const rewrites = [{ path: '.obsidian/workspace.json', base_hash: sha('{}'), expected_sha256: sha('{}') }];

    const { edge, obsidian } = await applyRename({ files: FILES, rename: renameWithRewrites({ rewrites }) });

    expect(obsidian.lookups).toEqual([]);
    expect(obsidian.calls).toEqual([]);
    expect(results(edge)).toEqual([{ operation: FIRST, body: { outcome: 'failed', code: 'notes.write.unsafe_path' } }]);
  });
});
