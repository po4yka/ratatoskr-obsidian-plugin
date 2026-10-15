/** The bytes of a change are not on disk any more. Only a manifest can describe the vault now. */
export class StaleBytesError extends Error {
  override readonly name = 'StaleBytesError';
}
