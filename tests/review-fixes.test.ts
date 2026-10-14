import { describe, expect, it } from 'vitest';
import { Batcher, DeviceSequence } from '../src/core/batcher';
import { chooseCredentialStore } from '../src/core/credential-store';
import type { DeviceCredential } from '../src/core/credentials';
import { FakeSecretStorage, RECORDED } from './support/fake-app';
import { PAIRED } from './support/fake-edge';
import { FakeVault, factsOf } from './support/fake-vault';

/** `app.secretStorage` with `deleteSecret`, which spike 3.5 found on the prototype. */
class DeletingSecretStorage extends FakeSecretStorage {
  deleteSecret(id: string): void {
    this.secrets.delete(id);
  }
}

describe('clearing the credential (review finding L4)', () => {
  it('removes the secret with deleteSecret where the app has it', () => {
    expect(RECORDED.secretStorage.protoMethods).toContain('deleteSecret');
    const storage = new DeletingSecretStorage();
    const store = chooseCredentialStore({ secretStorage: storage });
    const device: DeviceCredential = { ...PAIRED, edge_origin: 'https://edge.example' };
    store.save(device);

    store.clear();

    expect(storage.listSecrets()).toEqual([]);
  });
});

describe('pairing empty files (review finding L5)', () => {
  async function replay(paths: { created: string; deleted: string }) {
    const vault = new FakeVault({ [paths.created]: '' });
    const known = new Map([[paths.deleted, factsOf('')]]);
    const batcher = new Batcher({ facts: vault.facts, sequence: new DeviceSequence(1), known });
    await batcher.accept({ name: 'create', path: paths.created, isFolder: false, at: 1_000 });
    await batcher.accept({ name: 'delete', path: paths.deleted, isFolder: false, at: 2_000 });
    return batcher.take(10_000).map((change) => change.kind);
  }

  it('does not pair two empty files with other names by hash alone', async () => {
    expect(await replay({ created: 'A/empty.md', deleted: 'B/other.md' })).toEqual(['created', 'deleted']);
  });

  it('pairs two empty files with the same name', async () => {
    expect(await replay({ created: 'A/same.md', deleted: 'B/same.md' })).toEqual(['renamed']);
  });
});
