import type { Auth, EdgeClient } from '../api/edge';
import { EdgeError } from '../api/http';
import { NOTES_CODES, type DeviceOperation, type DeviceOperationPage, type DeviceResult } from '../api/notes';
import { applyOperation } from './apply-operation';
import { factsOfBytes } from './hash';
import type { DeviceSession } from './session';
import type { VaultApp, VaultEvent } from './types';

/** What the device queue of one connection needs. */
export interface QueueParts {
  readonly edge: EdgeClient;
  readonly session: DeviceSession;
  readonly connectionId: string;
  readonly app: VaultApp;
  /** Uploads the bytes of the file at `path`, which must have the SHA-256 `sha256`. */
  readonly upload: (blob: { path: string; sha256: string }) => Promise<void>;
  /** Gives one vault event to the change channel. */
  readonly changed: (event: VaultEvent) => Promise<void>;
}

/**
 * The device queue of a `plugin` connection (workspace OBS-024 design D5 and D6). A pull reads the
 * queue from the start, page by page with the cursor that notes sent, and applies and reports each
 * operation before the next one. An operation stays in the queue until its result arrives, so an
 * operation that a failure stopped is read again at the next pull.
 */
export class DeviceQueue {
  readonly #parts: QueueParts;

  constructor(parts: QueueParts) {
    this.#parts = parts;
  }

  /** `now` is the injected clock of the vault event that a base mismatch gives to the change channel. */
  async pull(now: number): Promise<void> {
    let after: string | null = null;
    let page = await this.#list(after);
    while (page.operations.length > 0 && page.next_cursor !== after) {
      for (const operation of page.operations) {
        await this.#settle(operation, now);
      }
      after = page.next_cursor;
      page = await this.#list(after);
    }
  }

  #list(after: string | null): Promise<DeviceOperationPage> {
    return this.#call((edge, call) => edge.listOperations({ ...call, body: { after } }));
  }

  async #settle(operation: DeviceOperation, now: number): Promise<void> {
    const result = await applyOperation(this.#parts.app, { operation, content: () => this.#content(operation) });
    if (result.outcome === 'base_mismatch') {
      // Notes needs the local file to raise the conflict.
      const name = result.local_sha256 === null ? 'delete' : 'modify';
      await this.#parts.changed({ name, path: operation.path, isFolder: false, at: now });
    }
    await this.#report(operation, result);
  }

  /** The bytes of an operation, when they have the hash that notes named. */
  async #content(operation: DeviceOperation): Promise<Uint8Array> {
    const body = { operationId: operation.operation_id };
    const bytes = await this.#call((edge, call) => edge.readOperationContent({ ...call, body }));
    if ((await factsOfBytes(bytes)).sha256 !== operation.content?.digest.hex) {
      throw new Error('the bytes of an operation do not have the hash that notes named');
    }
    return bytes;
  }

  /**
   * Sends the result. When notes does not have the bytes of the hash from this connection
   * (`notes.channel.bytes_missing`), the bytes are uploaded and the result is sent again once.
   */
  async #report(operation: DeviceOperation, result: DeviceResult): Promise<void> {
    const body = { operationId: operation.operation_id, result };
    try {
      await this.#call((edge, call) => edge.sendOperationResult({ ...call, body }));
    } catch (error) {
      const missing = missingHashes(error);
      if (missing === undefined) {
        throw error;
      }
      for (const sha256 of missing) {
        await this.#parts.upload({ path: operation.target_path ?? operation.path, sha256 });
      }
      await this.#call((edge, call) => edge.sendOperationResult({ ...call, body }));
    }
  }

  #call<T>(run: (edge: EdgeClient, call: { auth: Auth; connectionId: string }) => Promise<T>): Promise<T> {
    const { edge, session, connectionId } = this.#parts;
    return session.call((auth) => run(edge, { auth, connectionId }));
  }
}

/** The hashes of a `notes.channel.bytes_missing` answer, or `undefined` for another failure. */
function missingHashes(error: unknown): string[] | undefined {
  const missing = error instanceof EdgeError && error.code === NOTES_CODES.bytesMissing ? error.envelope['missing_sha256'] : undefined;
  return Array.isArray(missing) ? missing.map(String) : undefined;
}
