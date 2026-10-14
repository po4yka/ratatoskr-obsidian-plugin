import { afterEach, describe, expect, it } from 'vitest';
import type { Change } from '../src/core/types';
import { FakeEdge } from './support/fake-edge';
import { settle, startPlugin, type Running } from './support/plugin';

let running: Running | undefined;

afterEach(() => {
  running?.vault.remove();
  running = undefined;
});

describe('the answers of the notes device channel', () => {
  it('a batch that is too large is split', async () => {
    const edge = new FakeEdge();
    edge.routes.set('POST /v1/notes/connections/{id}/changes', (_request, body) => {
      const changes = body['changes'] as Change[];
      if (changes.length > 2) {
        return {
          status: 413,
          body: { code: 'notes.channel.batch_too_large', message: 'A batch holds at most 2 changes.', retryable: false, max_changes: 2 },
        };
      }
      return { status: 200, body: { committed_sequence: changes.at(-1)?.sequence ?? 0 } };
    });
    running = await startPlugin(edge);

    for (const name of ['A', 'B', 'C', 'D', 'E']) {
      running.vault.write(`Notes/${name}.md`, `${name}\n`);
      await running.core.accept({ name: 'create', path: `Notes/${name}.md`, isFolder: false, at: 1_000 });
    }
    await settle(running.core.flush(20_000));

    const [first, ...rest] = edge.batches;
    expect(first).toHaveLength(5);
    expect(rest.every((batch) => batch.length <= 2)).toBe(true);
    expect(rest.flat().map((change) => change.sequence)).toEqual([1, 2, 3, 4, 5]);
    expect(running.core.status).toMatch(/Up to date/);
  });
});
