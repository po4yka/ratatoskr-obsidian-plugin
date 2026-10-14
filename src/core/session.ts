import { DEVICE_KIND, type EdgeClient } from '../api/edge';
import { EdgeError } from '../api/http';
import type { CredentialStore } from './credential-store';
import type { DeviceCredential } from './credentials';

/**
 * The paired device and its session. A call that Edge answers with `401` renews the session once
 * (`/v1/sessions/refresh`, then `/v1/sessions/device` with the device secret) and runs again.
 */
export class DeviceSession {
  readonly #edge: EdgeClient;
  readonly #store: CredentialStore;
  #device: DeviceCredential | null;

  constructor(parts: { edge: EdgeClient; store: CredentialStore }) {
    this.#edge = parts.edge;
    this.#store = parts.store;
    this.#device = parts.store.load();
  }

  get paired(): boolean {
    return this.#device !== null;
  }

  get storeKind(): CredentialStore['kind'] {
    return this.#store.kind;
  }

  async pair(pairing: { code: string; deviceName: string }): Promise<void> {
    const paired = await this.#edge.pair({ code: pairing.code, kind: DEVICE_KIND, display_name: pairing.deviceName });
    this.#keep(paired);
  }

  forget(): void {
    this.#device = null;
    this.#store.clear();
  }

  async call<T>(run: (credential: string) => Promise<T>): Promise<T> {
    const device = this.#require();
    try {
      return await run(device.credential);
    } catch (error) {
      if (!(error instanceof EdgeError) || error.status !== 401) {
        throw error;
      }
    }
    return run(await this.#renew(device));
  }

  async #renew(device: DeviceCredential): Promise<string> {
    try {
      const rotated = await this.#edge.refresh(device.refresh_token);
      this.#keep({ ...device, ...rotated });
    } catch (error) {
      if (!(error instanceof EdgeError)) {
        throw error;
      }
      const opened = await this.#edge.openDeviceSession({
        device_id: device.device_id,
        device_secret: device.device_secret,
      });
      this.#keep({ ...device, ...opened });
    }
    return this.#require().credential;
  }

  #keep(device: DeviceCredential): void {
    this.#device = device;
    this.#store.save(device);
  }

  #require(): DeviceCredential {
    if (this.#device === null) {
      throw new Error('the plugin is not paired');
    }
    return this.#device;
  }
}
