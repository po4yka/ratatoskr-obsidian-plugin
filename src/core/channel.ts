import type { Auth, EdgeClient } from '../api/edge';
import { EdgeError } from '../api/http';
import { MAX_BATCH_CHANGES, NOTES_CODES, type DeviceResult, type ManifestEntry } from '../api/notes';
import { DeviceQueue } from './device-queue';
import { factsOfBytes } from './hash';
import type { DeviceSession } from './session';
import type { Change, FileFacts, VaultApp, VaultEvent, VaultReader } from './types';

/** The size that the plugin asks for. The answer of the open call decides the real size. */
const CHUNK_BYTES = 1024 * 1024;

/** The SHA-256 of no bytes. The transfer contract refuses 0 bytes, and notes stores this blob itself. */
const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

/** The bytes of a change are not on disk any more. Only a manifest can describe the vault now. */
export class StaleBytesError extends Error {
  override readonly name = 'StaleBytesError';
}

/** What a batch did: committed up to a sequence, or refused for a gap or a channel mismatch. */
export type BatchOutcome =
  | { readonly kind: 'committed'; readonly committed: number }
  | { readonly kind: 'gap'; readonly committed: number }
  | { readonly kind: 'mismatch' };

/** The answer to one request: a batch outcome, or `batch_too_large` with its `max_changes`. */
type PartOutcome = BatchOutcome | { readonly kind: 'tooLarge'; readonly maxChanges: unknown };

/** A file to upload: the path to read and the hash that its bytes must have. */
interface Blob {
  readonly path: string;
  readonly sha256: string;
}

const nfc = (path: string): string => path.normalize('NFC');

/** What a channel needs. `writes`: the vault API and the change channel, to apply the writes of Ratatoskr. */
export interface ChannelParts {
  readonly edge: EdgeClient;
  readonly session: DeviceSession;
  readonly vault: VaultReader;
  readonly connectionId: string;
  readonly writes?: { readonly app: VaultApp; readonly changed: (event: VaultEvent) => Promise<void> } | undefined;
}

/** The calls of one connection: manifest, uploads, change batches and the device queue. */
export class Channel {
  readonly #parts: ChannelParts;
  /** The most changes of one request. A `batch_too_large` answer lowers it. */
  #limit = MAX_BATCH_CHANGES;
  /** The results of the device queue that did not reach notes yet, by operation id. */
  readonly #results = new Map<string, DeviceResult>();

  constructor(parts: ChannelParts) {
    this.#parts = parts;
  }

  /** Applies the operations of the device queue in order and reports each one. Without the vault API, it does nothing. */
  async pull(now: number): Promise<void> {
    const writes = this.#parts.writes;
    if (writes !== undefined) {
      await new DeviceQueue({ ...this.#parts, ...writes, results: this.#results, upload: (blob) => this.#upload(blob) }).pull(now);
    }
  }

  /** Sends a manifest of every file, uploads the bytes that it needs, and returns the facts. */
  async reconcile(): Promise<{ known: Map<string, FileFacts>; committed: number | undefined }> {
    const blobs: Blob[] = [];
    const entries: ManifestEntry[] = [];
    for (const path of await this.#parts.vault.list()) {
      const facts = await this.#parts.vault.facts(path);
      blobs.push({ path, sha256: facts.sha256 });
      entries.push({ path: nfc(path), sha256: facts.sha256, length_bytes: facts.length });
    }
    let answer = await this.#call((edge, call) => edge.sendManifest({ ...call, body: { entries } }));
    if (answer.needed_sha256.length > 0) {
      await this.#uploadHashes({ hashes: answer.needed_sha256, blobs });
      answer = await this.#call((edge, call) => edge.sendManifest({ ...call, body: { entries } }));
    }
    const known = new Map(entries.map((entry) => [entry.path, { sha256: entry.sha256, length: entry.length_bytes }]));
    return { known, committed: answer.committed_sequence };
  }

  /** Sends the changes in order, in parts that notes takes. It stops at the first part that is not committed. */
  async send(changes: readonly Change[]): Promise<BatchOutcome> {
    let outcome: BatchOutcome = { kind: 'committed', committed: 0 };
    for (let start = 0; start < changes.length; ) {
      const part = changes.slice(start, start + this.#limit);
      const answer = await this.#sendPart(part);
      if (answer.kind === 'tooLarge') {
        this.#limit = smallerLimit(answer.maxChanges, part.length);
        continue;
      }
      outcome = answer;
      if (outcome.kind !== 'committed') {
        return outcome;
      }
      start += part.length;
    }
    return outcome;
  }

  /**
   * Sends one part. Notes names the bytes that it needs in a `bytes_missing` answer: an empty file,
   * a file over its size limit and an excluded path need none. Those bytes are uploaded, and the
   * part is sent again once.
   */
  async #sendPart(changes: readonly Change[]): Promise<PartOutcome> {
    const blobs = changes.flatMap((change) =>
      change.kind === 'deleted' || change.sha256 === undefined ? [] : [{ path: change.path, sha256: change.sha256 }],
    );
    try {
      return await this.#batch(changes);
    } catch (error) {
      const missing = error instanceof EdgeError ? error.envelope['missing_sha256'] : undefined;
      if (!(error instanceof EdgeError) || error.code !== NOTES_CODES.bytesMissing || !Array.isArray(missing)) {
        throw error;
      }
      await this.#uploadHashes({ hashes: missing.map(String), blobs });
      return this.#batch(changes);
    }
  }

  async #batch(changes: readonly Change[]): Promise<PartOutcome> {
    try {
      const answer = await this.#call((edge, call) => edge.sendChanges({ ...call, body: { changes } }));
      return { kind: 'committed', committed: answer.committed_sequence };
    } catch (error) {
      const refused = error instanceof EdgeError ? refusal(error) : undefined;
      if (refused === undefined) {
        throw error;
      }
      return refused;
    }
  }

  /** Uploads the bytes of each hash that notes named. */
  async #uploadHashes(request: { hashes: readonly string[]; blobs: readonly Blob[] }): Promise<void> {
    for (const sha256 of new Set(request.hashes)) {
      if (sha256 === EMPTY_SHA256) {
        continue;
      }
      const blob = request.blobs.find((candidate) => candidate.sha256 === sha256);
      if (blob === undefined) {
        throw new StaleBytesError('the notes service needs bytes that no file of this batch has');
      }
      await this.#upload(blob);
    }
  }

