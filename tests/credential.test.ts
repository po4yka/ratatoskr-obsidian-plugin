import { afterEach, describe, expect, it } from 'vitest';
import { RatatoskrCore } from '../src/core/core';
import type { CredentialEnvironment } from '../src/core/credentials';
import { FakeLocalStorage, FakeSafeStorage, FakeSecretStorage, RECORDED } from './support/fake-app';
import { CONNECTION_ID, FakeEdge, PAIRED } from './support/fake-edge';
import { TestVault } from './support/test-vault';

const SECRETS = [PAIRED.credential, PAIRED.refresh_token, PAIRED.device_secret];

interface App {
  readonly secretStorage: FakeSecretStorage;
  readonly localStorage: FakeLocalStorage;
  readonly safeStorage: FakeSafeStorage;
}

function app(): App {
  return { secretStorage: new FakeSecretStorage(), localStorage: new FakeLocalStorage(), safeStorage: new FakeSafeStorage() };
}

/** Each platform that design D5 names, and where the credential must be after the run. */
const PLATFORMS = [
  {
    name: 'app.secretStorage (desktop, Obsidian 1.11.4 and later)',
    environment: (a: App): CredentialEnvironment => ({
      secretStorage: a.secretStorage,
      safeStorage: () => a.safeStorage,
      localStorage: a.localStorage,
    }),
    kept: (a: App): string => a.secretStorage.listSecrets().map((id) => a.secretStorage.getSecret(id)).join('\n'),
  },
  {
    name: 'remote.safeStorage (desktop, an older app)',
    environment: (a: App): CredentialEnvironment => ({ safeStorage: () => a.safeStorage, localStorage: a.localStorage }),
    kept: (a: App): string =>
      [...a.localStorage.values.values()]
        .map((value) => a.safeStorage.decryptString(Buffer.from(String(value), 'base64')))
        .join('\n'),
  },
  {
    name: 'memory only (no protected storage)',
    environment: (a: App): CredentialEnvironment => ({ localStorage: a.localStorage }),
    kept: (): string => '',
  },
];

let vault: TestVault | undefined;

afterEach(() => {
  vault?.remove();
  vault = undefined;
});

async function pairConnectAndSend(environment: CredentialEnvironment): Promise<{ edge: FakeEdge; vault: TestVault }> {
  vault = new TestVault();
  vault.write('Notes/First.md', '# First\n');
  const edge = new FakeEdge();
  const options = {
    host: vault,
    transport: edge.transport,
    vault,
    vaultKey: '0cff636eba77cae6',
    vaultName: 'Test vault',
    deviceName: 'Test device',
    credentials: environment,
  };
  const core = await RatatoskrCore.open(options);
  await core.pair('PAIR-0001');
  await core.connect();
  await core.accept({ name: 'create', path: 'Notes/First.md', isFolder: false, at: 1_000 });
  await core.flush(10_000);
  return { edge, vault };
}

describe.each(PLATFORMS)('with $name', (platform) => {
  it('credential_never_written_to_data_json', async () => {
    const a = app();
    const run = await pairConnectAndSend(platform.environment(a));

    expect(run.edge.batches).toHaveLength(1);
    const [batch] = run.edge.sent(`/v1/notes/connections/${CONNECTION_ID}/changes`);
    expect(batch?.headers['Authorization']).toBe(`Bearer ${PAIRED.credential}`);
    for (const secret of SECRETS) {
      expect(run.vault.filesContaining(secret)).toEqual([]);
    }
    for (const secret of SECRETS) {
      expect(platform.kept(a).includes(secret)).toBe(platform.name.startsWith('memory') ? false : true);
    }
    expect(JSON.stringify([...a.localStorage.values.values()])).not.toContain(PAIRED.credential);
  });
});

describe('the recorded desktop app', () => {
  it('offers the methods that the plugin calls on app.secretStorage', () => {
    for (const method of ['setSecret', 'getSecret', 'listSecrets']) {
      expect(RECORDED.secretStorage.protoMethods).toContain(method);
    }
  });
});
