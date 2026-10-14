import { readFileSync } from 'node:fs';
import type { VaultEvent } from '../../src/core/types';

interface RecordedLine {
  readonly t: number;
  readonly action: string;
  readonly event: string;
  readonly type?: string;
  readonly path?: string;
  readonly oldPath?: string;
}

const lines: RecordedLine[] = readFileSync('tests/fixtures/spike-obsidian-1.14.4/events.jsonl', 'utf8')
  .split('\n')
  .filter((line) => line.trim() !== '')
  .map((line) => JSON.parse(line) as RecordedLine);

/** The vault events that Obsidian 1.14.4 recorded for one action of the spike, in order. */
export function recorded(action: string): VaultEvent[] {
  return lines
    .filter((line) => line.action === action && line.event.startsWith('vault.'))
    .map((line) => ({
      name: line.event.slice('vault.'.length) as VaultEvent['name'],
      path: line.path ?? '',
      ...(line.oldPath === undefined ? {} : { oldPath: line.oldPath }),
      isFolder: line.type === 'folder',
      at: line.t,
    }));
}

/** The first event of a recorded action. A recording without one is a broken fixture. */
export function first(events: readonly VaultEvent[]): VaultEvent {
  const [event] = events;
  if (event === undefined) {
    throw new Error('the recording has no event for this action');
  }
  return event;
}
