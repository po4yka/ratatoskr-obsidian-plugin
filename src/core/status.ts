import type { PluginState } from './state';

/** The facts that the status line is made of. */
export interface StatusFacts {
  readonly paired: boolean;
  readonly memoryOnly: boolean;
  readonly state: PluginState;
  readonly error: string | null;
}

const BLOCKED: Record<NonNullable<PluginState['blocked']>, string> = {
  sync:
    'Status only: this vault is connected through Obsidian Sync, and Ratatoskr reads it from there. ' +
    'The plugin sends no changes.',
  cli: 'Status only: this vault is connected through the Ratatoskr export agent. The plugin sends no changes.',
  channel_mismatch:
    'Stopped: this vault is connected to Ratatoskr from another device. ' +
    'Use Obsidian Sync to share a vault between devices.',
};

/** One line for the status bar and the settings tab. It names no credential and no content. */
export function statusText(facts: StatusFacts): string {
  const line = mainLine(facts);
  const memory = facts.paired && facts.memoryOnly ? ' The credential is in memory only: pair again after a restart.' : '';
  const error = facts.error === null ? '' : ` Last error: ${facts.error}`;
  return `${line}${memory}${error}`;
}

function mainLine(facts: StatusFacts): string {
  const { state } = facts;
  if (state.blocked !== null) {
    return BLOCKED[state.blocked];
  }
  if (!facts.paired) {
    return 'Not paired. Enter a pairing code in the settings.';
  }
  if (state.connectionId === null) {
    return 'Paired. Connect the vault in the settings.';
  }
  const waiting = state.outbox.length;
  return waiting === 0 ? 'Connected. Up to date.' : `Connected. ${waiting} changes wait.`;
}
