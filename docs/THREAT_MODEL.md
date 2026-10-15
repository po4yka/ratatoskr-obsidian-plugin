# Threat Model

## Assets

- The device secret, the session credential and the refresh token of the paired plugin.
- The content of the vault.
- The files of the vault, which Ratatoskr can change through the plugin when the write mode of the
  connection is on (workspace change `add-notes-write-back`).

## Threats and controls

| Threat | Control |
|---|---|
| The vault folder is copied by Sync, iCloud, Git or a backup, and the copy carries the credential. | The credential never enters the vault folder. `tests/credential.test.ts` reads every file under a test vault after a pair, a connect and a batch. |
| A copied vault on a second device sends changes for the same connection. | `ratatoskr-notes` refuses the second device with `notes.channel_mismatch`. The plugin stops and points the owner to Obsidian Sync. |
| The plugin and the `sync` channel both send the same vault, which doubles every change. | The plugin becomes status-only when the connect answers `notes.connection.vault_already_connected` with `channel = sync`. |
| A changed file arrives with bytes that do not match its hash. | The plugin sends the SHA-256 of the bytes. `ratatoskr-notes` verifies every upload. |
| A lost response causes a second batch. | The device sequence makes a repeated batch have no second effect. |
| A write from Ratatoskr replaces a local edit that Ratatoskr did not see. | The plugin compares the hash of the local file with the base hash of each write before it applies it. On a difference it changes nothing, reports `base_mismatch`, and sends the local file, and `ratatoskr-notes` raises a conflict for the owner. `tests/apply-operation.test.ts` "base mismatch is reported, not applied". |
| A write reaches the `.obsidian` folder or a path outside the vault folder, through a defect or a compromised server. | The contract `notes/write-request.v1` refuses such a path, and the plugin checks it again before any vault call: a first segment `.obsidian` or `app.vault.configDir` in any letter case, an empty segment, a segment that ends in a dot or a space (Windows removes those, so this covers `.` and `..`), a leading `/`, a `\`, a `:`, or a C0 or DEL character gives `failed` with `notes.write.unsafe_path`. `tests/apply-paths.test.ts`. |
| A delete from Ratatoskr loses a note. | The plugin deletes only with `vault.trash` to the trash of the system, never permanently, and only when the base hash matches. `tests/apply-kinds.test.ts` "delete moves the file to the trash, never permanently". |
| The bytes of a write change between `ratatoskr-notes` and the device. | The plugin writes the bytes only when they have the SHA-256 of `content.digest.hex`. Other bytes change nothing and give `failed` with `notes.channel.refused`. `tests/apply-kinds.test.ts`. |
| A write is applied, and its result is lost. | The write stays in the queue until its result arrives. The vault event of the write reaches `ratatoskr-notes` as a change, which acknowledges the write. |
| A third-party package in `main.js` is compromised. | Exact versions, a committed lockfile, `npm audit` in the gate, and no runtime dependency. |

## Out of scope

- A compromised Edge or `ratatoskr-notes` while the write mode is on. It can change each file whose
  current hash it knows, inside the limits above. The control is the write mode of the connection:
  it starts off, and the owner turns it off to stop all writes.

- Mobile credential storage. The iOS measurement is deferred by the owner, so the plugin keeps the
  credential in memory only on a platform without `secretStorage` or `safeStorage`.
