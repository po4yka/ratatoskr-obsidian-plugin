import { describe, expect, it } from 'vitest';
import { Batcher, DeviceSequence } from '../src/core/batcher';
import { FakeVault, factsOf } from './support/fake-vault';
import { recorded } from './support/recording';

const PAIRING_WINDOW_MS = 3_000;

async function replay(batcher: Batcher, events: ReturnType<typeof recorded>): Promise<number> {
  for (const event of events) {
    await batcher.accept(event);
  }
  return (events.at(-1)?.at ?? 0) + PAIRING_WINDOW_MS + 1;
}

describe('the batcher', () => {
  it('a rename arrives as one renamed change', async () => {
    // Recorded: a note rename, then the link rewrite in the note that links to it.
    const events = recorded('shortest-path-link');
    const target = '# Shortest\n';
    const linker = 'See [[Shortest Renamed]].\n';
    const vault = new FakeVault({
      'RenameTargets/Shortest Renamed.md': target,
      'RenameSources/Uses Shortest.md': linker,
    });
    const batcher = new Batcher({ facts: vault.facts, sequence: new DeviceSequence(1) });

    const changes = batcher.take(await replay(batcher, events));

    expect(changes.filter((change) => change.kind === 'renamed')).toEqual([
      {
        sequence: 1,
        kind: 'renamed',
        path: 'RenameTargets/Shortest Renamed.md',
        old_path: 'RenameTargets/Shortest.md',
        sha256: factsOf(target).sha256,
        length_bytes: factsOf(target).length,
      },
    ]);
    expect(changes[1]).toEqual({
      sequence: 2,
      kind: 'updated',
      path: 'RenameSources/Uses Shortest.md',
      sha256: factsOf(linker).sha256,
      length_bytes: factsOf(linker).length,
    });
    expect(changes).toHaveLength(2);
  });
});