  /** The shared chunked, resumable transfer contract on `/v1/notes/connections/{id}/blobs`. */
  async #upload(blob: Blob): Promise<void> {
    const bytes = await this.#parts.vault.read(blob.path).catch(() => {
      throw new StaleBytesError('the file of a change is not in the vault any more');
    });
    const facts = await factsOfBytes(bytes);
    if (facts.sha256 !== blob.sha256) {
      throw new StaleBytesError('the file changed after its change was recorded');
    }
    const body = {
      declared_size_bytes: facts.length,
      media_type: 'application/octet-stream',
      digest: { algorithm: 'sha256' as const, hex: facts.sha256 },
      chunk_size_bytes: CHUNK_BYTES,
    };
    const opened = await this.#call((edge, call) => edge.openUpload({ ...call, body }));
    const size = opened.chunk_size_bytes > 0 ? opened.chunk_size_bytes : CHUNK_BYTES;
    const token = opened.resumption_token;
    for (let index = 0; index * size < bytes.length || index === 0; index += 1) {
      const chunk = { token, index, bytes: bytes.subarray(index * size, (index + 1) * size) };
      await this.#call((edge, call) => edge.putChunk({ ...call, body: chunk }));
    }
    const outcome = await this.#call((edge, call) => edge.finalizeUpload({ ...call, body: { token } }));
    if (outcome.outcome !== 'stored') {
      throw new StaleBytesError('the notes service refused the uploaded bytes');
    }
  }

  #call<T>(run: (edge: EdgeClient, call: { auth: Auth; connectionId: string }) => Promise<T>): Promise<T> {
    const { edge, session, connectionId } = this.#parts;
    return session.call((auth) => run(edge, { auth, connectionId }));
  }
}

/** The outcome of a refused batch that the plugin acts on, or `undefined` for another answer. */
function refusal(error: EdgeError): PartOutcome | undefined {
  const committed = error.envelope['committed_sequence'];
  switch (error.code) {
    case NOTES_CODES.channelMismatch:
      return { kind: 'mismatch' };
    case NOTES_CODES.sequenceGap:
      return typeof committed === 'number' ? { kind: 'gap', committed } : undefined;
    case NOTES_CODES.batchTooLarge:
      return { kind: 'tooLarge', maxChanges: error.envelope['max_changes'] };
    default:
      return undefined;
  }
}

/** The limit after a `batch_too_large` answer to `sent` changes: `max_changes` when it is smaller, else half. */
function smallerLimit(maxChanges: unknown, sent: number): number {
  if (sent <= 1) {
    throw new Error('the notes service refused a batch of one change as too large');
  }
  const usable = typeof maxChanges === 'number' && Number.isSafeInteger(maxChanges) && maxChanges >= 1 && maxChanges < sent;
  return usable ? maxChanges : Math.floor(sent / 2);
}
