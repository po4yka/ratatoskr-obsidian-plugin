## Context

The source of this design is the workspace change `add-notes-vault-connections`, design D5 and the
spec `notes-device-channels`. Spike 3.5 recorded the vault events and the credential stores of
Obsidian 1.14.4 on desktop. The recordings are in `tests/fixtures/spike-obsidian-1.14.4/`.

## Goals / Non-Goals

**Goals:**

- Send each file change once, in the order of the device sequence.
- Keep the credential outside the vault folder.
- Run the behaviour in Node tests without Obsidian.

**Non-Goals:**

- Mobile credential storage (the iOS measurement is deferred by the owner).
- Writes from Ratatoskr into the vault (OBS-024).

## Decisions

### 1. A thin adapter around a core without `obsidian`

`src/main.ts` and `src/settings.ts` are the only modules that import `obsidian` at run time. The
`obsidian` package has typings and no JavaScript, so a module that imports a value from it cannot
run in Node. The core receives the vault, the host data store, the credential environment and the
HTTP transport as parameters.

### 2. The batcher holds a slot until it is resolved

Each accepted event becomes a slot in event order. A `create` or a `delete` slot stays open for
3 seconds, because a rename outside Obsidian arrives as `create` and then `delete` about 1 second
later. A later opposite event with an equal hash closes the slot as one `renamed` change. The batcher
releases only the leading slots that are closed, so the order of the changes stays the order of the
events. The sequence number is given when a change is released, so a paired event uses no number.

### 3. Credential stores

The order is `app.secretStorage`, then `@electron/remote` `safeStorage` with the ciphertext in the
local storage of the app (`saveLocalStorage`), then memory. All three are outside the vault folder.
`data.json` keeps only non-secret state.

### 4. Wire shapes of the notes routes

The pinned Edge contract has the pairing and session routes, and the transfer shapes. It has no notes
route yet. `src/api/notes.ts` writes the notes shapes from design D5. They are the open point that
the coordinator checks against `ratatoskr-notes` group 8.

## Risks / Trade-offs

- [The notes wire shapes can differ from group 8] → One module holds them, and the tests name each
  field.
- [Memory-only storage loses the pairing at a restart] → The owner pairs again. The status bar says
  so.
