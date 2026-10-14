import { EdgeClient } from '../api/edge';
import { EdgeError, type Transport } from '../api/http';
import { MAX_BATCH_CHANGES, NOTES_CODES } from '../api/notes';
import { Batcher, DeviceSequence } from './batcher';
import { Channel, StaleBytesError } from './channel';
import { chooseCredentialStore } from './credential-store';
import type { CredentialEnvironment } from './credentials';
import { DeviceSession } from './session';
import { loadState, type DataHost, type PluginState } from './state';
import { statusText } from './status';
import type { VaultEvent, VaultReader } from './types';

export type { VaultReader } from './types';

export interface CoreOptions {
  readonly host: DataHost;
  /** `null`: this app cannot send safely (a desktop app without the Node clients). Nothing is sent. */
  readonly transport: Transport | null;
  readonly vault: VaultReader;
  /** The vault id of Obsidian (`app.appId`) and the vault name. */
  readonly vaultKey: string;
  readonly vaultName: string;
  readonly deviceName: string;
  readonly credentials: CredentialEnvironment;
  /** The origin of the saved Edge address, `https://host[:port]`. It throws for an invalid one. */
  readonly edgeOrigin: () => string;
}

/** The plugin without Obsidian: pairing, connect, manifest, uploads and change batches. */
export class RatatoskrCore {
  readonly #options: CoreOptions;
  readonly #edge: EdgeClient;
  readonly #session: DeviceSession;
  readonly #state: PluginState;
  readonly #sequence: DeviceSequence;
  readonly #batcher: Batcher;
  #channel: Channel | null = null;
  #error: string | null = null;
  /** The events run one after the other, in the order that the vault reported them. */
  #events: Promise<void> = Promise.resolve();

