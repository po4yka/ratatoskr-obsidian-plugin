import type {
  CredentialEnvironment,
  DeviceCredential,
  LocalStorageLike,
  SafeStorageLike,
  SecretStorageLike,
} from './credentials';

/** Where the device credential is kept. Every store is outside the vault folder. */
export interface CredentialStore {
  readonly kind: 'secret-storage' | 'safe-storage' | 'memory';
  load(): DeviceCredential | null;
  save(credential: DeviceCredential): void;
  clear(): void;
}

/** The id in `app.secretStorage` (lowercase letters, digits and dashes) and the local storage key. */
export const CREDENTIAL_ID = 'ratatoskr-device-credential';

function parse(text: string | null): DeviceCredential | null {
  if (text === null || text === '') {
    return null;
  }
  try {
    return JSON.parse(text) as DeviceCredential;
  } catch {
    return null;
  }
}

/** `app.secretStorage`: encrypted with Electron `safeStorage` into the app profile, per vault. */
class SecretStorageStore implements CredentialStore {
  readonly kind = 'secret-storage';

  constructor(private readonly storage: SecretStorageLike) {}

  load(): DeviceCredential | null {
    return parse(this.storage.getSecret(CREDENTIAL_ID));
  }

  save(credential: DeviceCredential): void {
    this.storage.setSecret(CREDENTIAL_ID, JSON.stringify(credential));
  }

  clear(): void {
    if (typeof this.storage.deleteSecret === 'function') {
      this.storage.deleteSecret(CREDENTIAL_ID);
    } else {
      this.storage.setSecret(CREDENTIAL_ID, '');
    }
  }
}

/** `remote.safeStorage` ciphertext, kept with `saveLocalStorage` in the app profile. */
class SafeStorageStore implements CredentialStore {
  readonly kind = 'safe-storage';

  constructor(private readonly stores: { safe: SafeStorageLike; local: LocalStorageLike }) {}

  load(): DeviceCredential | null {
    const stored = this.stores.local.loadLocalStorage(CREDENTIAL_ID);
    if (typeof stored !== 'string') {
      return null;
    }
    try {
      return parse(this.stores.safe.decryptString(fromBase64(stored)));
    } catch {
      return null;
    }
  }

  save(credential: DeviceCredential): void {
    const cipher = this.stores.safe.encryptString(JSON.stringify(credential));
    this.stores.local.saveLocalStorage(CREDENTIAL_ID, toBase64(cipher));
  }

  clear(): void {
    this.stores.local.saveLocalStorage(CREDENTIAL_ID, null);
  }
}

/** No protected storage: the credential lives until the app stops, and the owner pairs again. */
class MemoryStore implements CredentialStore {
  readonly kind = 'memory';
  #credential: DeviceCredential | null = null;

  load(): DeviceCredential | null {
    return this.#credential;
  }

  save(credential: DeviceCredential): void {
    this.#credential = credential;
  }

  clear(): void {
    this.#credential = null;
  }
}

/** Design D5: `app.secretStorage`, then `remote.safeStorage`, then memory. Never `data.json`. */
export function chooseCredentialStore(environment: CredentialEnvironment): CredentialStore {
  if (environment.secretStorage !== undefined) {
    return new SecretStorageStore(environment.secretStorage);
  }
  const safe = safeStorageOf(environment);
  if (safe !== undefined && environment.localStorage !== undefined) {
    return new SafeStorageStore({ safe, local: environment.localStorage });
  }
  return new MemoryStore();
}

function safeStorageOf(environment: CredentialEnvironment): SafeStorageLike | undefined {
  try {
    const safe = environment.safeStorage?.();
    return safe?.isEncryptionAvailable() === true ? safe : undefined;
  } catch {
    return undefined;
  }
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function fromBase64(text: string): Uint8Array {
  return Uint8Array.from(atob(text), (character) => character.charCodeAt(0));
}
