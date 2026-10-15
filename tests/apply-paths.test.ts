import { afterEach, describe, expect, it } from 'vitest';
import { FIRST, blobRef, onePage, operation, removeVaults, results, sha, startWithQueue } from './support/device-queue';
import { FakeEdge } from './support/fake-edge';
import { settle } from './support/plugin';

// Workspace change `add-notes-write-back` (OBS-024), task 11.5: the plugin checks the paths of an
// operation itself before it touches the vault. The contract `notes/write-request.v1` already
// refuses these paths; this is a second check on the device.

afterEach(removeVaults);

/** One flush against a queue of one operation in a vault that holds `A.md`, with its configuration in `.custom-config`. */
async function applyOne(fields: Record<string, unknown>, contents: Record<string, string> = {}) {
  const edge = new FakeEdge();
  const queue = { pages: onePage(operation({ operation_id: FIRST, kind: 'update', path: 'A.md', ...fields })), contents };
  const { obsidian, core } = await startWithQueue(edge, { files: { 'A.md': 'alpha\n' }, queue });
  obsidian.vault.configDir = '.custom-config';
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
  // Windows reads a backslash as a separator and strips trailing dots and spaces from a name.
  ['a backslash into the configuration folder', { path: '.obsidian\\app.json' }],
  ['a backslash .. segment', { path: '..\\A.md' }],
  ['a C0 control character', { path: 'A\u0000.md' }],
  ['a DEL character', { path: 'A\u007f.md' }],
  ['the configuration folder with a trailing dot', { path: '.obsidian./app.json' }],
  ['the configuration folder with a trailing space', { path: '.obsidian /x.md' }],
  ['a rename whose target holds a backslash', { kind: 'rename', target_path: 'Notes\\B.md' }],
  // Windows strips trailing dots and spaces from every name, so `.. ` is `..` there.
  ['a later segment of two dots and a space', { path: 'Notes/.. /../x.md' }],
  ['a later segment of a dot and a space', { path: 'Notes/. /x.md' }],
  ['a later segment of three dots', { path: 'Notes/.../x.md' }],
  ['a folder name that ends in a space', { path: 'Notes /x.md' }],
  ['a file name that ends in a dot', { path: 'Notes/x.' }],
  ['a drive letter', { path: 'C:/x.md' }],
  ['a stream name', { path: 'Notes/A.md:hidden' }],
  ['the configuration folder of the vault', { path: '.custom-config/app.json' }],
  ['the configuration folder of the vault in another case', { path: '.CUSTOM-Config/app.json' }],
  ['a rename into a segment of three dots', { kind: 'rename', target_path: 'Notes/.../B.md' }],
  ['a move whose target holds a colon', { kind: 'move', target_path: 'Notes:x/B.md' }],
  ['a rename into the configuration folder of the vault', { kind: 'rename', target_path: '.custom-config/B.md' }],
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
