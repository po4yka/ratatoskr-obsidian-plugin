import { createHash } from 'node:crypto';
import type { FileFacts } from '../../src/core/types';

/** The facts of a text, computed here with node:crypto, independent of the code under test. */
export function factsOf(text: string): FileFacts {
  const bytes = Buffer.from(text, 'utf8');
  return { sha256: createHash('sha256').update(bytes).digest('hex'), length: bytes.length };
}

/** A vault API stand-in: a map from path to text. */
export class FakeVault {
  readonly files = new Map<string, string>();

  constructor(files: Record<string, string>) {
    for (const [path, text] of Object.entries(files)) {
      this.files.set(path, text);
    }
  }

  readonly facts = async (path: string): Promise<FileFacts> => factsOf(this.text(path));

  readonly read = async (path: string): Promise<Uint8Array> => Buffer.from(this.text(path), 'utf8');

  readonly list = async (): Promise<string[]> => [...this.files.keys()];

  private text(path: string): string {
    const text = this.files.get(path);
    if (text === undefined) {
      throw new Error(`the fake vault has no file ${path}`);
    }
    return text;
  }
}
