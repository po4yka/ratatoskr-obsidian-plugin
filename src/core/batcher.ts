import type { Change, FileFacts, VaultEvent } from './types';

/** The device change sequence. Not implemented yet (OBS-023 task 11.3). */
export class DeviceSequence {
  constructor(readonly first: number) {}
}

export interface BatcherOptions {
  /** Reads the facts of the current bytes of a file. */
  readonly facts: (path: string) => Promise<FileFacts>;
  readonly sequence: DeviceSequence;
}

/** Turns vault events into ordered changes. Not implemented yet (OBS-023 task 11.3). */
export class Batcher {
  constructor(readonly options: BatcherOptions) {}

  async accept(event: VaultEvent): Promise<void> {
    void event;
  }

  take(now: number): Change[] {
    void now;
    return [];
  }
}
