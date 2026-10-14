import { afterEach, describe, expect, it } from 'vitest';
import type { HttpRequest, Transport } from '../src/api/http';
import { RatatoskrCore } from '../src/core/core';
import { FakeSecretStorage } from './support/fake-app';
import { FakeEdge, PAIRED } from './support/fake-edge';
import { TestVault } from './support/test-vault';

const PAIRED_ORIGIN = 'https://edge.example';
const OTHER_ORIGIN = 'https://other.example';
const SECRETS = [PAIRED.credential, PAIRED.refresh_token, PAIRED.device_secret];

let vault: TestVault | undefined;

afterEach(() => {
  vault?.remove();
  vault = undefined;
});

/** The text of a request in which a secret can travel: its headers and its body. */
function exposed(request: HttpRequest): string {
  const body = typeof request.body === 'string' ? request.body : '';
  return `${JSON.stringify(request.headers)}\n${body}`;
}

describe('the Edge origin of the credential', () => {
  it('a changed Edge address after pairing sends no secret to the new host', async () => {
    const paired = new FakeEdge();
    const other = new FakeEdge();
    for (const route of [...other.routes.keys()]) {
      other.answer(route, { status: 401, body: { code: 'edge.unauthenticated', message: 'No.', retryable: false } });
    }
    let address = PAIRED_ORIGIN;
    // The worst case of the adapter: each request goes to the address of the settings at that time.
    const transport: Transport = (request) => (address === PAIRED_ORIGIN ? paired : other).transport(request);
    vault = new TestVault();
    const options = {
      host: vault,
      transport,
      vault,
      vaultKey: '0cff636eba77cae6',
      vaultName: 'Test vault',
      deviceName: 'Test device',
      credentials: { secretStorage: new FakeSecretStorage() },
      edgeOrigin: () => address,
    };
    const core = await RatatoskrCore.open(options);
    await core.pair('PAIR-0001');
    await core.connect();

    address = OTHER_ORIGIN;
    vault.write('Notes/After.md', 'after the change\n');
    await core.accept({ name: 'create', path: 'Notes/After.md', isFolder: false, at: 1_000 });
    await core.flush(10_000);
    await core.connect().catch(() => undefined);

    const leaked = other.requests.filter((request) => SECRETS.some((secret) => exposed(request).includes(secret)));
    expect(leaked.map((request) => request.path)).toEqual([]);
    expect(core.status).toMatch(/pair again/i);
  });
});
