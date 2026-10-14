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

/** `notes.channel_mismatch` on any route: another device owns the connection, or the device is of another kind. */
export function isMismatch(error: unknown): boolean {
  return error instanceof EdgeError && error.code === NOTES_CODES.channelMismatch;
}

/**
 * Notes failed the connection (no manifest within its bound) or it was removed: its routes answer
 * `notes.connection.not_found`, and the connect operation failed with `notes.channel.manifest_missing`.
 */
export function isConnectionGone(error: unknown): boolean {
  return error instanceof EdgeError && (error.code === NOTES_CODES.connectionNotFound || error.code === NOTES_CODES.manifestMissing);
}
