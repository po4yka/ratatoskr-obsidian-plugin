// The wire shapes of the notes routes that Edge forwards to `ratatoskr-notes`.
//
// The pinned Edge contract (`openapi/openapi.json`) does not describe the notes routes yet, so these
// shapes are written by hand from the workspace change `add-notes-vault-connections`: design D5, the
// spec `notes-device-channels`, and the routes of `ratatoskr-notes`: `services/notes/src/api/
// connect.rs` (`ConnectRequest` and `ConnectAccepted`), `services/notes/src/channel.rs`
// (`DeviceChange`) and its README section "Device channels". Replace them with generated types when
// the contract carries the routes. The blob routes use the transfer shapes of the pinned contract.
// The device queue of a write (workspace change `add-notes-write-back`, design D5) follows
// `services/notes/src/api/device_operations.rs`.
import type { Change } from '../core/types';

/** `POST /v1/notes/connections`, channel `plugin`. The notes service refuses unknown fields. */
export interface ConnectRequest {
  readonly channel: 'plugin';
  readonly vault_key: string;
  readonly vault_display_name: string;
}

/** The `202` answer of the connect route. */
export interface ConnectAccepted {
  readonly connection_id: string;
  readonly channel: string;
  readonly state: string;
  /** The connect operation (workspace design D10). Optional: the plugin does not need it to send. */
  readonly operation?: ConnectOperation;
}

/** The operation of a connect, as the `202` answer names it. Its reports go to the web client. */
export interface ConnectOperation {
  readonly operation_id: string;
  /** `notes.connection.connect`. */
  readonly kind: string;
  /** `ratatoskr-notes`. */
  readonly lane: string;
}

/** `POST /v1/notes/connections/{id}/changes`: at most 256 changes, sequences without a gap. */
export interface ChangeBatch {
  readonly changes: readonly Change[];
}

/** The answer to a batch: the highest sequence that the notes service committed. */
export interface BatchCommitted {
  readonly committed_sequence: number;
}

/** One file of a manifest: the NFC path and the facts of its current bytes. */
export interface ManifestEntry {
  readonly path: string;
  readonly sha256: string;
  readonly length_bytes: number;
}

/** `POST /v1/notes/connections/{id}/manifest`: every file of the vault. */
export interface Manifest {
  readonly entries: readonly ManifestEntry[];
}

/** The hashes whose bytes the notes service needs before it can apply the manifest. */
export interface ManifestAnswer {
  readonly needed_sha256: readonly string[];
  readonly committed_sequence?: number;
}

export const MAX_BATCH_CHANGES = 256;

/** A notes-owned `BlobRef`: the bytes of an operation, which `.../content` streams. */
export interface BlobRef {
  readonly owner_service: string;
  readonly digest: { readonly algorithm: 'sha256'; readonly hex: string };
  readonly media_type: string;
  readonly length_bytes: number;
}

/** A linking note of a rename, whose links Obsidian rewrites on the device. */
export interface RewriteTarget {
  readonly path: string;
  readonly base_hash: string | null;
  readonly expected_sha256: string | null;
}

/** What the device did with one linking note of a rename. Notes refuses unknown fields. */
export type RewriteResult =
  | { readonly path: string; readonly outcome: 'applied'; readonly sha256: string }
  | { readonly path: string; readonly outcome: 'base_mismatch'; readonly local_sha256: string | null };

/**
 * One operation of the device queue. A conflict resolution arrives as an `update`, or as a `create`
 * of a file that was deleted. `base_hash` is the hash that the local file must have (`null`: no file).
 */
export interface DeviceOperation {
  readonly operation_id: string;
  readonly cursor: string;
  readonly kind: 'create' | 'update' | 'rename' | 'move' | 'delete' | 'set_property';
  readonly path: string;
  readonly target_path: string | null;
  readonly base_hash: string | null;
  /** The bytes to write, or the JSON value of a `set_property`. */
  readonly content: BlobRef | null;
  readonly property_key: string | null;
  readonly property_change: 'set' | 'remove' | null;
  readonly expected_sha256: string | null;
  /** The linking notes of a `rename` or a `move`, which notes delivers with it as one group. */
  readonly rewrites?: readonly RewriteTarget[];
}

/** `GET /v1/notes/connections/{id}/device-operations?after=<cursor>`: at most 256, in delivery order. */
export interface DeviceOperationPage {
  readonly operations: readonly DeviceOperation[];
  /** Opaque: the plugin sends it back exactly as it is. */
  readonly next_cursor: string;
}

/**
 * `POST .../device-operations/{operation_id}/result`. `sha256` is the hash of the file at the path,
 * or at the target of a rename or a move; a delete has none. Notes refuses unknown fields.
 */
export type DeviceResult =
  | { readonly outcome: 'applied'; readonly sha256?: string; readonly rewrites?: readonly RewriteResult[] }
  | { readonly outcome: 'base_mismatch'; readonly local_sha256: string | null }
  | { readonly outcome: 'failed'; readonly code: string };

/** The answer to a result: the state of the write in notes. */
export interface DeviceResultAnswer {
  readonly operation_id: string;
  readonly state: 'succeeded' | 'failed' | 'delivering';
}

/** The error codes that the plugin acts on, and the envelope fields that they carry. */
export const NOTES_CODES = {
  /** Carries `connection_id` and `channel` (`sync`, `plugin` or `cli`). */
  vaultAlreadyConnected: 'notes.connection.vault_already_connected',
  /** A device of another kind, or a second device on a one-device connection. */
  channelMismatch: 'notes.channel_mismatch',
  /** Carries `committed_sequence`. Nothing of the batch was committed. */
  sequenceGap: 'notes.channel.sequence_gap',
  /** Carries `missing_sha256`. Nothing of the batch was committed, or the result was not recorded. */
  bytesMissing: 'notes.channel.bytes_missing',
  /** `413`, carries `max_changes`. Nothing of the batch was committed. */
  batchTooLarge: 'notes.channel.batch_too_large',
  /** `404` on a route of a connection that is failed, of another owner, or of another device. */
  connectionNotFound: 'notes.connection.not_found',
  /** `410` on a route of a connection that the owner removed, to the device of that connection. */
  connectionRemoved: 'notes.connection.removed',
  /** The failure of a connect whose first manifest did not arrive within 30 minutes. */
  manifestMissing: 'notes.channel.manifest_missing',
} as const;
