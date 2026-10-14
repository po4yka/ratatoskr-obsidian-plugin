import { afterEach, describe, expect, it } from 'vitest';
import { RatatoskrCore } from '../src/core/core';
import { FakeSecretStorage } from './support/fake-app';
import { CONNECTION_ID, FakeEdge } from './support/fake-edge';
import { factsOf } from './support/fake-vault';
import { TestVault } from './support/test-vault';

const SYNC_ID = '0199a1b2-0000-7000-8000-00000000c5c5';

let vault: TestVault | undefined;

afterEach(() => {
  vault?.remove();
  vault = undefined;
});

/** A paired and connected plugin in a test vault that holds `files`. */
async function start(edge: FakeEdge, files: Record<string, string> = {}): Promise<RatatoskrCore> {
  vault = new TestVault();
  for (const [path, text] of Object.entries(files)) {
    vault.write(path, text);
  }
  const core = await RatatoskrCore.open({
    host: vault,
    transport: edge.transport,
    vault,
    vaultKey: '0cff636eba77cae6',
    vaultName: 'Test vault',
    deviceName: 'Test device',
    edgeOrigin: () => 'https://edge.example',
    credentials: { secretStorage: new FakeSecretStorage() },
  });
  await core.pair('PAIR-0001');
  await core.connect();
  return core;
}

/** Runs a step whose failure is not the question of the test. */
async function settle(step: Promise<void>): Promise<void> {
  await step.catch(() => undefined);
}

async function createNote(core: RatatoskrCore, note: { path: string; text: string; at: number }): Promise<void> {
  vault?.write(note.path, note.text);
  await core.accept({ name: 'create', path: note.path, isFolder: false, at: note.at });
  await settle(core.flush(note.at + 10_000));
}

describe('the sync loop', () => {
  it('a sync connection makes the plugin status-only', async () => {
    const edge = new FakeEdge();
    edge.answer('POST /v1/notes/connections', {
      status: 409,
      body: {
        code: 'notes.connection.vault_already_connected',
        message: 'This vault already has a connection.',
        retryable: false,
        connection_id: SYNC_ID,
        channel: 'sync',
      },
    });
    const core = await start(edge, { 'Notes/First.md': '# First\n' });

    await createNote(core, { path: 'Notes/Second.md', text: '# Second\n', at: 1_000 });

    expect(edge.batches).toEqual([]);
    expect(edge.sent('/v1/notes/connections')).toHaveLength(1);
    expect(edge.requests.filter((request) => request.path.includes(SYNC_ID))).toEqual([]);
    expect(core.status).toMatch(/Obsidian Sync/);
  });

  it('sends a manifest of every file when it connects', async () => {
    const edge = new FakeEdge();
    await start(edge, { 'Notes/First.md': '# First\n', ['Notes/Café.md'.normalize('NFD')]: 'accents\n' });

    const manifests = edge.sent(`/v1/notes/connections/${CONNECTION_ID}/manifest`);
    expect(manifests).toHaveLength(1);
    const body = JSON.parse(String(manifests[0]?.body)) as { entries: unknown[] };

    expect(body.entries).toEqual(
      expect.arrayContaining([
        { path: 'Notes/First.md', sha256: factsOf('# First\n').sha256, length_bytes: factsOf('# First\n').length },
        { path: 'Notes/Café.md'.normalize('NFC'), sha256: factsOf('accents\n').sha256, length_bytes: 8 },
      ]),
    );
    expect(body.entries).toHaveLength(2);
  });

  it('uploads the bytes before the batch that names them', async () => {
    const edge = new FakeEdge();
    const core = await start(edge);
    const before = edge.requests.length;

    await createNote(core, { path: 'Notes/New.md', text: 'new bytes\n', at: 1_000 });

    expect(edge.routesAfter(before)).toEqual([
      'POST /v1/notes/connections/{id}/blobs',
      'PUT /v1/notes/connections/{id}/blobs/{token}/chunks/{index}',
      'POST /v1/notes/connections/{id}/blobs/{token}/finalize',
      'POST /v1/notes/connections/{id}/changes',
    ]);
    const open = JSON.parse(String(edge.requests[before]?.body)) as { digest: unknown; declared_size_bytes: number };
    expect(open.digest).toEqual({ algorithm: 'sha256', hex: factsOf('new bytes\n').sha256 });
    expect(Buffer.from(edge.requests[before + 1]?.body as Uint8Array).toString('utf8')).toBe('new bytes\n');
  });

  it('a channel mismatch points the owner to Obsidian Sync and stops the sending', async () => {
    const edge = new FakeEdge();
    edge.answer('POST /v1/notes/connections/{id}/changes', {
      status: 409,
      body: { code: 'notes.channel_mismatch', message: 'Use Obsidian Sync to share a vault.', retryable: false },
    });
    const core = await start(edge);

    await createNote(core, { path: 'Notes/A.md', text: 'a\n', at: 1_000 });
    await createNote(core, { path: 'Notes/B.md', text: 'b\n', at: 20_000 });

    expect(core.status).toMatch(/another device/);
    expect(core.status).toMatch(/Obsidian Sync/);
    expect(edge.batches).toHaveLength(1);
  });

  it('a lost state is reconciled by manifest and the sequence continues after the committed one', async () => {
    const edge = new FakeEdge();
    edge.answer('POST /v1/notes/connections/{id}/changes', { status: 200, body: { committed_sequence: 50 } });
    const core = await start(edge);
    const manifests = edge.sent(`/v1/notes/connections/${CONNECTION_ID}/manifest`).length;

    await createNote(core, { path: 'Notes/A.md', text: 'a\n', at: 1_000 });
    edge.routes.delete('POST /v1/notes/connections/{id}/changes');
    edge.answer('POST /v1/notes/connections/{id}/changes', { status: 200, body: { committed_sequence: 51 } });
    await createNote(core, { path: 'Notes/B.md', text: 'b\n', at: 20_000 });

    expect(edge.sent(`/v1/notes/connections/${CONNECTION_ID}/manifest`).length).toBe(manifests + 1);
    expect(edge.batches.at(-1)?.map((change) => change.sequence)).toEqual([51]);
  });
});
