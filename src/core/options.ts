import type { Transport } from '../api/http';
import type { CredentialEnvironment } from './credentials';
import type { DataHost } from './state';
import type { VaultApp, VaultReader } from './types';

/** What the core receives from the app. */
export interface CoreOptions {
  readonly host: DataHost;
  /** `null`: this app cannot send safely (a desktop app without the Node clients). Nothing is sent. */
  readonly transport: Transport | null;
  readonly vault: VaultReader;
  /** The vault API that applies the writes of Ratatoskr. Absent: the plugin does not read the device queue. */
  readonly app?: VaultApp;
  /** The vault id of Obsidian (`app.appId`) and the vault name. */
  readonly vaultKey: string;
  readonly vaultName: string;
  readonly deviceName: string;
  readonly credentials: CredentialEnvironment;
  /** The origin of the saved Edge address, `https://host[:port]`. It throws for an invalid one. */
  readonly edgeOrigin: () => string;
}
