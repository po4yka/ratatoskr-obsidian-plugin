## Context

The source of this design is the workspace change `add-notes-write-back`, design D5 and D6 and the
spec `notes-write-delivery`. The wire shapes are those of `ratatoskr-notes`
`services/notes/src/api/device_operations.rs`.

## Goals / Non-Goals

**Goals:**

- Never replace a local file that Ratatoskr did not see.
- Apply the operations in the order of the queue.
- Let Obsidian update the links after a rename, as it does for a rename by the owner.

**Non-Goals:**

- Merging a local edit with a write. Notes raises a conflict, and the owner resolves it.
- Writing the `.obsidian` folder.

## Decisions

### 1. The core receives the vault API of the app

The core does not import `obsidian` at run time. It receives the part of `app` that it uses
(`app.vault` and `app.fileManager`) as a parameter, and the tests give it a fake.

### 2. The pull follows the change batches

Each flush sends the waiting changes first and then reads the queue. The plugin's own write comes
back as a vault event and goes to notes as a change at the next flush, and notes takes that change
as the acknowledgement of the write. The plugin keeps no cursor between two flushes: an operation
stays in the queue until its result arrives, so a read from the start finds every open operation.

### 3. The result names the file after the operation

An applied operation reports the SHA-256 of the file at its path, or at its target after a rename
or a move. A delete reports no hash. When notes does not have those bytes from this connection
(`notes.channel.bytes_missing`), the plugin uploads them and sends the result again.

## Risks / Trade-offs

- [The result of an applied operation is lost] → The echo of the write acknowledges it at the next
  flush, before the plugin reads the queue again.
- [A vault API call fails] → The plugin reports `failed` with `notes.channel.refused`, and the
  previous revision stays current in notes.
