# Architecture

## Context

The plugin is the device side of the `plugin` channel of `ratatoskr-notes` (workspace change
`add-notes-vault-connections`, design D5). It runs inside Obsidian. It talks only to Edge.

```text
Obsidian vault API ──events──▶ batcher ──changes──▶ sync ──HTTPS──▶ Edge ──▶ ratatoskr-notes
                                                  ▲
                         credential store ────────┘   (secretStorage, safeStorage, or memory)
```

## Modules

| Module | Job |
|---|---|
| `src/main.ts` | The Obsidian adapter. It registers the vault events, the settings tab and the status bar. |
| `src/api/` | The Edge client. `generated/schema.ts` comes from the pinned contract. |
| `src/core/` | The behaviour. It imports no `obsidian` value at run time, so the tests run it in Node. |

## Rules

- The vault API events `create`, `modify`, `rename` and `delete` are the only input.
- A folder `rename` is skipped. The `rename` of each file inside it is sent.
- A `create` and a `delete` with equal hashes within 3 seconds become one `renamed` change.
- Paths are sent in Unicode NFC.
- The device sequence increases by one per change. The plugin resends from the committed sequence.
- When the vault already has a `sync` connection, the plugin shows status only and sends nothing.
