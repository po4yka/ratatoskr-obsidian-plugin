// The shapes that the core shares. They import nothing from `obsidian`.

/** One vault API event, as the adapter reports it. `at` is milliseconds of the injected clock. */
export interface VaultEvent {
  readonly name: 'create' | 'modify' | 'rename' | 'delete';
  readonly path: string;
  readonly oldPath?: string;
  readonly isFolder: boolean;
  readonly at: number;
}

/** The SHA-256 (lowercase hexadecimal) and the byte length of the bytes of one file. */
export interface FileFacts {
  readonly sha256: string;
  readonly length: number;
}

export type ChangeKind = 'created' | 'updated' | 'renamed' | 'deleted';

/** One change of a batch, in the wire form of design D5. `deleted` carries no hash. */
export interface Change {
  readonly sequence: number;
  readonly kind: ChangeKind;
  readonly path: string;
  readonly old_path?: string;
  readonly previous_path?: string;
  readonly sha256?: string;
  readonly length_bytes?: number;
}

/** The vault API, as the core needs it. Paths are the paths that the vault API names. */
export interface VaultReader {
  facts(path: string): Promise<FileFacts>;
  read(path: string): Promise<Uint8Array>;
  list(): Promise<string[]>;
}
