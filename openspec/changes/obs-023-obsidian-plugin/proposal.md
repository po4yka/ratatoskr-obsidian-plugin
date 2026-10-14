## Why

OBS-023 connects Obsidian vaults to Ratatoskr. A vault without Obsidian Sync needs a device channel
inside Obsidian. The workspace change `add-notes-vault-connections` (group 11, design D5, spec
`notes-device-channels`) assigns that channel to this new repository.

## What Changes

- Create the repository with the Obsidian sample plugin layout, TypeScript strict mode, the fleet
  files and `ci.yml`, and the Edge types generated from the pinned Platform contract.
- Turn the vault API events into ordered changes with a device sequence: one `renamed` change per
  file for a folder rename, a `create` and `delete` pair with equal hashes within 3 seconds as one
  `renamed` change, and NFC paths.
- Keep the device credential in `app.secretStorage`, with `remote.safeStorage` as the fallback and
  memory as the last option. Never in `data.json`.
- Pair, connect, upload bytes, send batches, reconcile by manifest, become status-only in a vault
  with a `sync` connection, and show a message that points to Sync for `notes.channel_mismatch`.
- Write the README: pairing, credential storage, what the plugin sends, what Ratatoskr can read.

## Capabilities

### New Capabilities

- `obsidian-plugin-channel`: the device side of the `plugin` channel.

### Modified Capabilities

None.

## Impact

- New repository `ratatoskr-obsidian-plugin`.
- It calls the Edge routes `/v1/devices/pair`, `/v1/sessions/device`, `/v1/sessions/refresh`,
  `/v1/notes/connections`, `.../{id}/changes`, `.../{id}/manifest` and `.../{id}/blobs`.
- The notes routes are not in the pinned Edge contract yet. Their shapes come from design D5 and
  must be checked against `ratatoskr-notes` group 8.
