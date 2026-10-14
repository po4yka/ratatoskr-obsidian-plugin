import type { FileFacts } from './types';

/** The SHA-256 and the length of `bytes`, with Web Crypto (Electron and Node both have it). */
export async function factsOfBytes(bytes: Uint8Array): Promise<FileFacts> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>));
  const sha256 = Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return { sha256, length: bytes.length };
}
