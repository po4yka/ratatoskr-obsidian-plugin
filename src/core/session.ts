import { DEVICE_KIND, type Auth, type EdgeClient } from '../api/edge';
import { EdgeError } from '../api/http';
import type { CredentialStore } from './credential-store';
import type { DeviceCredential } from './credentials';

/** The saved Edge address is not the origin that issued the credential. */
export class OriginChangedError extends Error {
  override readonly name = 'OriginChangedError';

  constructor() {
    super('The Edge address changed after pairing. Pair again.');
  }
}

/**
 * The paired device and its session. A call that Edge answers with `401` renews the session once
 * (`/v1/sessions/refresh`, then `/v1/sessions/device` with the device secret) and runs again.
 *
 * Every secret goes only to the Edge origin of the pairing. When the saved address has another
 * origin, each authenticated call, the renewal included, stops before it sends anything.
 */
export class DeviceSession {
  readonly #edge: EdgeClient;
  readonly #store: CredentialStore;
  readonly #currentOrigin: () => string;
  #device: DeviceCredential | null;

  constructor(parts: { edge: EdgeClient; store: CredentialStore; currentOrigin: () => string }) {
    this.#edge = parts.edge;
    this.#store = parts.store;
    this.#currentOrigin = parts.currentOrigin;
    this.#device = parts.store.load();
  }

  get paired(): boolean {
    return this.#device !== null;
  }

  get storeKind(): CredentialStore['kind'] {
    return this.#store.kind;
  }

  /** The saved address has the origin of the pairing. A credential without one never matches. */
  get originMatches(): boolean {
    const device = this.#device;
    return device !== null && typeof device.edge_origin === 'string' && device.edge_origin === this.#origin();
  }

  async pair(pairing: { code: string; deviceName: string }): Promise<void> {
    const origin = this.#currentOrigin();
    const body = { code: pairing.code, kind: DEVICE_KIND, display_name: pairing.deviceName };
    const paired = await this.#edge.pair({ origin, body });
    this.#keep({ ...paired, edge_origin: origin });
  }

  forget(): void {
    this.#device = null;
    this.#store.clear();
  }

  async call<T>(run: (auth: Auth) => Promise<T>): Promise<T> {
    try {
      return await run(this.#auth());
    } catch (error) {
      if (!(error instanceof EdgeError) || error.status !== 401) {
        throw error;
      }
    }
    await this.#renew();
    return run(this.#auth());
  }

  async #renew(): Promise<void> {
    const device = this.#checked();
    try {
      const rotated = await this.#edge.refresh({ origin: device.edge_origin, refreshToken: device.refresh_token });
      this.#keep({ ...device, ...rotated });
    } catch (error) {
      if (!(error instanceof EdgeError)) {
        throw error;
      }
      const checked = this.#checked();
      const body = { device_id: checked.device_id, device_secret: checked.device_secret };
      const opened = await this.#edge.openDeviceSession({ origin: checked.edge_origin, body });
      this.#keep({ ...checked, ...opened });
    }
  }

  #auth(): Auth {
    const device = this.#checked();
    return { credential: device.credential, origin: device.edge_origin };
  }

  /** The device, when the saved address still has the origin of the pairing. */
  #checked(): DeviceCredential {
    if (this.#device === null) {
      throw new Error('the plugin is not paired');
    }
    if (!this.originMatches) {
      throw new OriginChangedError();
    }
    return this.#device;
  }

  #origin(): string | null {
    try {
      return this.#currentOrigin();
    } catch {
      return null;
    }
  }

  #keep(device: DeviceCredential): void {
    this.#device = device;
    this.#store.save(device);
  }
}
