import { afterEach, describe, expect, it } from 'vitest';
import { CONNECTION_ID, FakeEdge } from './support/fake-edge';
import { MISMATCH, settle, startPlugin, type Running } from './support/plugin';

let running: Running | undefined;

afterEach(() => {
  running?.vault.remove();
  running = undefined;
});

const MANIFEST = `/v1/notes/connections/${CONNECTION_ID}/manifest`;

async function createAndFlush(note: { path: string; at: number }): Promise<void> {
  if (running === undefined) {
    throw new Error('start the plugin first');
  }
  running.vault.write(note.path, `${note.path}\n`);
  await settle(running.core.accept({ name: 'create', path: note.path, isFolder: false, at: note.at }));
  await settle(running.core.flush(note.at + 10_000));
}

describe('the plugin stops for a channel mismatch on every route', () => {
  it('a channel mismatch on the manifest route stops the plugin', async () => {
    const edge = new FakeEdge();
    edge.answer('POST /v1/notes/connections/{id}/manifest', MISMATCH);
    running = await startPlugin(edge);

    await createAndFlush({ path: 'Notes/A.md', at: 1_000 });
    const requests = edge.requests.length;
    await createAndFlush({ path: 'Notes/B.md', at: 20_000 });

    expect(running.core.status).toMatch(/another device/);
    expect(running.core.status).toMatch(/Obsidian Sync/);
    expect(edge.batches).toEqual([]);
    expect(edge.requests.length).toBe(requests);
  });

  it('a channel mismatch on the upload route stops the plugin', async () => {
    const edge = new FakeEdge();
    edge.answer('POST /v1/notes/connections/{id}/blobs', MISMATCH);
    running = await startPlugin(edge);

    await createAndFlush({ path: 'Notes/A.md', at: 1_000 });
    const requests = edge.requests.length;
    await createAndFlush({ path: 'Notes/B.md', at: 20_000 });

    expect(running.core.status).toMatch(/another device/);
    expect(running.core.status).toMatch(/Obsidian Sync/);
    expect(edge.batches).toEqual([]);
    expect(edge.requests.length).toBe(requests);
  });
});

describe('the start of the plugin', () => {
  it('a manifest is sent at each start', async () => {
    const edge = new FakeEdge();
    running = await startPlugin(edge, { files: { 'Notes/First.md': '# First\n' } });
    const before = edge.sent(MANIFEST).length;
    // Edited while the plugin was disabled: no event reports it.
    running.vault.write('Notes/First.md', '# First, edited\n');

    const restarted = await running.reopen();
    await restarted.flush(1_000);

    expect(edge.sent(MANIFEST).length).toBe(before + 1);
  });
});
