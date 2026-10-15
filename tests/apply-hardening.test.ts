import { afterEach, describe, expect, it } from 'vitest';
import { FIRST, blobRef, bytesMissingOnce, onePage, operation, removeVaults, results, sha, startWithQueue } from './support/device-queue';
import { FakeEdge } from './support/fake-edge';
import { settle } from './support/plugin';

// Workspace change `add-notes-write-back` (OBS-024), task 11.12: the length of the content, a
// property key that names the prototype, the upload of a file that the device stores in NFD, and an
// operation that the device already applied.

afterEach(removeVaults);

/** One flush against a queue of one operation; returns the fake Edge and the fake vault API. */
async function applyOne(setup: { files: Record<string, string>; operation: Record<string, unknown>; content?: string; missing?: string[] }) {
  const edge = new FakeEdge();
  const contents = setup.content === undefined ? {} : { [FIRST]: setup.content };
  const { obsidian, core } = await startWithQueue(edge, { files: setup.files, queue: { pages: onePage(setup.operation), contents } });
  if (setup.missing !== undefined) {
    bytesMissingOnce(edge, setup.missing);
  }
  await settle(core.flush(1_000));
  return { edge, obsidian };
}

describe('the plugin does not trust what it receives', () => {
  it('content whose length is not length_bytes is failed, and nothing is written', async () => {
    const content = { ...blobRef('beta\n'), length_bytes: 999 };
    const update = operation({ operation_id: FIRST, kind: 'update', path: 'A.md', base_hash: sha('alpha\n'), content, expected_sha256: sha('beta\n') });

    const { edge, obsidian } = await applyOne({ files: { 'A.md': 'alpha\n' }, operation: update, content: 'beta\n' });

    expect(obsidian.calls).toEqual([]);
    expect(results(edge)).toEqual([{ operation: FIRST, body: { outcome: 'failed', code: 'notes.channel.refused' } }]);
  });

  it.each(['__proto__', 'constructor', 'prototype'])('set_property with the key %s is refused', async (key) => {
    const text = '---\nstatus: "open"\n---\nBody\n';
    const property = operation({
      operation_id: FIRST,
      kind: 'set_property',
      path: 'Notes/Task.md',
      base_hash: sha(text),
      content: blobRef('{"polluted":true}', 'application/json'),
      property_key: key,
      property_change: 'set',
    });

    const { edge, obsidian } = await applyOne({ files: { 'Notes/Task.md': text }, operation: property, content: '{"polluted":true}' });

    expect(obsidian.calls).toEqual([]);
    expect(results(edge)).toEqual([{ operation: FIRST, body: { outcome: 'failed', code: 'notes.write.unsafe_path' } }]);
  });
});

describe('the device already holds the file', () => {
  it('the upload after bytes_missing reads the file that the NFD lookup found', async () => {
    const stored = 'Notes/Café.md'.normalize('NFD');
    const update = operation({
      operation_id: FIRST,
      kind: 'update',
      path: 'Notes/Café.md'.normalize('NFC'),
      base_hash: sha('old\n'),
      content: blobRef('new\n'),
      expected_sha256: sha('new\n'),
    });

    const { edge } = await applyOne({ files: { [stored]: 'old\n' }, operation: update, content: 'new\n', missing: [sha('new\n')] });

    const chunk = edge.requests.find((request) => request.method === 'PUT')?.body ?? new Uint8Array();
    expect(Buffer.from(chunk).toString('utf8')).toBe('new\n');
    expect(results(edge).map((result) => result.body)).toEqual([
      { outcome: 'applied', sha256: sha('new\n') },
      { outcome: 'applied', sha256: sha('new\n') },
    ]);
  });

  it('a local file that already has the expected hash is reported applied', async () => {
    const update = operation({ operation_id: FIRST, kind: 'update', path: 'A.md', base_hash: sha('alpha\n'), content: blobRef('beta\n'), expected_sha256: sha('beta\n') });

    const { edge, obsidian } = await applyOne({ files: { 'A.md': 'beta\n' }, operation: update, content: 'beta\n' });

    expect(obsidian.calls).toEqual([]);
    expect(results(edge)).toEqual([{ operation: FIRST, body: { outcome: 'applied', sha256: sha('beta\n') } }]);
  });
});

/** The fields of an operation that a case sets: its kind and more. */
type Fields = { kind: string } & Record<string, unknown>;

describe('a re-delivery after a lost result, by kind', () => {
  const OTHER_KINDS: readonly (readonly [string, Fields])[] = [
    ['a delete', { kind: 'delete' }],
    ['a rename', { kind: 'rename', target_path: 'B.md' }],
  ];

  it.each(OTHER_KINDS)('%s whose source has expected_sha256 is a base mismatch', async (_name, fields) => {
    const changed = operation({ operation_id: FIRST, path: 'A.md', base_hash: sha('alpha\n'), expected_sha256: sha('beta\n'), ...fields });

    const { edge, obsidian } = await applyOne({ files: { 'A.md': 'beta\n' }, operation: changed });

    expect(obsidian.calls).toEqual([]);
    expect(results(edge)).toEqual([{ operation: FIRST, body: { outcome: 'base_mismatch', local_sha256: sha('beta\n') } }]);
  });

  const MOVED: readonly (readonly [string, Fields])[] = [
    ['a rename with expected_sha256', { kind: 'rename', expected_sha256: sha('alpha\n') }],
    ['a move without expected_sha256, by its base hash', { kind: 'move', expected_sha256: null }],
  ];

  it.each(MOVED)('%s whose source is gone and whose target has the bytes is applied', async (_name, fields) => {
    const moved = operation({ operation_id: FIRST, path: 'A.md', target_path: 'Done/B.md', base_hash: sha('alpha\n'), ...fields });

    const { edge, obsidian } = await applyOne({ files: { 'Done/B.md': 'alpha\n' }, operation: moved });

    expect(obsidian.calls).toEqual([]);
    expect(results(edge)).toEqual([{ operation: FIRST, body: { outcome: 'applied', sha256: sha('alpha\n') } }]);
  });
});
