import { describe, expect, it } from 'vitest';
import { Batcher, DeviceSequence } from '../src/core/batcher';
import { FakeVault, factsOf } from './support/fake-vault';
import { first, recorded } from './support/recording';

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

  it('a folder rename moves each file once', async () => {
    // Recorded: one rename for the folder, then one rename per file, then a link rewrite.
    const events = recorded('api:rename-folder-3-notes');
    const vault = new FakeVault({
      'Events/Folder3 Renamed/One.md': 'one\n',
      'Events/Folder3 Renamed/Two.md': 'two\n',
      'Events/Folder3 Renamed/Three.md': 'three\n',
      'Events/Linker.md': '[[One]] [[Two]] [[Three]]\n',
    });
    const batcher = new Batcher({ facts: vault.facts, sequence: new DeviceSequence(1) });

    const changes = batcher.take(await replay(batcher, events));

    const renamed = changes.filter((change) => change.kind === 'renamed');
    expect(renamed.map((change) => [change.old_path, change.path])).toEqual([
      ['Events/Folder3/One.md', 'Events/Folder3 Renamed/One.md'],
      ['Events/Folder3/Three.md', 'Events/Folder3 Renamed/Three.md'],
      ['Events/Folder3/Two.md', 'Events/Folder3 Renamed/Two.md'],
    ]);
    expect(changes.some((change) => change.path === 'Events/Folder3 Renamed')).toBe(false);
    expect(changes.map((change) => change.sequence)).toEqual([1, 2, 3, 4]);
  });

  it('an outside rename is paired by hash', async () => {
    // Recorded: an edit in another app, then a rename in Finder: create, and delete 988 ms later.
    const events = [...recorded('fs:modify'), ...recorded('fs:rename')];
    const text = 'edited outside\n';
    const vault = new FakeVault({ 'Events/external.md': text });
    const batcher = new Batcher({ facts: vault.facts, sequence: new DeviceSequence(1) });
    await batcher.accept(first(events));
    vault.files.delete('Events/external.md');
    vault.files.set('Events/external-renamed.md', text);

    const changes = batcher.take(await replay(batcher, events.slice(1)));

    expect(events.map((event) => event.name)).toEqual(['modify', 'create', 'delete']);
    expect(changes).toEqual([
      { sequence: 1, kind: 'updated', path: 'Events/external.md', sha256: factsOf(text).sha256, length_bytes: factsOf(text).length },
      {
        sequence: 2,
        kind: 'renamed',
        path: 'Events/external-renamed.md',
        old_path: 'Events/external.md',
        sha256: factsOf(text).sha256,
        length_bytes: factsOf(text).length,
      },
    ]);
  });

  it('a path is sent in NFC', async () => {
    const recordedCreate = first(recorded('api:create-nfd'));
    const nfc = recordedCreate.path;
    const nfd = nfc.normalize('NFD');
    const vault = new FakeVault({ [nfd]: 'accents\n' });
    const batcher = new Batcher({ facts: vault.facts, sequence: new DeviceSequence(7) });
    await batcher.accept({ ...recordedCreate, path: nfd });

    const changes = batcher.take(recordedCreate.at + PAIRING_WINDOW_MS + 1);

    expect(nfd).not.toBe(nfc);
    expect(changes.map((change) => [change.sequence, change.kind, change.path])).toEqual([[7, 'created', nfc]]);
  });
});
