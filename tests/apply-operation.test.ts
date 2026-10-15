import { afterEach, describe, expect, it } from 'vitest';
import {
  CONTENT,
  FIRST,
  QUEUE,
  RESULT,
  SECOND,
  blobRef,
  onePage,
  operation,
  queueReads,
  removeVaults,
  results,
  sha,
  startWithQueue,
} from './support/device-queue';
import { FakeEdge } from './support/fake-edge';
import { settle } from './support/plugin';

// Workspace change `add-notes-write-back` (OBS-024), design D5 and spec `notes-write-delivery`: the
// plugin reads the device queue of its connection, checks the base of each operation, applies it
// through the vault API of Obsidian, and reports the result. The wire shapes are those of
// `ratatoskr-notes` `services/notes/src/api/device_operations.rs`.

afterEach(removeVaults);

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
    const edge = new FakeEdge();
    const { obsidian, core } = await startWithQueue(edge, {
      files: { 'Notes/Plan.md': 'local edit\n' },
      queue: { pages: onePage(update), contents: { [FIRST]: 'from ratatoskr\n' } },
    });

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
    const edge = new FakeEdge();
    const { obsidian, core } = await startWithQueue(edge, {
      files: { 'Projects/Alpha.md': '# Alpha\n', 'Daily/Today.md': 'See [[Alpha]].\n' },
      queue: { pages: onePage(rename) },
    });

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
    const edge = new FakeEdge();
    const { obsidian, core } = await startWithQueue(edge, { files: { 'A.md': 'alpha\n' }, queue: { pages, contents: { [SECOND]: 'beta\n' } } });
    const before = edge.requests.length;

    await settle(core.flush(1_000));

    expect(obsidian.calls).toEqual(['renameFile A.md B.md', 'modifyBinary B.md']);
    expect(obsidian.files.get('B.md')).toBe('beta\n');
    expect(edge.routesAfter(before)).toEqual([QUEUE, RESULT, QUEUE, CONTENT, RESULT, QUEUE]);
    // The cursor goes back exactly as notes sent it.
    expect(queueReads(edge)).toEqual([null, '7', '9']);
    expect(results(edge)).toEqual([
      { operation: FIRST, body: { outcome: 'applied', sha256: sha('alpha\n') } },
      { operation: SECOND, body: { outcome: 'applied', sha256: sha('beta\n') } },
    ]);
  });
});
