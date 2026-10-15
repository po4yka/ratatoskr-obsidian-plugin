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

/** A file of the vault API (`TFile`). */
export interface VaultFile {
  readonly path: string;
}

/**
 * The part of the Obsidian `app` that applies a write of Ratatoskr: `app.vault` and
 * `app.fileManager`. `src/main.ts` gives the app itself; the tests give a fake.
 */
export interface VaultApp {
  readonly vault: {
    getFileByPath(path: string): VaultFile | null;
    getFolderByPath(path: string): unknown;
    readBinary(file: VaultFile): Promise<ArrayBuffer>;
    modifyBinary(file: VaultFile, data: ArrayBuffer): Promise<void>;
    createBinary(path: string, data: ArrayBuffer): Promise<VaultFile>;
    createFolder(path: string): Promise<unknown>;
    /** Moves the file to a trash: of the operating system when `system` is `true`, else `.trash` in the vault. */
    trash(file: VaultFile, system: boolean): Promise<void>;
  };
  readonly fileManager: {
    /** Renames or moves a file, and updates the links to it by the settings of the vault. */
    renameFile(file: VaultFile, newPath: string): Promise<void>;
    processFrontMatter(file: VaultFile, fn: (frontmatter: Record<string, unknown>) => void): Promise<void>;
  };
}
