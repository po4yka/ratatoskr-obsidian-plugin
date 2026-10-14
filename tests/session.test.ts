import { afterEach, describe, expect, it } from 'vitest';
import type { HttpResponse } from '../src/api/http';
import { RatatoskrCore, type CoreOptions } from '../src/core/core';
import { CREDENTIAL_ID } from '../src/core/credential-store';
import { FakeSecretStorage } from './support/fake-app';
import { FakeEdge, PAIRED } from './support/fake-edge';
import { TestVault } from './support/test-vault';

const ORIGIN = 'https://edge.example';
const UNAUTHENTICATED: HttpResponse = { status: 401, body: { code: 'edge.unauthenticated', message: 'No.', retryable: false } };
const RENEWED = {
  credential: 'cred_renewed_H5j8K2l4M7n1',
  expires_at: '2026-10-14T14:00:00Z',
  refresh_token: 'rft_renewed_P3q6R9s2T5u8',
  refresh_expires_at: '2026-11-13T13:00:00Z',
};
/** Fields that a renewal answer must not change, with values that no pairing gave. */
const FOREIGN = {
  device_id: '0199a1b2-0000-7000-8000-00000000d0ff',
  user_id: '0199a1b2-0000-7000-8000-00000000a0ff',
  device_secret: 'dsec_foreign_W4e7R1t3Y6u9',
  edge_origin: 'https://foreign.example',
};

/** `app.secretStorage` with `deleteSecret`, which spike 3.5 found on the prototype. */
class DeletingSecretStorage extends FakeSecretStorage {
  deleteSecret(id: string): void {
    this.secrets.delete(id);
  }
}

let vault: TestVault | undefined;

afterEach(() => {
  vault?.remove();
  vault = undefined;
});

function optionsFor(edge: FakeEdge, secretStorage: FakeSecretStorage): CoreOptions {
  vault = new TestVault();
  return {
    host: vault,
    transport: edge.transport,
    vault,
    vaultKey: '0cff636eba77cae6',
    vaultName: 'Test vault',
    deviceName: 'Test device',
    edgeOrigin: () => ORIGIN,
    credentials: { secretStorage },
  };
}

async function sendOneFile(core: RatatoskrCore): Promise<void> {
  vault?.write('Notes/A.md', 'a\n');
  await core.accept({ name: 'create', path: 'Notes/A.md', isFolder: false, at: 1_000 });
  await core.flush(20_000).catch(() => undefined);
}

describe('the device session', () => {
  it('Unpair deletes the secret and the connection', async () => {
    const edge = new FakeEdge();
    const storage = new DeletingSecretStorage();
    const core = await RatatoskrCore.open(optionsFor(edge, storage));
    await core.pair('PAIR-0001');
    await core.connect();
    const sent = edge.requests.length;

    await core.unpair();
    await sendOneFile(core);

    expect(storage.listSecrets()).toEqual([]);
    expect(core.status).toMatch(/not paired/i);
    expect(edge.requests.slice(sent)).toEqual([]);
  });

  it.each([
    { name: 'the refresh', refresh: { status: 200, body: { ...RENEWED, ...FOREIGN } } },
    { name: 'the device session', refresh: UNAUTHENTICATED, device: { status: 201, body: { ...RENEWED, ...FOREIGN } } },
  ])('a renewal by $name keeps the device, the secret and the origin', async (renewal) => {
    const edge = new FakeEdge();
    const storage = new FakeSecretStorage();
    let batches = 0;
    edge.routes.set('POST /v1/notes/connections/{id}/changes', () =>
      (batches += 1) === 1 ? UNAUTHENTICATED : { status: 200, body: { committed_sequence: 1 } },
    );
    edge.answer('POST /v1/sessions/refresh', renewal.refresh);
    edge.answer('POST /v1/sessions/device', renewal.device ?? UNAUTHENTICATED);
    const core = await RatatoskrCore.open(optionsFor(edge, storage));
    await core.pair('PAIR-0001');
    await core.connect();

    await sendOneFile(core);

    expect(JSON.parse(storage.getSecret(CREDENTIAL_ID) ?? 'null')).toEqual({ ...PAIRED, ...RENEWED, edge_origin: ORIGIN });
  });

  it('a credential from an older version asks for a new pairing', async () => {
    const storage = new FakeSecretStorage();
    // A credential that a build before the origin binding saved: it has no `edge_origin`.
    storage.setSecret(CREDENTIAL_ID, JSON.stringify(PAIRED));
    const core = await RatatoskrCore.open(optionsFor(new FakeEdge(), storage));

    expect(core.status).toMatch(/older version/i);
    expect(core.status).not.toMatch(/address changed/i);
  });
});
