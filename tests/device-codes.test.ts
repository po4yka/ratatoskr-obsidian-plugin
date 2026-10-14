import { afterEach, describe, expect, it } from 'vitest';
import type { Change } from '../src/core/types';
import { CONNECTION_ID, FakeEdge } from './support/fake-edge';
import { settle, startPlugin, type Running } from './support/plugin';

const SECOND_ID = '0199a1b2-0000-7000-8000-0000000c0002';

let running: Running | undefined;

async function createAndFlush(note: { path: string; at: number }): Promise<void> {
  if (running === undefined) {
    throw new Error('start the plugin first');
  }
  running.vault.write(note.path, `${note.path}\n`);
  await settle(running.core.accept({ name: 'create', path: note.path, isFolder: false, at: note.at }));
  await settle(running.core.flush(note.at + 10_000));
}

afterEach(() => {
  running?.vault.remove();
  running = undefined;
});

describe('the answers of the notes device channel', () => {
  it('a batch that is too large is split', async () => {
    const edge = new FakeEdge();
    edge.routes.set('POST /v1/notes/connections/{id}/changes', (_request, body) => {
      const changes = body['changes'] as Change[];
      if (changes.length > 2) {
        return {
          status: 413,
          body: { code: 'notes.channel.batch_too_large', message: 'A batch holds at most 2 changes.', retryable: false, max_changes: 2 },
        };
      }
      return { status: 200, body: { committed_sequence: changes.at(-1)?.sequence ?? 0 } };
    });
    running = await startPlugin(edge);

    for (const name of ['A', 'B', 'C', 'D', 'E']) {
      running.vault.write(`Notes/${name}.md`, `${name}\n`);
      await running.core.accept({ name: 'create', path: `Notes/${name}.md`, isFolder: false, at: 1_000 });
    }
    await settle(running.core.flush(20_000));

    const [first, ...rest] = edge.batches;
    expect(first).toHaveLength(5);
    expect(rest.every((batch) => batch.length <= 2)).toBe(true);
    expect(rest.flat().map((change) => change.sequence)).toEqual([1, 2, 3, 4, 5]);
    expect(running.core.status).toMatch(/Up to date/);
  });

  // Notes fails a device connect when no manifest arrives in time, and then answers 404 on the
  // routes of that connection. `manifest_missing` is the code of that failure.
  it.each([
    { status: 404, code: 'notes.connection.not_found' },
    { status: 409, code: 'notes.channel.manifest_missing' },
  ])('a connection that notes failed is connected again ($code)', async ({ status, code }) => {
    const edge = new FakeEdge();
    let connects = 0;
    let failed = false;
    edge.routes.set('POST /v1/notes/connections', () => {
      connects += 1;
      return { status: 202, body: { connection_id: connects === 1 ? CONNECTION_ID : SECOND_ID, channel: 'plugin', state: 'connecting' } };
    });
    for (const route of ['changes', 'manifest']) {
      const answer = edge.routes.get(`POST /v1/notes/connections/{id}/${route}`);
      edge.routes.set(`POST /v1/notes/connections/{id}/${route}`, (request, body) =>
        failed && request.path.includes(CONNECTION_ID)
          ? { status, body: { code, message: 'The connection does not exist.', retryable: false } }
          : (answer?.(request, body) ?? { status: 500, body: null }),
      );
    }
    running = await startPlugin(edge);
    await createAndFlush({ path: 'Notes/A.md', at: 1_000 });
    failed = true;

    await createAndFlush({ path: 'Notes/B.md', at: 20_000 });
    await createAndFlush({ path: 'Notes/C.md', at: 40_000 });

    expect(edge.sent('/v1/notes/connections')).toHaveLength(2);
    const manifests = edge.sent(`/v1/notes/connections/${SECOND_ID}/manifest`);
    expect(manifests).toHaveLength(1);
    const entries = (JSON.parse(String(manifests[0]?.body)) as { entries: { path: string }[] }).entries;
    expect(entries.map((entry) => entry.path).sort()).toEqual(['Notes/A.md', 'Notes/B.md']);
    const batches = edge.sent(`/v1/notes/connections/${SECOND_ID}/changes`);
    expect(batches.map((request) => (JSON.parse(String(request.body)) as { changes: Change[] }).changes.map((change) => change.sequence))).toEqual([[1]]);
    expect(running.core.status).toMatch(/Up to date/);
  });

  // Notes names the connect operation in its `202` answer (workspace design D10). The field is optional.
  it.each([
    { name: 'with', operation: { operation: { operation_id: '0199a1b2-0000-7000-8000-0000000e0001', kind: 'notes.connection.connect', lane: 'ratatoskr-notes' } } },
    { name: 'without', operation: {} },
  ])('the connect answer $name an operation is read', async ({ operation }) => {
    const edge = new FakeEdge();
    edge.answer('POST /v1/notes/connections', {
      status: 202,
      body: { connection_id: CONNECTION_ID, channel: 'plugin', state: 'connecting', ...operation },
    });
    running = await startPlugin(edge, { files: { 'Notes/First.md': '# First\n' } });

    expect(edge.sent(`/v1/notes/connections/${CONNECTION_ID}/manifest`)).toHaveLength(1);
    expect(running.core.status).toMatch(/Up to date/);
  });
});
