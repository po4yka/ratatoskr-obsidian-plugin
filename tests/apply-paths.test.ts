import { afterEach, describe, expect, it } from 'vitest';
import { FIRST, blobRef, onePage, operation, removeVaults, results, sha, startWithQueue } from './support/device-queue';
import { FakeEdge } from './support/fake-edge';
import { settle } from './support/plugin';

// Workspace change `add-notes-write-back` (OBS-024), task 11.5: the plugin checks the paths of an
// operation itself before it touches the vault. The contract `notes/write-request.v1` already
// refuses these paths; this is a second check on the device.

afterEach(removeVaults);

/** One flush against a queue of one operation in a vault that holds `A.md`. */
async function applyOne(fields: Record<string, unknown>, contents: Record<string, string> = {}) {
  const edge = new FakeEdge();
  const queue = { pages: onePage(operation({ operation_id: FIRST, kind: 'update', path: 'A.md', ...fields })), contents };
  const { obsidian, core } = await startWithQueue(edge, { files: { 'A.md': 'alpha\n' }, queue });
  obsidian.lookups.length = 0;
  await settle(core.flush(1_000));
  return { edge, obsidian };
}

const UNSAFE: readonly (readonly [string, Record<string, unknown>])[] = [
  ['the configuration folder', { path: '.obsidian/app.json' }],
  ['the configuration folder in upper case', { path: '.OBSIDIAN/workspace.json' }],
  ['the configuration folder in mixed case', { path: '.Obsidian' }],
  ['an empty segment', { path: 'Notes//A.md' }],
  ['a trailing slash', { path: 'Notes/' }],
  ['a . segment', { path: './A.md' }],
  ['a .. segment', { path: 'Notes/../A.md' }],
  ['a leading slash', { path: '/A.md' }],
  ['a rename into the configuration folder', { kind: 'rename', target_path: '.obsidian/A.md' }],
  ['a rename with a .. segment', { kind: 'move', target_path: '../A.md' }],
];

describe('the paths of an operation', () => {
  it.each(UNSAFE)('%s is refused before the vault is touched', async (_name, fields) => {
    const { edge, obsidian } = await applyOne({ base_hash: sha('alpha\n'), ...fields });

    expect(obsidian.lookups).toEqual([]);
    expect(obsidian.calls).toEqual([]);
    expect(results(edge)).toEqual([{ operation: FIRST, body: { outcome: 'failed', code: 'notes.write.unsafe_path' } }]);
  });

  it('a folder whose name only starts with .obsidian is a normal folder', async () => {
    const fields = { kind: 'create', path: '.obsidian-archive/Plan.md', content: blobRef('plan\n'), expected_sha256: sha('plan\n') };

    const { edge, obsidian } = await applyOne(fields, { [FIRST]: 'plan\n' });

    expect(obsidian.files.get('.obsidian-archive/Plan.md')).toBe('plan\n');
    expect(results(edge)).toEqual([{ operation: FIRST, body: { outcome: 'applied', sha256: sha('plan\n') } }]);
  });
});

describe('a file whose name is stored in NFD', () => {
  // macOS and iOS can keep a file name in NFD. Notes names every path in NFC.
  it('an NFC path finds the NFD file before a base mismatch', async () => {
    const stored = 'Notes/Café.md'.normalize('NFD');
    const update = operation({
      operation_id: FIRST,
      kind: 'update',
      path: 'Notes/Café.md'.normalize('NFC'),
      base_hash: sha('old\n'),
      content: blobRef('new\n'),
      expected_sha256: sha('new\n'),
    });
    const edge = new FakeEdge();
    const queue = { pages: onePage(update), contents: { [FIRST]: 'new\n' } };
    const { obsidian, core } = await startWithQueue(edge, { files: { [stored]: 'old\n' }, queue });

    await settle(core.flush(1_000));

    expect(obsidian.calls).toEqual([`modifyBinary ${stored}`]);
    expect(obsidian.files.get(stored)).toBe('new\n');
    expect(results(edge)).toEqual([{ operation: FIRST, body: { outcome: 'applied', sha256: sha('new\n') } }]);
  });
});
