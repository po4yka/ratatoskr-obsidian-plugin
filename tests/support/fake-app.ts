import { readFileSync } from 'node:fs';
import type { LocalStorageLike, SafeStorageLike, SecretStorageLike } from '../../src/core/credentials';

interface CredentialRecording {
  readonly secretStorage: { readonly protoMethods: readonly string[] };
  readonly safeStorageCipherPrefix: string;
}

/** What spike 3.5 found on desktop (Obsidian 1.14.4, Electron 34.2.0). */
export const RECORDED: CredentialRecording = JSON.parse(
  readFileSync('tests/fixtures/spike-obsidian-1.14.4/credentials.json', 'utf8'),
) as CredentialRecording;

/** `app.secretStorage`: a map in memory, outside the vault folder, with the recorded methods. */
export class FakeSecretStorage implements SecretStorageLike {
  readonly secrets = new Map<string, string>();

  setSecret(id: string, secret: string): void {
    if (!/^[a-z0-9-]+$/.test(id)) {
      throw new Error(`invalid secret id ${id}`);
    }
    this.secrets.set(id, secret);
  }

  getSecret(id: string): string | null {
    return this.secrets.get(id) ?? null;
  }

  listSecrets(): string[] {
    return [...this.secrets.keys()];
  }
}

/** Electron `safeStorage`: a reversible transform with the recorded `v10` prefix. */
export class FakeSafeStorage implements SafeStorageLike {
  isEncryptionAvailable(): boolean {
    return true;
  }

  encryptString(text: string): Uint8Array {
    const body = Buffer.from(text, 'utf8').map((byte) => byte ^ 0x5a);
    return Buffer.concat([Buffer.from(RECORDED.safeStorageCipherPrefix, 'latin1'), body]);
  }

  decryptString(cipher: Uint8Array): string {
    const body = Buffer.from(cipher).subarray(RECORDED.safeStorageCipherPrefix.length);
    return Buffer.from(body.map((byte) => byte ^ 0x5a)).toString('utf8');
  }
}

/** `app.loadLocalStorage` and `app.saveLocalStorage`: the app profile, outside the vault folder. */
export class FakeLocalStorage implements LocalStorageLike {
  readonly values = new Map<string, unknown>();

  loadLocalStorage(key: string): unknown {
    return this.values.get(key) ?? null;
  }

  saveLocalStorage(key: string, data: unknown): void {
    if (data === null) {
      this.values.delete(key);
    } else {
      this.values.set(key, data);
    }
  }
}
