import { afterEach, describe, expect, it } from 'vitest';
import { platformTransport } from '../src/api/node-transport';
import { RatatoskrCore, type CoreOptions } from '../src/core/core';
import { FakeSecretStorage } from './support/fake-app';
import { FakeEdge } from './support/fake-edge';
import { TestVault } from './support/test-vault';

let vault: TestVault | undefined;

afterEach(() => {
  vault?.remove();
  vault = undefined;
});

function optionsFor(edge: FakeEdge, secretStorage = new FakeSecretStorage()): CoreOptions {
  vault = new TestVault();
  vault.write('Notes/A.md', 'a\n');
  return {
    host: vault,
    transport: edge.transport,
    vault,
    vaultKey: '0cff636eba77cae6',
    vaultName: 'Test vault',
    deviceName: 'Test device',
    edgeOrigin: () => 'https://edge.example',
    credentials: { secretStorage },
  };
}

/** Pairs, connects and sends once, and ignores each failure: the requests are the question. */
async function useEveryRoute(core: RatatoskrCore): Promise<void> {
  await core.pair('PAIR-0001').catch(() => undefined);
  await core.connect().catch(() => undefined);
  await core.accept({ name: 'create', path: 'Notes/A.md', isFolder: false, at: 1_000 });
  await core.flush(20_000).catch(() => undefined);
}

describe('the transport of each platform', () => {
  it('desktop without the Node clients sends no request and asks to update Obsidian', async () => {
    const edge = new FakeEdge();
    const transport = platformTransport({ isMobileApp: false, clients: undefined, requestUrl: edge.transport });
    const core = await RatatoskrCore.open({ ...optionsFor(edge), transport });

    await useEveryRoute(core);

    expect(edge.requests).toEqual([]);
    expect(core.status).toMatch(/update Obsidian/i);
  });

  it('desktop without the Node clients sends no request with a saved credential', async () => {
    const edge = new FakeEdge();
    const secretStorage = new FakeSecretStorage();
    const options = optionsFor(edge, secretStorage);
    const before = await RatatoskrCore.open(options);
    await before.pair('PAIR-0001');
    await before.connect();
    const sent = edge.requests.length;

    const transport = platformTransport({ isMobileApp: false, clients: undefined, requestUrl: edge.transport });
    const core = await RatatoskrCore.open({ ...options, transport });
    await useEveryRoute(core);

    expect(edge.requests.slice(sent)).toEqual([]);
    expect(core.status).toMatch(/update Obsidian/i);
  });

  it('mobile sends with requestUrl, its only transport', async () => {
    const edge = new FakeEdge();
    const transport = platformTransport({ isMobileApp: true, clients: undefined, requestUrl: edge.transport });
    const core = await RatatoskrCore.open({ ...optionsFor(edge), transport });

    await core.pair('PAIR-0001');

    expect(edge.sent('/v1/devices/pair')).toHaveLength(1);
  });
});
