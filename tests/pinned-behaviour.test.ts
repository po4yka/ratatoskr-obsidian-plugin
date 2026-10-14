import { afterEach, describe, expect, it } from 'vitest';
import type { HttpResponse } from '../src/api/http';
import { Batcher, DeviceSequence } from '../src/core/batcher';
import { edgeOrigin } from '../src/core/edge-address';
import { CONNECTION_ID, FakeEdge, PAIRED } from './support/fake-edge';
import { FakeVault, factsOf } from './support/fake-vault';
import { settle, startPlugin, type Running } from './support/plugin';

let running: Running | undefined;

afterEach(() => {
  running?.vault.remove();
  running = undefined;
});

const CHANGES = `/v1/notes/connections/${CONNECTION_ID}/changes`;
const UNAUTHENTICATED: HttpResponse = { status: 401, body: { code: 'edge.unauthenticated', message: 'No.', retryable: false } };
const ROTATED = { credential: 'cred_rotated_Q2w9E8r7T6y5', expires_at: 'x', refresh_token: 'rft_rotated_Z1x2C3v4', refresh_expires_at: 'x' };

/** Answers 401 to the first batch and commits the later ones. */
function rejectFirstBatch(edge: FakeEdge): void {
  let calls = 0;
  edge.routes.set('POST /v1/notes/connections/{id}/changes', (_request, body) => {
    calls += 1;
    const changes = body['changes'] as { sequence: number }[];
    return calls === 1 ? UNAUTHENTICATED : { status: 200, body: { committed_sequence: changes.at(-1)?.sequence ?? 0 } };
  });
}

async function createAndFlush(path: string): Promise<void> {
  running?.vault.write(path, `${path}\n`);
  await running?.core.accept({ name: 'create', path, isFolder: false, at: 1_000 });
  await settle(running?.core.flush(20_000) ?? Promise.resolve());
}

describe('behaviour that the review asked to pin (finding L2)', () => {
  it('a cli connection makes the plugin status-only', async () => {
    const edge = new FakeEdge();
    edge.answer('POST /v1/notes/connections', {
      status: 409,
      body: { code: 'notes.connection.vault_already_connected', message: 'x', retryable: false, connection_id: 'c', channel: 'cli' },
    });
    running = await startPlugin(edge);
    await createAndFlush('Notes/A.md');

    expect(edge.batches).toEqual([]);
    expect(running.core.status).toMatch(/export agent/);
  });

  it('a 401 renews the session with the refresh token and sends again', async () => {
    const edge = new FakeEdge();
    rejectFirstBatch(edge);
    edge.answer('POST /v1/sessions/refresh', { status: 200, body: ROTATED });
    running = await startPlugin(edge);
    await createAndFlush('Notes/A.md');

    const bearers = edge.sent(CHANGES).map((request) => request.headers['Authorization']);
    expect(bearers).toEqual([`Bearer ${PAIRED.credential}`, `Bearer ${ROTATED.credential}`]);
    expect(edge.sent('/v1/sessions/device')).toEqual([]);
  });

  it('a refused refresh opens a device session with the device secret', async () => {
    const edge = new FakeEdge();
    rejectFirstBatch(edge);
    edge.answer('POST /v1/sessions/refresh', UNAUTHENTICATED);
    edge.answer('POST /v1/sessions/device', { status: 201, body: { ...ROTATED, user_id: PAIRED.user_id, device_id: PAIRED.device_id } });
    running = await startPlugin(edge);
    await createAndFlush('Notes/A.md');

    const [opened] = edge.sent('/v1/sessions/device');
    expect(JSON.parse(String(opened?.body))).toEqual({ device_id: PAIRED.device_id, device_secret: PAIRED.device_secret });
    expect(edge.sent(CHANGES).at(-1)?.headers['Authorization']).toBe(`Bearer ${ROTATED.credential}`);
  });

  it('a create and a delete more than 3 seconds apart stay two changes', async () => {
    const vault = new FakeVault({ 'Notes/New.md': 'same\n' });
    const known = new Map([['Notes/Old.md', factsOf('same\n')]]);
    const batcher = new Batcher({ facts: vault.facts, sequence: new DeviceSequence(1), known });
    await batcher.accept({ name: 'create', path: 'Notes/New.md', isFolder: false, at: 1_000 });
    await batcher.accept({ name: 'delete', path: 'Notes/Old.md', isFolder: false, at: 4_001 });

    expect(batcher.take(20_000).map((change) => change.kind)).toEqual(['created', 'deleted']);
  });

  it('the Edge address must be HTTPS without a user name or a password', () => {
    expect(edgeOrigin('https://edge.example/some/path/')).toBe('https://edge.example');
    expect(edgeOrigin('https://edge.example:8443')).toBe('https://edge.example:8443');
    expect(() => edgeOrigin('http://edge.example')).toThrow(/https/);
    expect(() => edgeOrigin('https://owner:PASSWORD@edge.example/')).toThrow(/user name/);
    expect(() => edgeOrigin('edge.example')).toThrow(/valid/);
  });
});
