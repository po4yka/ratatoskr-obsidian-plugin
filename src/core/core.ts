import { DEVICE_KIND, EdgeClient } from '../api/edge';
import { EdgeError, type Transport } from '../api/http';
import { MAX_BATCH_CHANGES } from '../api/notes';
import { Batcher, DeviceSequence } from './batcher';
import { chooseCredentialStore, type CredentialStore } from './credential-store';
import type { CredentialEnvironment, DeviceCredential } from './credentials';
import { loadState, type DataHost, type PluginState } from './state';
import type { FileFacts, VaultEvent } from './types';

/** The vault API, as the core needs it. Paths are the paths that the vault events name. */
export interface VaultReader {
  facts(path: string): Promise<FileFacts>;
  read(path: string): Promise<Uint8Array>;
  list(): Promise<string[]>;
}

export interface CoreOptions {
  readonly host: DataHost;
  readonly transport: Transport;
  readonly vault: VaultReader;
  /** The vault id of Obsidian (`app.appId`) and the vault name. */
  readonly vaultKey: string;
  readonly vaultName: string;
  readonly deviceName: string;
  readonly credentials: CredentialEnvironment;
}

const CONNECT_ATTEMPTS = 3;

/** The plugin without Obsidian: pairing, connect, and the sending of changes. */
export class RatatoskrCore {
  readonly #options: CoreOptions;
  readonly #edge: EdgeClient;
  readonly #state: PluginState;
  readonly #sequence: DeviceSequence;
  readonly #batcher: Batcher;
  readonly #store: CredentialStore;
  #device: DeviceCredential | null;

  private constructor(options: CoreOptions, state: PluginState) {
    this.#options = options;
    this.#store = chooseCredentialStore(options.credentials);
    this.#device = this.#store.load();
    this.#edge = new EdgeClient(options.transport);
    this.#state = state;
    this.#sequence = new DeviceSequence(state.nextSequence);
    this.#batcher = new Batcher({
      facts: (path) => options.vault.facts(path),
      sequence: this.#sequence,
      known: new Map(Object.entries(state.known)),
    });
  }

  static async open(options: CoreOptions): Promise<RatatoskrCore> {
    return new RatatoskrCore(options, await loadState(options.host));
  }

  get status(): string {
    if (this.#device === null) {
      return 'not paired';
    }
    return this.#state.connectionId === null ? 'paired' : 'connected';
  }

  async pair(code: string): Promise<void> {
    const paired = await this.#edge.pair({ code, kind: DEVICE_KIND, display_name: this.#options.deviceName });
    this.#device = paired;
    this.#store.save(paired);
  }

  async connect(): Promise<void> {
    const credential = this.#credential();
    const body = { channel: 'plugin', vault_key: this.#options.vaultKey, vault_display_name: this.#options.vaultName } as const;
    for (let attempt = 1; attempt <= CONNECT_ATTEMPTS; attempt += 1) {
      try {
        this.#state.connectionId = (await this.#edge.connect({ credential, body })).connection_id;
        break;
      } catch (error) {
        const known = error instanceof EdgeError ? error.envelope['connection_id'] : undefined;
        if (attempt === CONNECT_ATTEMPTS && typeof known === 'string') {
          this.#state.connectionId = known;
        }
      }
    }
    await this.#save();
  }

  async accept(event: VaultEvent): Promise<void> {
    await this.#batcher.accept(event);
  }

  /** Releases the ready changes and sends the outbox. `now` is the injected clock. */
  async flush(now: number): Promise<void> {
    this.#state.outbox.push(...this.#batcher.take(now));
    this.#state.nextSequence = this.#sequence.next;
    this.#state.known = Object.fromEntries(this.#batcher.known);
    const connectionId = this.#state.connectionId;
    while (connectionId !== null && this.#state.outbox.length > 0) {
      const changes = this.#state.outbox.slice(0, MAX_BATCH_CHANGES);
      const answer = await this.#edge.sendChanges({ credential: this.#credential(), connectionId, body: { changes } });
      this.#state.committedSequence = answer.committed_sequence;
      this.#state.outbox = this.#state.outbox.filter((change) => change.sequence > answer.committed_sequence);
    }
    await this.#save();
  }

  #credential(): string {
    if (this.#device === null) {
      throw new Error('the plugin is not paired');
    }
    return this.#device.credential;
  }

  async #save(): Promise<void> {
    await this.#options.host.saveData(this.#state);
  }
}
