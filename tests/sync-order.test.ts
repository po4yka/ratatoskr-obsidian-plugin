import { afterEach, describe, expect, it } from 'vitest';
import type { FileFacts, VaultReader } from '../src/core/types';
import { CONNECTION_ID, FakeEdge } from './support/fake-edge';
import { startPlugin, type Running } from './support/plugin';
import type { TestVault } from './support/test-vault';

let running: Running | undefined;

afterEach(() => {
  running?.vault.remove();
  running = undefined;
});

/** A vault reader whose read of one path waits until the test opens the gate. */
class GatedReader implements VaultReader {
  slowPath: string | null = null;
  #open: () => void = () => undefined;
  readonly #gate = new Promise<void>((resolve) => (this.#open = resolve));

  constructor(private readonly vault: TestVault) {}

  open(): void {
    this.#open();
  }

  async facts(path: string): Promise<FileFacts> {
    if (path === this.slowPath) {
      await this.#gate;
    }
    return this.vault.facts(path);
  }

  read(path: string): Promise<Uint8Array> {
    return this.vault.read(path);
  }

  list(): Promise<string[]> {
    return this.vault.list();
  }
}

describe('the order of the events', () => {
  it('events keep their order when a read is slow', async () => {
    const edge = new FakeEdge();
    let reader: GatedReader | undefined;
    running = await startPlugin(edge, {
      files: { 'Notes/A.md': 'a\n', 'Notes/B.md': 'b\n' },
      reader: (vault) => (reader = new GatedReader(vault)),
    });
    running.vault.write('Notes/A.md', 'a, edited\n');
    if (reader === undefined) {
      throw new Error('the reader was not made');
    }
    reader.slowPath = 'Notes/A.md';

    const modified = running.core.accept({ name: 'modify', path: 'Notes/A.md', isFolder: false, at: 1_000 });
    const deleted = running.core.accept({ name: 'delete', path: 'Notes/B.md', isFolder: false, at: 1_001 });
    reader.open();
    await Promise.all([modified, deleted]);
    await running.core.flush(20_000);

    expect(edge.batches.flat().map((change) => [change.kind, change.path])).toEqual([
      ['updated', 'Notes/A.md'],
      ['deleted', 'Notes/B.md'],
    ]);
  });

  it('a file that is gone asks for a manifest', async () => {
    const edge = new FakeEdge();
    running = await startPlugin(edge);
    const manifests = edge.sent(`/v1/notes/connections/${CONNECTION_ID}/manifest`).length;

    // The file was removed before the plugin could read it.
    const accepted = running.core.accept({ name: 'create', path: 'Notes/Gone.md', isFolder: false, at: 1_000 });

    await expect(accepted).resolves.toBeUndefined();
    await running.core.flush(20_000);
    expect(edge.sent(`/v1/notes/connections/${CONNECTION_ID}/manifest`).length).toBe(manifests + 1);
  });
});
