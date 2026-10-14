import type { Change, ChangeKind, FileFacts, VaultEvent } from './types';

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
}

export interface BatcherOptions {
  /** Reads the facts of the current bytes of a file. */
  readonly facts: (path: string) => Promise<FileFacts>;
  readonly sequence: DeviceSequence;
}

interface Slot {
  readonly kind: ChangeKind;
  readonly path: string;
  readonly oldPath?: string;
  readonly facts?: FileFacts;
}

const KIND: Record<VaultEvent['name'], ChangeKind> = {
  create: 'created',
  modify: 'updated',
  rename: 'renamed',
  delete: 'deleted',
};

/** Turns vault events into ordered changes. The sequence number is given at release. */
export class Batcher {
  readonly #options: BatcherOptions;
  #slots: Slot[] = [];

  constructor(options: BatcherOptions) {
    this.#options = options;
  }

  async accept(event: VaultEvent): Promise<void> {
    const kind = KIND[event.name];
    const facts = kind === 'deleted' || event.isFolder ? undefined : await this.#options.facts(event.path);
    this.#slots.push({
      kind,
      path: event.path,
      ...(event.oldPath === undefined ? {} : { oldPath: event.oldPath }),
      ...(facts === undefined ? {} : { facts }),
    });
  }

  /** Releases the changes that are ready at `now`, in event order. */
  take(now: number): Change[] {
    void now;
    const released = this.#slots.map((slot) => this.#change(slot));
    this.#slots = [];
    return released;
  }

  #change(slot: Slot): Change {
    return {
      sequence: this.#options.sequence.take(),
      kind: slot.kind,
      path: slot.path,
      ...(slot.oldPath === undefined ? {} : { old_path: slot.oldPath }),
      ...(slot.facts === undefined ? {} : { sha256: slot.facts.sha256, length_bytes: slot.facts.length }),
    };
  }
}
