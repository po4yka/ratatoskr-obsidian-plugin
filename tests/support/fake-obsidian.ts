import type { FileFacts, VaultEvent } from '../../src/core/types';
import { factsOf } from './fake-vault';

/** A file of the fake vault API, as `TFile` names it. */
interface FakeFile {
  readonly path: string;
}

const decode = (data: ArrayBuffer): string => Buffer.from(data).toString('utf8');
const encode = (text: string): ArrayBuffer => new Uint8Array(Buffer.from(text, 'utf8')).buffer;
const linkName = (path: string): string => path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/, '');
const folderOf = (path: string): string => path.slice(0, Math.max(path.lastIndexOf('/'), 0));

/** The frontmatter of the fake: one `key: <JSON value>` line per property between two `---` lines. */
function splitFrontmatter(text: string): { frontmatter: Record<string, unknown>; body: string } {
  const end = text.startsWith('---\n') ? text.indexOf('\n---\n', 3) : -1;
  if (end === -1) {
    return { frontmatter: {}, body: text };
  }
  const lines = text.slice(4, end).split('\n').filter((line) => line !== '');
  const entries = lines.map((line) => [line.slice(0, line.indexOf(': ')), JSON.parse(line.slice(line.indexOf(': ') + 2)) as unknown]);
  return { frontmatter: Object.fromEntries(entries) as Record<string, unknown>, body: text.slice(end + 5) };
}

function joinFrontmatter(frontmatter: Record<string, unknown>, body: string): string {
  const lines = Object.entries(frontmatter).map(([key, value]) => `${key}: ${JSON.stringify(value)}\n`);
  return `---\n${lines.join('')}---\n${body}`;
}

/**
 * The vault API of Obsidian in memory: `app.vault` and `app.fileManager`, with which the plugin
 * applies a write of Ratatoskr. It records each call that changes a file, and it gives each vault
 * event that Obsidian fires to `onEvent`, as `src/main.ts` forwards it to the core.
 */
export class FakeObsidian {
  readonly files = new Map<string, string>();
  readonly calls: string[] = [];
  /** Each path that the plugin looked up with `getFileByPath`. */
  readonly lookups: string[] = [];
  readonly #folders = new Set<string>();
  onEvent: (event: VaultEvent) => void = () => undefined;
  /** The injected clock of the events. */
  at = 0;

  constructor(files: Record<string, string>) {
    for (const [path, text] of Object.entries(files)) {
      this.files.set(path, text);
    }
  }

  readonly facts = async (path: string): Promise<FileFacts> => factsOf(this.#text(path));

  readonly read = async (path: string): Promise<Uint8Array> => Buffer.from(this.#text(path), 'utf8');

  readonly list = async (): Promise<string[]> => [...this.files.keys()];

  readonly vault = {
    getFileByPath: (path: string): FakeFile | null => {
      this.lookups.push(path);
      return this.files.has(path) ? { path } : null;
    },
    getFolderByPath: (path: string): object | null =>
      this.#folders.has(path) || [...this.files.keys()].some((file) => file.startsWith(`${path}/`)) ? {} : null,
    readBinary: async (file: FakeFile): Promise<ArrayBuffer> => encode(this.#text(file.path)),
    modifyBinary: async (file: FakeFile, data: ArrayBuffer): Promise<void> => {
      this.calls.push(`modifyBinary ${file.path}`);
      this.files.set(file.path, decode(data));
      this.#emit({ name: 'modify', path: file.path });
    },
    createBinary: async (path: string, data: ArrayBuffer): Promise<FakeFile> => {
      // Stricter than needed on purpose: a file needs its folder, and a path holds one file.
      if (this.files.has(path) || (folderOf(path) !== '' && this.vault.getFolderByPath(folderOf(path)) === null)) {
        throw new Error(`the fake vault cannot create ${path}`);
      }
      this.calls.push(`createBinary ${path}`);
      this.files.set(path, decode(data));
      this.#emit({ name: 'create', path });
      return { path };
    },
    createFolder: async (path: string): Promise<void> => {
      this.calls.push(`createFolder ${path}`);
      this.#folders.add(path);
    },
    trash: async (file: FakeFile, system: boolean): Promise<void> => {
      this.calls.push(`trash ${file.path} system=${String(system)}`);
      this.files.delete(file.path);
      this.#emit({ name: 'delete', path: file.path });
    },
  };

  readonly fileManager = {
    /** Obsidian moves the file, then rewrites each wikilink to the old name in the other notes. */
    renameFile: async (file: FakeFile, newPath: string): Promise<void> => {
      if (this.files.has(newPath)) {
        throw new Error('Destination file already exists!');
      }
      this.calls.push(`renameFile ${file.path} ${newPath}`);
      this.files.set(newPath, this.#text(file.path));
      this.files.delete(file.path);
      this.#emit({ name: 'rename', path: newPath, oldPath: file.path });
      for (const [path, text] of this.files) {
        const rewritten = text.replaceAll(`[[${linkName(file.path)}]]`, `[[${linkName(newPath)}]]`);
        if (rewritten !== text) {
          this.files.set(path, rewritten);
          this.#emit({ name: 'modify', path });
        }
      }
    },
    processFrontMatter: async (file: FakeFile, fn: (frontmatter: Record<string, unknown>) => void): Promise<void> => {
      this.calls.push(`processFrontMatter ${file.path}`);
      const { frontmatter, body } = splitFrontmatter(this.#text(file.path));
      fn(frontmatter);
      this.files.set(file.path, joinFrontmatter(frontmatter, body));
      this.#emit({ name: 'modify', path: file.path });
    },
  };

  #emit(event: { name: VaultEvent['name']; path: string; oldPath?: string }): void {
    this.onEvent({ ...event, isFolder: false, at: this.at });
  }

  #text(path: string): string {
    const text = this.files.get(path);
    if (text === undefined) {
      throw new Error(`the fake vault has no file ${path}`);
    }
    return text;
  }
}
