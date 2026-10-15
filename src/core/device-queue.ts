import type { Auth, EdgeClient } from '../api/edge';
import { EdgeError } from '../api/http';
import { NOTES_CODES, type DeviceOperation, type DeviceOperationPage, type DeviceResult } from '../api/notes';
import { applyOperation } from './apply-operation';
import { StaleBytesError } from './errors';
import { factsOfBytes } from './hash';
import type { DeviceSession } from './session';
import { pathOfHash, rewriteTargets, rewritesToUpload, staleFiles } from './rewrites';
import type { VaultApp, VaultEvent } from './types';
import { storedPath } from './vault-lookup';

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
  /**
   * The results that did not reach notes, by operation id. The plugin data keeps them from one pull
   * to the next and over a restart, so that an operation is reported again and not applied again.
   */
  readonly results: Record<string, DeviceResult>;
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
    const listed = new Set<string>();
    let after: string | null = null;
    let page = await this.#list(after);
    while (page.operations.length > 0 && page.next_cursor !== after) {
      for (const operation of page.operations) {
        listed.add(operation.operation_id);
        await this.#settle(operation, now);
      }
      after = page.next_cursor;
      page = await this.#list(after);
    }
    // The whole queue was read: a kept result of an operation that it does not list has ended.
    for (const operationId of Object.keys(this.#parts.results).filter((id) => !listed.has(id))) {
      Reflect.deleteProperty(this.#parts.results, operationId);
    }
  }

  #list(after: string | null): Promise<DeviceOperationPage> {
    return this.#call((edge, call) => edge.listOperations({ ...call, body: { after } }));
  }

  async #settle(operation: DeviceOperation, now: number): Promise<void> {
    const kept = Object.hasOwn(this.#parts.results, operation.operation_id) ? this.#parts.results[operation.operation_id] : undefined;
    if (kept !== undefined) {
      await this.#report(operation, kept);
      return;
    }
    const result = await applyOperation(this.#parts.app, { operation, content: () => this.#content(operation) });
    if (result.outcome === 'base_mismatch') {
      // Notes needs each local file that is newer than its base to raise the conflict.
      for (const stale of await staleFiles(this.#parts.app, operation)) {
        await this.#parts.changed({ name: stale.local === null ? 'delete' : 'modify', path: stale.path, isFolder: false, at: now });
      }
    }
    await this.#report(operation, result);
  }

  /** The bytes of an operation, or `null` when they do not have the length and the hash that notes named. */
  async #content(operation: DeviceOperation): Promise<Uint8Array | null> {
    const body = { operationId: operation.operation_id };
    const bytes = await this.#call((edge, call) => edge.readOperationContent({ ...call, body }));
    if (bytes.length !== operation.content?.length_bytes) {
      return null;
    }
    return (await factsOfBytes(bytes)).sha256 === operation.content.digest.hex ? bytes : null;
  }

  /**
   * Reports the result. Notes records nothing on a `5xx` and settles the rest of a group on a retry:
   * until it answers `200`, the result stays in `results`, and the next pull sends it again. A result
   * that notes can never accept (`neverAccepted`) is dropped, and the next pull checks the operation
   * again, so that one result never blocks the queue.
   */
  async #report(operation: DeviceOperation, result: DeviceResult): Promise<void> {
    this.#parts.results[operation.operation_id] = result;
    try {
      await this.#send(operation, result);
    } catch (error) {
      if (neverAccepted(error)) {
        Reflect.deleteProperty(this.#parts.results, operation.operation_id);
      }
      throw error;
    }
    Reflect.deleteProperty(this.#parts.results, operation.operation_id);
  }

  /**
   * Sends the result once. A linking note that Obsidian wrote with another hash than notes expected
   * is uploaded first. When notes does not have the bytes of a hash from this connection
   * (`notes.channel.bytes_missing`, one hash for each answer), the file with that hash is uploaded
   * and the result is sent again, at most once for each file that the result names.
   */
  async #send(operation: DeviceOperation, result: DeviceResult): Promise<void> {
    for (const rewrite of rewritesToUpload(operation, result)) {
      await this.#upload(rewrite);
    }
    const body = { operationId: operation.operation_id, result };
    for (let attempt = 0; ; attempt += 1) {
      try {
        await this.#call((edge, call) => edge.sendOperationResult({ ...call, body }));
        return;
      } catch (error) {
        const missing = missingHashes(error);
        if (missing === undefined || attempt > rewriteTargets(operation).length) {
          throw error;
        }
        for (const sha256 of missing) {
          await this.#upload({ path: pathOfHash({ operation, result }, sha256), sha256 });
        }
      }
    }
  }

  /** Uploads the file of `path`, from the path under which the vault keeps it. */
  #upload(blob: { path: string; sha256: string }): Promise<void> {
    return this.#parts.upload({ path: storedPath(this.#parts.app, blob.path), sha256: blob.sha256 });
  }

  #call<T>(run: (edge: EdgeClient, call: { auth: Auth; connectionId: string }) => Promise<T>): Promise<T> {
    const { edge, session, connectionId } = this.#parts;
    return session.call((auth) => run(edge, { auth, connectionId }));
  }
}

/**
 * Whether notes can never accept the result: a `4xx` other than `401` (the session renews), `408`,
 * `409` (bytes to upload) and `429`, or bytes to upload that the file no longer has.
 */
function neverAccepted(error: unknown): boolean {
  if (error instanceof StaleBytesError) {
    return true;
  }
  return error instanceof EdgeError && error.status >= 400 && error.status < 500 && ![401, 408, 409, 429].includes(error.status);
}

/** The hashes of a `notes.channel.bytes_missing` answer, or `undefined` for another failure. */
function missingHashes(error: unknown): string[] | undefined {
  const missing = error instanceof EdgeError && error.code === NOTES_CODES.bytesMissing ? error.envelope['missing_sha256'] : undefined;
  return Array.isArray(missing) ? missing.map(String) : undefined;
}
