## ADDED Requirements

### Requirement: A rename inside Obsidian is one renamed change

The plugin SHALL turn a vault `rename` event of a file into one `renamed` change that names the old
path, and a `modify` event into an `updated` change. Each change SHALL carry the next device
sequence.

#### Scenario: A note is renamed and a link is rewritten

- **WHEN** the batcher receives the recorded `rename` and `modify` events of a note rename
- **THEN** it releases exactly one `renamed` change with the old path, verified by `tests/batcher.test.ts` "a rename arrives as one renamed change"

### Requirement: A folder rename moves each file once

The plugin SHALL skip the `rename` event of a folder and send the `rename` event of each file.

#### Scenario: A folder with three notes is renamed

- **WHEN** the batcher replays the recorded folder rename (one folder `rename`, then one `rename` per file)
- **THEN** it releases exactly one `renamed` change per file and none for the folder, verified by `tests/batcher.test.ts` "a folder rename moves each file once"

### Requirement: An outside rename is paired by hash

The plugin SHALL pair a `create` and a `delete` with equal content hashes within 3 seconds into one
`renamed` change, and SHALL send paths in Unicode NFC.

#### Scenario: A note is renamed in Finder

- **WHEN** the batcher replays `create` and then `delete` 1 second later with equal hashes
- **THEN** it releases one `renamed` change, verified by `tests/batcher.test.ts` "an outside rename is paired by hash"

#### Scenario: A note has an NFD name

- **WHEN** the batcher receives a `create` event whose path is in NFD
- **THEN** the change names the NFC path, verified by `tests/batcher.test.ts` "a path is sent in NFC"

### Requirement: The credential never enters the vault folder

The plugin SHALL keep the device credential in `app.secretStorage` on desktop, in `remote.safeStorage`
ciphertext where `secretStorage` does not exist, and in memory where neither exists.

#### Scenario: The plugin pairs, connects and sends a batch

- **WHEN** the plugin pairs, connects and sends a batch in a test vault with a fake Edge
- **THEN** no file under the vault folder contains the credential or the refresh token, verified by `tests/credential.test.ts` "credential_never_written_to_data_json"

### Requirement: A sync connection makes the plugin status-only

When the connect answers `notes.connection.vault_already_connected` with `channel = sync`, the
plugin SHALL send no batch and SHALL show its status only.

#### Scenario: The vault already uses Sync

- **WHEN** the connect request is answered with `notes.connection.vault_already_connected` and `channel = sync`
- **THEN** the plugin sends no batch, verified by `tests/sync.test.ts` "a sync connection makes the plugin status-only"
