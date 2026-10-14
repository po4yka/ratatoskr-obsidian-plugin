import { Notice, Plugin, requestUrl, TAbstractFile, TFolder, type App } from 'obsidian';
import type { HttpResponse, Transport } from './api/http';
import { nodeClients, nodeTransport } from './api/node-transport';
import { RatatoskrCore } from './core/core';
import { edgeOrigin } from './core/edge-address';
import type { CredentialEnvironment, SafeStorageLike, SecretStorageLike } from './core/credentials';
import { factsOfBytes } from './core/hash';
import type { DataHost } from './core/state';
import type { VaultEvent, VaultReader } from './core/types';
import { RatatoskrSettingTab } from './settings';

/** The settings that the owner enters. `data.json` keeps them beside the core state. */
export interface Settings {
  edgeUrl: string;
  deviceName: string;
}

interface Stored {
  settings?: Partial<Settings>;
  state?: unknown;
}

const FLUSH_INTERVAL_MS = 5_000;

// The entry point that Obsidian loads. It stays a thin adapter: the behaviour is in `src/core/`,
// which does not import `obsidian` at run time, so the tests run it without the app.
export default class RatatoskrPlugin extends Plugin {
  config: Settings = { edgeUrl: '', deviceName: 'Obsidian' };
  core: RatatoskrCore | null = null;
  #stored: Stored = {};
  #statusBar: HTMLElement | null = null;

  override async onload(): Promise<void> {
    this.#stored = ((await this.loadData()) as Stored | null) ?? {};
    this.config = { ...this.config, ...this.#stored.settings };
    this.#statusBar = this.addStatusBarItem();
    this.addSettingTab(new RatatoskrSettingTab(this.app, this));
    // The vault reports a `create` for every file while it loads. Listen only after that.
    this.app.workspace.onLayoutReady(() => void this.#start());
  }

  async saveSettings(settings: Settings): Promise<void> {
    try {
      edgeOrigin(settings.edgeUrl);
    } catch (error) {
      new Notice(`Ratatoskr: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    Object.assign(this.config, settings);
    this.#stored.settings = this.config;
    await this.saveData(this.#stored);
    await this.#start();
  }

  refreshStatus(): void {
    this.#statusBar?.setText(`Ratatoskr: ${this.core?.status ?? 'enter the Edge address in the settings.'}`);
  }

  async run(step: (core: RatatoskrCore) => Promise<void>): Promise<void> {
    if (this.core === null) {
      new Notice('Ratatoskr: enter the Edge address first.');
      return;
    }
    try {
      await step(this.core);
    } catch (error) {
      new Notice(`Ratatoskr: ${error instanceof Error ? error.message : String(error)}`);
    }
    this.refreshStatus();
  }

  async #start(): Promise<void> {
    if (this.config.edgeUrl === '' || this.core !== null) {
      this.refreshStatus();
      return;
    }
    const config = this.config;
    this.core = await RatatoskrCore.open({
      host: this.#stateHost(),
      transport: desktopOrMobileTransport(),
      // The saved address only. The core sends no secret when its origin is not the paired one.
      edgeOrigin: () => edgeOrigin(config.edgeUrl),
      get deviceName() {
        return config.deviceName;
      },
      vault: vaultReader(this.app),
      vaultKey: (this.app as App & { appId?: string }).appId ?? this.app.vault.getName(),
      vaultName: this.app.vault.getName(),
      credentials: credentialEnvironment(this.app),
    });
    const forward = (name: VaultEvent['name']) => (file: TAbstractFile, oldPath?: string) =>
      void this.core?.accept({
        name,
        path: file.path,
        ...(oldPath === undefined ? {} : { oldPath }),
        isFolder: file instanceof TFolder,
        at: Date.now(),
      });
    for (const name of ['create', 'modify', 'delete', 'rename'] as const) {
      // Each name has its own overload in the typings; the handler shape is the same.
      this.registerEvent(this.app.vault.on(name as 'rename', forward(name)));
    }
    this.registerInterval(window.setInterval(() => void this.run((core) => core.flush(Date.now())), FLUSH_INTERVAL_MS));
    // At each start, after the layout is ready: the core sends a manifest before anything else.
    await this.run((core) => core.flush(Date.now()));
  }

  #stateHost(): DataHost {
    return {
      loadData: async () => this.#stored.state ?? null,
      saveData: async (state) => {
        this.#stored.state = state;
        await this.saveData(this.#stored);
      },
    };
  }
}

/**
 * The desktop app sends with the Node client, which follows no redirect. Obsidian mobile has no
 * Node, so it uses `requestUrl`, which follows a redirect: see the README for this limit.
 */
function desktopOrMobileTransport(): Transport {
  const clients = nodeClients();
  return clients === undefined ? requestUrlTransport : nodeTransport(clients);
}

/** Sends each request to its own origin, which the core sets; it never reads the settings. */
const requestUrlTransport: Transport = async (request): Promise<HttpResponse> => {
  const origin = edgeOrigin(request.origin);
  const body = typeof request.body === 'string' || request.body === undefined ? request.body : request.body.slice().buffer;
  const response = await requestUrl({ url: `${origin}${request.path}`, method: request.method, headers: { ...request.headers }, ...(body === undefined ? {} : { body }), throw: false });
  return { status: response.status, body: parseJson(response.text) };
};

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function vaultReader(app: App): VaultReader {
  const read = async (path: string): Promise<Uint8Array> => new Uint8Array(await app.vault.adapter.readBinary(path));
  return {
    read,
    facts: async (path) => factsOfBytes(await read(path)),
    list: async () => app.vault.getFiles().map((file) => file.path),
  };
}

/** Design D5: `app.secretStorage`, then `@electron/remote` `safeStorage`, then memory. */
function credentialEnvironment(app: App): CredentialEnvironment {
  const secretStorage = (app as App & { secretStorage?: SecretStorageLike }).secretStorage;
  const load = (globalThis as { require?: (id: string) => unknown }).require;
  return {
    ...(secretStorage === undefined ? {} : { secretStorage }),
    safeStorage: () => (load?.('@electron/remote') as { safeStorage?: SafeStorageLike } | undefined)?.safeStorage,
    localStorage: {
      loadLocalStorage: (key) => app.loadLocalStorage(key) as unknown,
      saveLocalStorage: (key, data) => app.saveLocalStorage(key, data),
    },
  };
}
