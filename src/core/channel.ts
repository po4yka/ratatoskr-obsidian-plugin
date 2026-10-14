import type { Auth, EdgeClient } from '../api/edge';
import { EdgeError } from '../api/http';
import { NOTES_CODES, type ManifestEntry } from '../api/notes';
import { factsOfBytes } from './hash';
import type { DeviceSession } from './session';
import type { Change, FileFacts, VaultReader } from './types';

/** The size that the plugin asks for. The answer of the open call decides the real size. */
const CHUNK_BYTES = 1024 * 1024;

/** The bytes of a change are not on disk any more. Only a manifest can describe the vault now. */
export class StaleBytesError extends Error {
  override readonly name = 'StaleBytesError';
}

/** What a batch did: committed up to a sequence, or refused for a gap or a channel mismatch. */
export type BatchOutcome =
  | { readonly kind: 'committed'; readonly committed: number }
  | { readonly kind: 'gap'; readonly committed: number }
  | { readonly kind: 'mismatch' };

/** A file to upload: the path to read and the hash that its bytes must have. */
interface Blob {
  readonly path: string;
  readonly sha256: string;
}

const nfc = (path: string): string => path.normalize('NFC');

/** The calls of one connection: manifest, uploads and change batches. */
export class Channel {
  readonly #parts: { edge: EdgeClient; session: DeviceSession; vault: VaultReader; connectionId: string };
  readonly #uploaded = new Set<string>();

  constructor(parts: { edge: EdgeClient; session: DeviceSession; vault: VaultReader; connectionId: string }) {
    this.#parts = parts;
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

  /** Uploads new bytes, then sends the batch. A `bytes_missing` answer uploads those and resends once. */
  async send(changes: readonly Change[]): Promise<BatchOutcome> {
    const blobs = changes.flatMap((change) =>
      change.kind === 'deleted' || change.sha256 === undefined ? [] : [{ path: change.path, sha256: change.sha256 }],
    );
    await this.#uploadHashes({ hashes: changes.filter((c) => c.kind === 'created' || c.kind === 'updated').map((c) => c.sha256 ?? ''), blobs });
    try {
      return await this.#batch(changes);
    } catch (error) {
      const missing = error instanceof EdgeError ? error.envelope['missing_sha256'] : undefined;
      if (!(error instanceof EdgeError) || error.code !== NOTES_CODES.bytesMissing || !Array.isArray(missing)) {
        throw error;
      }
      await this.#uploadHashes({ hashes: missing.map(String), blobs, again: true });
      return this.#batch(changes);
    }
  }

  async #batch(changes: readonly Change[]): Promise<BatchOutcome> {
    try {
      const answer = await this.#call((edge, call) => edge.sendChanges({ ...call, body: { changes } }));
      return { kind: 'committed', committed: answer.committed_sequence };
    } catch (error) {
      if (error instanceof EdgeError && error.code === NOTES_CODES.channelMismatch) {
        return { kind: 'mismatch' };
      }
      const committed = error instanceof EdgeError ? error.envelope['committed_sequence'] : undefined;
      if (error instanceof EdgeError && error.code === NOTES_CODES.sequenceGap && typeof committed === 'number') {
        return { kind: 'gap', committed };
      }
      throw error;
    }
  }

  async #uploadHashes(request: { hashes: readonly string[]; blobs: readonly Blob[]; again?: boolean }): Promise<void> {
    for (const sha256 of new Set(request.hashes)) {
      if (sha256 === '' || (this.#uploaded.has(sha256) && request.again !== true)) {
        continue;
      }
      const blob = request.blobs.find((candidate) => candidate.sha256 === sha256);
      if (blob === undefined) {
        throw new StaleBytesError('the notes service needs bytes that no file of this batch has');
      }
      await this.#upload(blob);
      this.#uploaded.add(sha256);
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
