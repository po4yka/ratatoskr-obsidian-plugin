// The wire shapes of the notes routes that Edge forwards to `ratatoskr-notes`.
//
// The pinned Edge contract (`openapi/openapi.json`) does not describe the notes routes yet, so these
// shapes are written by hand from the workspace change `add-notes-vault-connections`: design D5, the
// spec `notes-device-channels`, and the connect route of `ratatoskr-notes` (`services/notes/src/
// api.rs`, `ConnectRequest` and `ConnectAccepted`). Replace them with generated types when the
// contract carries the routes. The blob routes use the transfer shapes of the pinned contract.
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

/** The error codes that the plugin acts on, and the envelope fields that they carry. */
export const NOTES_CODES = {
  /** Carries `connection_id` and `channel` (`sync`, `plugin` or `cli`). */
  vaultAlreadyConnected: 'notes.connection.vault_already_connected',
  /** A device of another kind, or a second device on a one-device connection. */
  channelMismatch: 'notes.channel_mismatch',
  /** Carries `committed_sequence`. Nothing of the batch was committed. */
  sequenceGap: 'notes.channel.sequence_gap',
  /** Carries `missing_sha256`. Nothing of the batch was committed. */
  bytesMissing: 'notes.channel.bytes_missing',
  /** `413`, carries `max_changes`. Nothing of the batch was committed. */
  batchTooLarge: 'notes.channel.batch_too_large',
  /** `404` on a route of a connection that is failed, removed, or of another owner. */
  connectionNotFound: 'notes.connection.not_found',
  /** The failure of a connect whose first manifest did not arrive within 30 minutes. */
  manifestMissing: 'notes.channel.manifest_missing',
} as const;
