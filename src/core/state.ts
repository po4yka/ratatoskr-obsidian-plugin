import type { DeviceCredential } from './credentials';
import type { Change, FileFacts } from './types';

/** `Plugin.loadData` and `Plugin.saveData`. Obsidian writes them to `data.json` in the vault. */
export interface DataHost {
  loadData(): Promise<unknown>;
  saveData(data: unknown): Promise<void>;
}

/** The state that the plugin keeps between two starts. */
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
  device: DeviceCredential | null;
}

export function emptyState(): PluginState {
  return { connectionId: null, nextSequence: 1, committedSequence: 0, outbox: [], known: {}, device: null };
}

export async function loadState(host: DataHost): Promise<PluginState> {
  const stored = await host.loadData();
  const fields = typeof stored === 'object' && stored !== null ? (stored as Partial<PluginState>) : {};
  return { ...emptyState(), ...fields };
}