  private constructor(options: CoreOptions, state: PluginState) {
    this.#options = options;
    this.#edge = new EdgeClient(options.transport ?? refuseEveryRequest);
    this.#session = new DeviceSession({
      edge: this.#edge,
      store: chooseCredentialStore(options.credentials),
      currentOrigin: options.edgeOrigin,
    });
    this.#state = state;
    this.#sequence = new DeviceSequence(state.nextSequence);
    const known = new Map(Object.entries(state.known));
    this.#batcher = new Batcher({ facts: (path) => options.vault.facts(path), sequence: this.#sequence, known });
  }

  /**
   * Opens the core at each start. The vault can have changed while the plugin was disabled, and no
   * event reports that, so a connected core sends a manifest before its next batch (design D5).
   */
  static async open(options: CoreOptions): Promise<RatatoskrCore> {
    const state = await loadState(options.host);
    state.needsManifest ||= state.connectionId !== null;
    return new RatatoskrCore(options, state);
  }

  get status(): string {
    const memoryOnly = this.#session.storeKind === 'memory';
    const paired = this.#session.paired;
    const olderCredential = paired && !this.#session.hasOrigin;
    const originChanged = paired && !olderCredential && !this.#session.originMatches;
    const facts = { paired, memoryOnly, olderCredential, originChanged, updateObsidian: this.#options.transport === null };
    return statusText({ ...facts, state: this.#state, error: this.#error });
  }

  /** Pairs as a new device. A connection of an earlier device is not used again. */
  async pair(code: string): Promise<void> {
    await this.#session.pair({ code, deviceName: this.#options.deviceName });
    Object.assign(this.#state, { connectionId: null, blocked: null, outbox: [] });
    this.#channel = null;
    await this.#save();
  }

  /** Forgets the device credential and the connection of this device. */
  async unpair(): Promise<void> {
    this.#session.forget();
    Object.assign(this.#state, { connectionId: null, blocked: null, outbox: [], needsManifest: false });
    this.#channel = null;
    this.#error = null;
    await this.#save();
  }

  /** Connects the vault with `channel = plugin`, or becomes status-only when another channel has it. */
  async connect(): Promise<void> {
    const body = { channel: 'plugin', vault_key: this.#options.vaultKey, vault_display_name: this.#options.vaultName } as const;
    try {
      const accepted = await this.#session.call((auth) => this.#edge.connect({ auth, body }));
      this.#adopt(accepted.connection_id);
    } catch (error) {
      if (isMismatch(error)) {
        this.#stop();
        await this.#save();
        return;
      }
      if (!(error instanceof EdgeError) || error.code !== NOTES_CODES.vaultAlreadyConnected) {
        throw error;
      }
      const channel = error.envelope['channel'];
      const existing = error.envelope['connection_id'];
      if (channel === 'plugin' && typeof existing === 'string') {
        // A plugin connection of this vault. The notes service refuses it if another device owns it.
        this.#adopt(existing);
      } else {
        Object.assign(this.#state, { connectionId: null, blocked: channel === 'cli' ? 'cli' : 'sync', outbox: [] });
      }
    }
    await this.#save();
    await this.#run(() => this.#reconcileIfNeeded());
  }

  /** Queues one vault event behind the earlier ones. It never rejects. */
  accept(event: VaultEvent): Promise<void> {
    this.#events = this.#events.then(async () => {
      if (this.#state.blocked !== null) {
        return;
      }
      try {
        await this.#batcher.accept(event);
      } catch {
        // The file is gone or cannot be read. Only a manifest can describe the vault now.
        this.#state.needsManifest = true;
      }
    });
    return this.#events;
  }

  /** Releases the ready changes and sends the outbox. `now` is the injected clock. */
  async flush(now: number): Promise<void> {
    await this.#events;
    if (this.#state.blocked !== null) {
      return;
    }
    this.#state.outbox.push(...this.#batcher.take(now));
    await this.#run(async () => {
      await this.#reconcileIfNeeded();
      await this.#sendOutbox();
    });
  }

  #adopt(connectionId: string): void {
    Object.assign(this.#state, { connectionId, blocked: null, needsManifest: true });
    this.#channel = null;
  }

  #currentChannel(): Channel | null {
    const connectionId = this.#state.connectionId;
    // Checked before the reconcile lists and hashes the vault: a call that cannot be sent reads nothing.
    const canSend = this.#options.transport !== null && this.#session.paired && this.#session.originMatches;
    if (connectionId === null || !canSend) {
      return null;
    }
    this.#channel ??= new Channel({ edge: this.#edge, session: this.#session, vault: this.#options.vault, connectionId });
    return this.#channel;
  }

  async #sendOutbox(): Promise<void> {
    const channel = this.#currentChannel();
    while (channel !== null && this.#state.blocked === null && this.#state.outbox.length > 0) {
      await this.#sendBatch(channel);
    }
  }

  async #sendBatch(channel: Channel): Promise<void> {
    const changes = this.#state.outbox.slice(0, MAX_BATCH_CHANGES);
    const outcome = await channel.send(changes);
    if (outcome.kind === 'mismatch') {
      this.#stop();
      return;
    }
    const waiting = this.#state.outbox.length;
    this.#commit(outcome.committed);
    // A gap, or a committed sequence that this device never gave: the plugin lost changes.
    if (outcome.kind === 'gap' || outcome.committed >= this.#sequence.next) {
      this.#state.needsManifest = true;
      await this.#reconcileIfNeeded();
    } else if (this.#state.outbox.length === waiting) {
      throw new Error('the notes service committed no change of the batch');
    }
  }

  async #reconcileIfNeeded(): Promise<void> {
    const channel = this.#currentChannel();
    if (channel === null || !this.#state.needsManifest || this.#state.blocked !== null) {
      return;
    }
    const answer = await channel.reconcile();
    this.#batcher.replaceKnown(answer.known);
    this.#commit(Math.max(this.#state.committedSequence, answer.committed ?? 0));
    // The manifest describes the vault now, so the changes that wait are already in it.
    this.#state.outbox = [];
    this.#sequence.resume(this.#state.committedSequence);
    this.#state.needsManifest = false;
  }

  /** `notes.channel_mismatch` on any route: another device owns the connection. Stop sending. */
  #stop(): void {
    Object.assign(this.#state, { blocked: 'channel_mismatch', outbox: [] });
  }

  #commit(committed: number): void {
    this.#state.committedSequence = committed;
    this.#state.outbox = this.#state.outbox.filter((change) => change.sequence > committed);
  }

  /** Runs a step, keeps its failure for the status line, and saves the state in every case. */
  async #run(step: () => Promise<void>): Promise<void> {
    try {
      await step();
      this.#error = null;
    } catch (error) {
      if (error instanceof StaleBytesError) {
        this.#state.needsManifest = true;
      }
      if (isMismatch(error)) {
        this.#stop();
      }
      this.#error = error instanceof Error ? error.message : String(error);
    } finally {
      await this.#save();
    }
  }

  async #save(): Promise<void> {
    this.#state.nextSequence = this.#sequence.next;
    this.#state.known = Object.fromEntries(this.#batcher.known);
    await this.#options.host.saveData(this.#state);
  }
}

/** The transport of an app that cannot send safely. It sends nothing. */
const refuseEveryRequest: Transport = () => Promise.reject(new Error('Update Obsidian. This version cannot send safely.'));

function isMismatch(error: unknown): boolean {
  return error instanceof EdgeError && error.code === NOTES_CODES.channelMismatch;
}
