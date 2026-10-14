// The wire shapes of the notes routes that Edge forwards to `ratatoskr-notes`.
//
// The pinned Edge contract (`openapi/openapi.json`) does not describe the notes routes yet, so these
// shapes are written by hand from the workspace change `add-notes-vault-connections`: design D5, the
// spec `notes-device-channels`, and the connect route of `ratatoskr-notes` (`services/notes/src/
// api.rs`, `ConnectRequest` and `ConnectAccepted`). Replace them with generated types when the
// contract carries the routes.
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

export const MAX_BATCH_CHANGES = 256;
