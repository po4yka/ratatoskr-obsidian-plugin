import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import type { VaultReader } from '../../src/core/core';
import type { DataHost } from '../../src/core/state';
import type { FileFacts } from '../../src/core/types';
import { factsOf } from './fake-vault';

/**
 * A vault folder in a temporary directory. It is never a real vault. `saveData` writes
 * `.obsidian/plugins/ratatoskr/data.json` inside it, as Obsidian does.
 */
export class TestVault implements VaultReader, DataHost {
  readonly root = mkdtempSync(join(tmpdir(), 'ratatoskr-test-vault-'));
  readonly dataPath = join(this.root, '.obsidian', 'plugins', 'ratatoskr', 'data.json');

  write(path: string, text: string): void {
    const file = join(this.root, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text);
  }

  async facts(path: string): Promise<FileFacts> {
    return factsOf(readFileSync(join(this.root, path), 'utf8'));
  }

  async read(path: string): Promise<Uint8Array> {
    return readFileSync(join(this.root, path));
  }

  async list(): Promise<string[]> {
    return this.files()
      .map((file) => relative(this.root, file))
      .filter((path) => !path.startsWith('.obsidian'));
  }

  async loadData(): Promise<unknown> {
    try {
      return JSON.parse(readFileSync(this.dataPath, 'utf8')) as unknown;
    } catch {
      return null;
    }
  }

  async saveData(data: unknown): Promise<void> {
    mkdirSync(dirname(this.dataPath), { recursive: true });
    writeFileSync(this.dataPath, JSON.stringify(data, null, 2));
  }

  /** Every file under the vault folder, `.obsidian` included. */
  files(folder = this.root): string[] {
    return readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
      const path = join(folder, entry.name);
      return entry.isDirectory() ? this.files(path) : [path];
    });
  }

  /** The files under the vault folder whose bytes contain `needle`. */
  filesContaining(needle: string): string[] {
    return this.files().filter((file) => readFileSync(file, 'latin1').includes(needle));
  }

  remove(): void {
    rmSync(this.root, { recursive: true, force: true });
  }
}
