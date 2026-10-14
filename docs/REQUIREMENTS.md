# Requirements

The requirements come from the workspace change `add-notes-vault-connections`, spec
`notes-device-channels`, and its design D5. This file lists the part that this repository owns.

1. The plugin pairs through Platform device pairing as a registered device of kind
   `obsidian_plugin`.
2. The plugin keeps its credential outside the vault folder: `app.secretStorage` on desktop,
   `remote.safeStorage` as the fallback, and memory only where neither exists. It never writes the
   credential into `data.json`.
3. The plugin connects the vault with `channel = plugin` and its vault key.
4. A change batch holds at most 256 changes. Each change names the NFC path, the kind, the SHA-256
   and the byte length of the new bytes (not for `deleted`), and the device sequence.
5. Bytes that Ratatoskr does not hold are uploaded through the transfer contract before the batch
   that names them.
6. After a gap that the plugin cannot prove it observed, it sends a manifest of every path and hash.
7. In a vault that already has a `sync` connection, the plugin sends no change.
8. For `notes.channel_mismatch`, the plugin shows a message that points the owner to Obsidian Sync.
