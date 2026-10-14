import type { Change, ChangeKind, FileFacts, VaultEvent } from './types';

/**
 * A rename outside Obsidian arrives as `create` and, about one second later, `delete` (spike 3.5).
 * A pair with equal hashes inside this window is one `renamed` change (design D5).
 */
export const PAIRING_WINDOW_MS = 3_000;

/**
 * The device change sequence. It increases by one per change and never goes back, so the notes
 * service can find a gap and a repeated batch.
 */
export class DeviceSequence {
  #next: number;

  constructor(next: number) {
    if (!Number.isSafeInteger(next) || next < 1) {
      throw new RangeError('a device sequence starts at a positive integer');
    }
    this.#next = next;
  }

  /** The number that the next change gets. */
  get next(): number {
    return this.#next;
  }

  take(): number {
    const sequence = this.#next;
    this.#next += 1;
    return sequence;
  }

  /** Continues after `committed`, the highest sequence that the notes service committed. */
  resume(committed: number): void {
    this.#next = committed + 1;
  }
}

export interface BatcherOptions {
  /** Reads the facts of the current bytes of a file, by the path that the vault event names. */
  readonly facts: (path: string) => Promise<FileFacts>;
  readonly sequence: DeviceSequence;
  /** The facts of the files that Ratatoskr already has, by NFC path. The batcher keeps it current. */
  readonly known?: Map<string, FileFacts>;
}

interface Slot {
  kind: ChangeKind;
  path: string;
  oldPath?: string;
  facts?: FileFacts;
  readonly at: number;
  /** A `created` or `deleted` slot that can still pair with its opposite event. */
  open: boolean;
}

const nfc = (path: string): string => path.normalize('NFC');
const fileName = (path: string): string => path.slice(path.lastIndexOf('/') + 1);

/** Turns vault events into ordered changes. The sequence number is given at release. */
export class Batcher {
  readonly #options: BatcherOptions;
  readonly #known: Map<string, FileFacts>;
  #slots: Slot[] = [];

  constructor(options: BatcherOptions) {
    this.#options = options;
    this.#known = options.known ?? new Map();
  }

  /** The facts of every file that the released and the held changes describe, by NFC path. */
  get known(): ReadonlyMap<string, FileFacts> {
    return this.#known;
  }

  /** Replaces the known facts, for example with the files of a manifest. */
  replaceKnown(known: ReadonlyMap<string, FileFacts>): void {
    this.#known.clear();
    for (const [path, facts] of known) {
      this.#known.set(path, facts);
    }
  }

  async accept(event: VaultEvent): Promise<void> {
    // A folder has no bytes. Its rename is followed by one rename per file inside it.
    if (event.isFolder) {
      return;
    }
    if (event.name === 'delete') {
      this.#deleted(nfc(event.path), event.at);
      return;
    }
    const facts = await this.#options.facts(event.path);
    const path = nfc(event.path);
    this.#known.set(path, facts);
    if (event.name === 'create') {
      this.#created({ path, facts, at: event.at });
    } else if (event.name === 'rename' && event.oldPath !== undefined) {
      this.#known.delete(nfc(event.oldPath));
      this.#slots.push({ kind: 'renamed', path, oldPath: nfc(event.oldPath), facts, at: event.at, open: false });
    } else {
      this.#slots.push({ kind: 'updated', path, facts, at: event.at, open: false });
    }
  }

  /** Releases the leading changes that are ready at `now`, in event order. */
  take(now: number): Change[] {
    const ready = this.#slots.findIndex((slot) => slot.open && now - slot.at <= PAIRING_WINDOW_MS);
    const count = ready === -1 ? this.#slots.length : ready;
    const released = this.#slots.slice(0, count).map((slot) => this.#change(slot));
    this.#slots = this.#slots.slice(count);
    return released;
  }

  #created(created: { path: string; facts: FileFacts; at: number }): void {
    const deleted = this.#partner({ kind: 'deleted', path: created.path, facts: created.facts, at: created.at });
    if (deleted === undefined) {
      this.#slots.push({ kind: 'created', ...created, open: true });
      return;
    }
    // The delete came first. Its slot keeps its place and becomes the rename.
    deleted.kind = 'renamed';
    deleted.oldPath = deleted.path;
    deleted.path = created.path;
    deleted.facts = created.facts;
    deleted.open = false;
  }

  #deleted(path: string, at: number): void {
    const facts = this.#known.get(path);
    this.#known.delete(path);
    const created = facts === undefined ? undefined : this.#partner({ kind: 'created', path, facts, at });
    if (created === undefined) {
      this.#slots.push({ kind: 'deleted', path, ...(facts === undefined ? {} : { facts }), at, open: true });
      return;
    }
    created.kind = 'renamed';
    created.oldPath = path;
    created.open = false;
  }

  #partner(wanted: { kind: ChangeKind; path: string; facts: FileFacts; at: number }): Slot | undefined {
    return this.#slots.find(
      (slot) =>
        slot.open &&
        slot.kind === wanted.kind &&
        slot.facts?.sha256 === wanted.facts.sha256 &&
        wanted.at - slot.at <= PAIRING_WINDOW_MS &&
        // All empty files have one hash, so an empty pair also needs the same file name.
        (wanted.facts.length > 0 || fileName(slot.path) === fileName(wanted.path)),
    );
  }

  #change(slot: Slot): Change {
    const facts = slot.kind === 'deleted' ? undefined : slot.facts;
    return {
      sequence: this.#options.sequence.take(),
      kind: slot.kind,
      path: slot.path,
      ...(slot.oldPath === undefined ? {} : { old_path: slot.oldPath }),
      ...(facts === undefined ? {} : { sha256: facts.sha256, length_bytes: facts.length }),
    };
  }
}
