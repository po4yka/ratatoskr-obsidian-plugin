# Testing

`npm run test` runs Vitest over `tests/**/*.test.ts` in Node.

- The tests never start Obsidian, and never open a real vault or the real Obsidian profile.
- A fake vault API replays events. A fake Edge answers the requests. A test that needs files uses a
  temporary directory.
- `tests/fixtures/spike-obsidian-1.14.4/` holds `events.jsonl` and `credentials.json` from the
  workspace spike (Obsidian 1.14.4, desktop). They are real recordings, copied without change.
- A test reads an injected clock. The fleet gate fails a test that reads the wall clock.
- Each behaviour starts as a failing test. The commit of the failing test records the failure lines.
