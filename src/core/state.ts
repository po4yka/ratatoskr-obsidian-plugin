import type { Change, FileFacts } from './types';

/** `Plugin.loadData` and `Plugin.saveData`. Obsidian writes them to `data.json` in the vault. */
export interface DataHost {
  loadData(): Promise<unknown>;
  saveData(data: unknown): Promise<void>;
}

/**
 * The state that the plugin keeps between two starts, in `data.json`. It holds no secret: the
 * device credential is in a `CredentialStore`.
 */
export interface PluginState {
  connectionId: string | null;
  /** The sequence that the next change gets. */
  nextSequence: number;
  /** The highest sequence that the notes service committed. */
  committedSequence: number;
  /** The released changes that the notes service has not committed yet, in sequence order. */
  outbox: Change[];
  /** The facts of each file that Ratatoskr has, by NFC path. */
  known: Record<string, FileFacts>;
}

export function emptyState(): PluginState {
  return { connectionId: null, nextSequence: 1, committedSequence: 0, outbox: [], known: {} };
}

export async function loadState(host: DataHost): Promise<PluginState> {
  const stored = await host.loadData();
  const fields = typeof stored === 'object' && stored !== null ? (stored as Partial<PluginState>) : {};
  const state = emptyState();
  // Only the known fields are read back, so a field that an earlier build wrote is dropped.
  return {
    connectionId: fields.connectionId ?? state.connectionId,
    nextSequence: fields.nextSequence ?? state.nextSequence,
    committedSequence: fields.committedSequence ?? state.committedSequence,
    outbox: fields.outbox ?? state.outbox,
    known: fields.known ?? state.known,
  };
}
