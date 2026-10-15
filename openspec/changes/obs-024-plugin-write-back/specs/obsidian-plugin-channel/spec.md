## ADDED Requirements

### Requirement: A device checks the base before it applies

Before it applies an operation of the device queue, the plugin SHALL compare the hash of the local
file with the base hash of the operation. When they differ, it SHALL NOT apply the operation, SHALL
report `base_mismatch` with the local hash, and SHALL send the local file through the change
channel.

#### Scenario: The device has a newer local edit

- **WHEN** the plugin receives an `update` whose base hash differs from the hash of the local file
- **THEN** the local file does not change, the plugin reports `base_mismatch` with the local hash, and the local file reaches notes as an `updated` change, verified by `tests/apply-operation.test.ts` "base mismatch is reported, not applied"

### Requirement: The plugin renames through Obsidian

The plugin SHALL apply a `rename` or a `move` with `app.fileManager.renameFile`, so that Obsidian
updates the links on the device. It SHALL report the hash of the renamed file, and each file whose
links changed SHALL reach notes through the change channel.

#### Scenario: A rename on the device

- **WHEN** the plugin applies `rename` of `Projects/Alpha.md` to `Projects/Apollo.md`
- **THEN** it calls `renameFile` once, reports `applied` with the hash of `Projects/Apollo.md`, and sends the note whose link changed as an `updated` change, verified by `tests/apply-operation.test.ts` "rename uses fileManager.renameFile"

### Requirement: Operations apply in queue order

The plugin SHALL read the device queue page by page, with the cursor exactly as notes sent it, and
SHALL apply and report each operation before it applies the next one.

#### Scenario: A rename and then an update of the new path

- **WHEN** the queue holds a `rename` of `A.md` to `B.md`, and the next page holds an `update` of `B.md`
- **THEN** the plugin renames, reports, reads the next page with the cursor of the first, and then updates and reports, verified by `tests/apply-operation.test.ts` "operations apply in queue order"
