# Architecture

## Context

The plugin is the device side of the `plugin` channel of `ratatoskr-notes` (workspace changes
`add-notes-vault-connections` and `add-notes-write-back`, design D5). It runs inside Obsidian. It
talks only to Edge.

```text
Obsidian vault API ──events──▶ batcher ──changes──▶ sync ──HTTPS──▶ Edge ──▶ ratatoskr-notes
       ▲                                          ▲  │
       │                 credential store ────────┘  │  (secretStorage, safeStorage, or memory)
       └── apply step ◀── device queue ◀─────────────┘  (writes of Ratatoskr, after the changes)
```

## Modules

| Module | Job |
|---|---|
| `src/main.ts` | The Obsidian adapter. It registers the vault events, the settings tab and the status bar. |
| `src/api/` | The Edge client. `generated/schema.ts` comes from the pinned contract. |
| `src/core/` | The behaviour. It imports no `obsidian` value at run time, so the tests run it in Node. |
| `src/core/device-queue.ts`, `src/core/apply-operation.ts` | The writes of Ratatoskr: read the queue, check the path and the base, apply through `app.vault` and `app.fileManager`, report the result. |

## Rules

- The vault API events `create`, `modify`, `rename` and `delete` are the only input of the changes.
- A folder `rename` is skipped. The `rename` of each file inside it is sent.
- A `create` and a `delete` with equal hashes within 3 seconds become one `renamed` change.
- Paths are sent in Unicode NFC.
- The device sequence increases by one per change. The plugin resends from the committed sequence.
- When the vault already has a `sync` connection, the plugin shows status only and sends nothing.
- Each flush sends the changes first and then applies the device queue, in queue order. A write
  passes the path check and the base check before the plugin touches the file. A rename or a move
  uses `fileManager.renameFile`, so Obsidian updates the links. A delete goes to the trash of the
  system.
- The plugin's own write comes back as a vault event and goes to `ratatoskr-notes` as a change,
  which acknowledges the write.
