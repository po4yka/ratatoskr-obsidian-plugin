import type { EdgeClient } from '../api/edge';
import { EdgeError } from '../api/http';
import { NOTES_CODES, type ConnectRequest } from '../api/notes';
import type { DeviceSession } from './session';
import type { Blocked } from './state';

/** What a connect decided: the connection to send to, or why the plugin sends nothing. */
export type Connected = { readonly connectionId: string } | { readonly blocked: Blocked };

/** `POST /v1/notes/connections` with `channel = plugin`. Another channel or device makes the plugin status-only. */
export async function connectVault(parts: { edge: EdgeClient; session: DeviceSession }, body: ConnectRequest): Promise<Connected> {
  try {
    const accepted = await parts.session.call((auth) => parts.edge.connect({ auth, body }));
    return { connectionId: accepted.connection_id };
  } catch (error) {
    if (!(error instanceof EdgeError)) {
      throw error;
    }
    if (error.code === NOTES_CODES.channelMismatch) {
      return { blocked: 'channel_mismatch' };
    }
    if (error.code !== NOTES_CODES.vaultAlreadyConnected) {
      throw error;
    }
    const channel = error.envelope['channel'];
    const existing = error.envelope['connection_id'];
    // A plugin connection of this vault. The notes service refuses it if another device owns it.
    if (channel === 'plugin' && typeof existing === 'string') {
      return { connectionId: existing };
    }
    return { blocked: channel === 'cli' ? 'cli' : 'sync' };
  }
}

/**
 * Why an answer stops the plugin, or `null`: `notes.channel_mismatch` (another device owns the
 * connection) or `notes.connection.removed` (the owner removed it). The plugin does not connect again.
 */
export function stopReason(error: unknown): 'channel_mismatch' | 'removed' | null {
  if (!(error instanceof EdgeError)) {
    return null;
  }
  if (error.code === NOTES_CODES.channelMismatch) {
    return 'channel_mismatch';
  }
  return error.code === NOTES_CODES.connectionRemoved ? 'removed' : null;
}

/**
 * Notes failed the connection (no manifest within its bound): its routes answer
 * `notes.connection.not_found`, and the connect operation failed with `notes.channel.manifest_missing`.
 * A connection that the owner removed answers `notes.connection.removed` instead (`stopReason`).
 */
export function isConnectionGone(error: unknown): boolean {
  return error instanceof EdgeError && (error.code === NOTES_CODES.connectionNotFound || error.code === NOTES_CODES.manifestMissing);
}
