## Why

OBS-024 lets Ratatoskr write to a connected Obsidian vault. For a vault on the `plugin` channel,
`ratatoskr-notes` keeps the checked writes in a queue of the connection, and the device must apply
them. The workspace change `add-notes-write-back` (group 11, design D5 and D6, spec
`notes-write-delivery`) assigns the device side to this repository.

## What Changes

- Read the device queue of the connection through Edge, page by page, with the cursor that notes
  sends back.
- Before each operation, compare the hash of the local file with the base hash of the operation.
  When they differ, apply nothing, report `base_mismatch` with the local hash, and send the local
  file through the change channel.
- Apply each operation through the vault API of Obsidian: a rename or a move with
  `app.fileManager.renameFile`, so that Obsidian updates the links on the device.
- Report the result of each operation, in queue order.
- Write the write behaviour in the README.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `obsidian-plugin-channel`: the plugin applies the writes of Ratatoskr.

## Impact

- New Edge routes that the plugin calls: `GET /v1/notes/connections/{id}/device-operations`,
  `GET .../device-operations/{operation_id}/content` and
  `POST .../device-operations/{operation_id}/result`.
- The plugin now changes files in the vault.
- The notes routes are not in the pinned Edge contract. Their shapes come from `ratatoskr-notes`
  `services/notes/src/api/device_operations.rs`.
