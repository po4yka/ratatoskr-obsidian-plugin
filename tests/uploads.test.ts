import { afterEach, describe, expect, it } from 'vitest';
import { FakeEdge, MAX_FILE_BYTES } from './support/fake-edge';
import { factsOf } from './support/fake-vault';
import { settle, startPlugin, type Running } from './support/plugin';

let running: Running | undefined;

afterEach(() => {
  running?.vault.remove();
  running = undefined;
});

/** A plugin whose fake Edge answers the batches and the manifests as `ratatoskr-notes` does. */
async function start(): Promise<{ edge: FakeEdge; running: Running }> {
  const edge = new FakeEdge();
  edge.keepNotesBytes();
  running = await startPlugin(edge);
  return { edge, running };
}

async function createAndFlush(note: { path: string; text: string; at: number }): Promise<void> {
  if (running === undefined) {
    throw new Error('start the plugin first');
  }
  running.vault.write(note.path, note.text);
  await settle(running.core.accept({ name: 'create', path: note.path, isFolder: false, at: note.at }));
  await settle(running.core.flush(note.at + 10_000));
}

const uploads = (edge: FakeEdge): number => edge.requests.filter((request) => request.path.endsWith('/blobs')).length;

describe('the plugin uploads only the bytes that notes names', () => {
  it('a batch uploads only the bytes that notes names, then is sent again', async () => {
    const { edge } = await start();
    const before = edge.requests.length;

    await createAndFlush({ path: 'Notes/New.md', text: 'new bytes\n', at: 1_000 });

    expect(edge.routesAfter(before)).toEqual([
      'POST /v1/notes/connections/{id}/changes',
      'POST /v1/notes/connections/{id}/blobs',
      'PUT /v1/notes/connections/{id}/blobs/{token}/chunks/{index}',
      'POST /v1/notes/connections/{id}/blobs/{token}/finalize',
      'POST /v1/notes/connections/{id}/changes',
    ]);
    const open = JSON.parse(String(edge.requests[before + 1]?.body)) as { digest: unknown };
    expect(open.digest).toEqual({ algorithm: 'sha256', hex: factsOf('new bytes\n').sha256 });
    expect(Buffer.from(edge.requests[before + 2]?.body as Uint8Array).toString('utf8')).toBe('new bytes\n');
  });

  it('an empty file is not uploaded', async () => {
    const { edge } = await start();

    await createAndFlush({ path: 'Notes/Empty.md', text: '', at: 1_000 });

    expect(uploads(edge)).toBe(0);
    expect(edge.batches).toHaveLength(1);
    expect(edge.batches[0]?.[0]).toMatchObject({ path: 'Notes/Empty.md', length_bytes: 0 });
  });

  it('a file over 64 MiB is not uploaded', async () => {
    const { edge } = await start();

    await createAndFlush({ path: 'Media/Large.bin', text: 'a'.repeat(MAX_FILE_BYTES + 1), at: 1_000 });

    expect(uploads(edge)).toBe(0);
    expect(edge.batches).toHaveLength(1);
    expect(edge.batches[0]?.[0]).toMatchObject({ path: 'Media/Large.bin', length_bytes: MAX_FILE_BYTES + 1 });
  });

  it('a file under .obsidian or .Trash is not uploaded', async () => {
    const { edge } = await start();

    await createAndFlush({ path: '.obsidian/snippets/wide.css', text: 'body {}\n', at: 1_000 });
    await createAndFlush({ path: '.Trash/Old.md', text: 'old\n', at: 20_000 });

    expect(uploads(edge)).toBe(0);
    expect(edge.batches.map((batch) => batch.map((change) => change.path))).toEqual([['.obsidian/snippets/wide.css'], ['.Trash/Old.md']]);
  });
});
