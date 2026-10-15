import { afterEach, describe, expect, it } from 'vitest';
import { CONTENT, FIRST, QUEUE, RESULT, UPLOAD, blobRef, bytesMissingOnce, onePage, operation, removeVaults, results, sha, startWithQueue } from './support/device-queue';
import { FakeEdge } from './support/fake-edge';
import { settle } from './support/plugin';

// Workspace change `add-notes-write-back` (OBS-024), task 11.3: each kind of operation, the upload
// after `notes.channel.bytes_missing`, the hash check of the content, and the `failed` codes.

afterEach(removeVaults);

const TASK = '---\nstatus: "open"\ndue: "2026-10-20"\n---\nBody\n';

/** One flush against a queue of one operation; returns the fake Edge and the fake vault API. */
async function applyOne(setup: { files: Record<string, string>; operation: Record<string, unknown>; content?: string; missing?: string[] }) {
  const edge = new FakeEdge();
  const contents = setup.content === undefined ? {} : { [FIRST]: setup.content };
  const { obsidian, core } = await startWithQueue(edge, { files: setup.files, queue: { pages: onePage(setup.operation), contents } });
  if (setup.missing !== undefined) {
    bytesMissingOnce(edge, setup.missing);
  }
  const before = edge.requests.length;
  await settle(core.flush(1_000));
  return { edge, obsidian, routes: edge.routesAfter(before) };
}

describe('each kind of operation', () => {
  it('create writes a new file and creates its folder first', async () => {
    const create = operation({ operation_id: FIRST, kind: 'create', path: 'Inbox/New.md', content: blobRef('new\n'), expected_sha256: sha('new\n') });

    const { edge, obsidian } = await applyOne({ files: { 'Notes/A.md': 'a\n' }, operation: create, content: 'new\n' });

    expect(obsidian.calls).toEqual(['createFolder Inbox', 'createBinary Inbox/New.md']);
    expect(obsidian.files.get('Inbox/New.md')).toBe('new\n');
    expect(results(edge)).toEqual([{ operation: FIRST, body: { outcome: 'applied', sha256: sha('new\n') } }]);
  });

  it('delete moves the file to the trash, never permanently', async () => {
    const remove = operation({ operation_id: FIRST, kind: 'delete', path: 'Notes/Old.md', base_hash: sha('old\n') });

    const { edge, obsidian } = await applyOne({ files: { 'Notes/Old.md': 'old\n' }, operation: remove });

    expect(obsidian.calls).toEqual(['trash Notes/Old.md system=true']);
    expect(obsidian.files.has('Notes/Old.md')).toBe(false);
    expect(results(edge)).toEqual([{ operation: FIRST, body: { outcome: 'applied' } }]);
  });

  it('set_property sets the value, uploads the new bytes that notes names, and reports again', async () => {
    const done = TASK.replace('"open"', '"done"');
    const property = operation({
      operation_id: FIRST,
      kind: 'set_property',
      path: 'Notes/Task.md',
      base_hash: sha(TASK),
      content: blobRef('"done"', 'application/json'),
      property_key: 'status',
      property_change: 'set',
    });

    const { edge, obsidian, routes } = await applyOne({ files: { 'Notes/Task.md': TASK }, operation: property, content: '"done"', missing: [sha(done)] });

    expect(obsidian.files.get('Notes/Task.md')).toBe(done);
    expect(routes).toEqual([QUEUE, CONTENT, RESULT, ...UPLOAD, RESULT, QUEUE]);
    expect(Buffer.from(edge.requests.find((request) => request.method === 'PUT')?.body as Uint8Array).toString('utf8')).toBe(done);
    expect(results(edge).map((result) => result.body)).toEqual([
      { outcome: 'applied', sha256: sha(done) },
      { outcome: 'applied', sha256: sha(done) },
    ]);
  });

  it('set_property remove takes the key out', async () => {
    const property = operation({ operation_id: FIRST, kind: 'set_property', path: 'Notes/Task.md', base_hash: sha(TASK), property_key: 'due', property_change: 'remove' });

    const { obsidian } = await applyOne({ files: { 'Notes/Task.md': TASK }, operation: property });

    expect(obsidian.files.get('Notes/Task.md')).toBe('---\nstatus: "open"\n---\nBody\n');
  });
});

describe('results that notes does not take at once, and failures', () => {
  it('a rename that notes answers with bytes_missing uploads the bytes of the target', async () => {
    const rename = operation({ operation_id: FIRST, kind: 'rename', path: 'A.md', target_path: 'B.md', base_hash: sha('alpha\n'), expected_sha256: sha('alpha\n') });

    const { edge, routes } = await applyOne({ files: { 'A.md': 'alpha\n' }, operation: rename, missing: [sha('alpha\n')] });

    expect(routes).toEqual([QUEUE, RESULT, ...UPLOAD, RESULT, QUEUE]);
    expect(Buffer.from(edge.requests.find((request) => request.method === 'PUT')?.body as Uint8Array).toString('utf8')).toBe('alpha\n');
    expect(results(edge)).toHaveLength(2);
  });

  it('content whose bytes do not have the digest is failed, and nothing is written', async () => {
    const update = operation({ operation_id: FIRST, kind: 'update', path: 'A.md', base_hash: sha('alpha\n'), content: blobRef('beta\n'), expected_sha256: sha('beta\n') });

    const { edge, obsidian } = await applyOne({ files: { 'A.md': 'alpha\n' }, operation: update, content: 'tampered\n' });

    expect(obsidian.calls).toEqual([]);
    expect(obsidian.files.get('A.md')).toBe('alpha\n');
    expect(results(edge)).toEqual([{ operation: FIRST, body: { outcome: 'failed', code: 'notes.channel.refused' } }]);
  });

  it('a vault API that refuses the write reports notes.channel.refused', async () => {
    const rename = operation({ operation_id: FIRST, kind: 'rename', path: 'A.md', target_path: 'B.md', base_hash: sha('alpha\n'), expected_sha256: sha('alpha\n') });

    const { edge, obsidian } = await applyOne({ files: { 'A.md': 'alpha\n', 'B.md': 'beta\n' }, operation: rename });

    expect([...obsidian.files.entries()]).toEqual([['A.md', 'alpha\n'], ['B.md', 'beta\n']]);
    expect(results(edge)).toEqual([{ operation: FIRST, body: { outcome: 'failed', code: 'notes.channel.refused' } }]);
  });

  it('a kind that the plugin does not know reports notes.write.unsupported', async () => {
    const merge = operation({ operation_id: FIRST, kind: 'merge', path: 'A.md', base_hash: sha('alpha\n') });

    const { edge, obsidian } = await applyOne({ files: { 'A.md': 'alpha\n' }, operation: merge });

    expect(obsidian.calls).toEqual([]);
    expect(results(edge)).toEqual([{ operation: FIRST, body: { outcome: 'failed', code: 'notes.write.unsupported' } }]);
  });
});
