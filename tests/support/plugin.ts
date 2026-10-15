import { RatatoskrCore, type CoreOptions } from '../../src/core/core';
import type { VaultReader } from '../../src/core/types';
import { FakeSecretStorage } from './fake-app';
import type { FakeEdge } from './fake-edge';
import { TestVault } from './test-vault';

/** A paired and connected plugin in a test vault, and the means to start it again. */
export interface Running {
  readonly core: RatatoskrCore;
  readonly vault: TestVault;
  /** Opens a new core on the same vault folder and the same credential store, as a restart does. */
  reopen(): Promise<RatatoskrCore>;
}

export async function startPlugin(
  edge: FakeEdge,
  setup: { files?: Record<string, string>; reader?: (vault: TestVault) => VaultReader; app?: CoreOptions['app'] } = {},
): Promise<Running> {
  const vault = new TestVault();
  for (const [path, text] of Object.entries(setup.files ?? {})) {
    vault.write(path, text);
  }
  const options: CoreOptions = {
    host: vault,
    transport: edge.transport,
    vault: setup.reader?.(vault) ?? vault,
    vaultKey: '0cff636eba77cae6',
    vaultName: 'Test vault',
    deviceName: 'Test device',
    edgeOrigin: () => 'https://edge.example',
    credentials: { secretStorage: new FakeSecretStorage() },
    ...(setup.app === undefined ? {} : { app: setup.app }),
  };
  const core = await RatatoskrCore.open(options);
  await core.pair('PAIR-0001');
  await core.connect();
  return { core, vault, reopen: () => RatatoskrCore.open(options) };
}

/** Runs a step whose failure is not the question of the test. */
export async function settle(step: Promise<void>): Promise<void> {
  await step.catch(() => undefined);
}

export const MISMATCH = {
  status: 409,
  body: { code: 'notes.channel_mismatch', message: 'Use Obsidian Sync to share a vault.', retryable: false },
};
