# Threat Model

## Assets

- The device secret, the session credential and the refresh token of the paired plugin.
- The content of the vault.

## Threats and controls

| Threat | Control |
|---|---|
| The vault folder is copied by Sync, iCloud, Git or a backup, and the copy carries the credential. | The credential never enters the vault folder. `tests/credential.test.ts` reads every file under a test vault after a pair, a connect and a batch. |
| A copied vault on a second device sends changes for the same connection. | `ratatoskr-notes` refuses the second device with `notes.channel_mismatch`. The plugin stops and points the owner to Obsidian Sync. |
| The plugin and the `sync` channel both send the same vault, which doubles every change. | The plugin becomes status-only when the connect answers `notes.connection.vault_already_connected` with `channel = sync`. |
| A changed file arrives with bytes that do not match its hash. | The plugin sends the SHA-256 of the bytes. `ratatoskr-notes` verifies every upload. |
| A lost response causes a second batch. | The device sequence makes a repeated batch have no second effect. |
| A third-party package in `main.js` is compromised. | Exact versions, a committed lockfile, `npm audit` in the gate, and no runtime dependency. |

## Out of scope

- Mobile credential storage. The iOS measurement is deferred by the owner, so the plugin keeps the
  credential in memory only on a platform without `secretStorage` or `safeStorage`.
