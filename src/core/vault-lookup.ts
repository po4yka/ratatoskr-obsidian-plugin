import { factsOfBytes } from './hash';
import type { VaultApp, VaultFile } from './types';

/** The SHA-256 of the file at `path`, or `null` when there is no file. */
export async function hashAt(app: VaultApp, path: string): Promise<string | null> {
  const file = lookUp(app, path);
  return file === null ? null : (await factsOfBytes(new Uint8Array(await app.vault.readBinary(file)))).sha256;
}

/**
 * The file at `path`. Notes names paths in NFC, and macOS and iOS can keep a file name in NFD, which
 * the vault API then knows only in NFD. So a path that is not found is looked up in NFD.
 */
function lookUp(app: VaultApp, path: string): VaultFile | null {
  return app.vault.getFileByPath(path) ?? app.vault.getFileByPath(path.normalize('NFD'));
}

/** The path under which the vault API keeps the file of `path`: the NFD form when only that exists. */
export function storedPath(app: VaultApp, path: string): string {
  return lookUp(app, path)?.path ?? path;
}

export function fileAt(app: VaultApp, path: string): VaultFile {
  const file = lookUp(app, path);
  if (file === null) {
    throw new Error('the file of the operation is not in the vault');
  }
  return file;
}
