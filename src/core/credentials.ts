// The device credential and the stores that the app offers for it (spike 3.5, design D5).

/** What pairing returns and what a later session needs. All of it is secret. */
export interface DeviceCredential {
  readonly device_id: string;
  readonly device_secret: string;
  readonly credential: string;
  readonly expires_at: string;
  readonly refresh_token: string;
  readonly refresh_expires_at: string;
  /** The Edge origin at pairing. The plugin sends the credential to no other origin. */
  readonly edge_origin: string;
}

/** `app.secretStorage` of Obsidian 1.11.4 and later. */
export interface SecretStorageLike {
  setSecret(id: string, secret: string): void;
  getSecret(id: string): string | null;
  listSecrets(): string[];
}

/** Electron `safeStorage`, reached through `@electron/remote` in the renderer. */
export interface SafeStorageLike {
  isEncryptionAvailable(): boolean;
  encryptString(text: string): Uint8Array;
  decryptString(cipher: Uint8Array): string;
}

/** `app.loadLocalStorage` and `app.saveLocalStorage`: the local storage of the app profile. */
export interface LocalStorageLike {
  loadLocalStorage(key: string): unknown;
  saveLocalStorage(key: string, data: unknown): void;
}

/** What the running app offers. A missing member means that the app does not have it. */
export interface CredentialEnvironment {
  readonly secretStorage?: SecretStorageLike;
  readonly safeStorage?: () => SafeStorageLike | undefined;
  readonly localStorage?: LocalStorageLike;
}
