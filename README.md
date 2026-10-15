# Ratatoskr Obsidian Plugin

This plugin connects an Obsidian vault to your Ratatoskr. It sends each change of a file in the vault
to Ratatoskr through Edge, and it applies the changes that you make in Ratatoskr to the vault. Use
it for a vault that does not use Obsidian Sync. For a vault that uses Obsidian Sync, Ratatoskr reads
the vault through Sync, and the plugin shows status only.

- Development: `DEVELOPMENT.md`
- Architecture: `docs/ARCHITECTURE.md`
- Security: `SECURITY.md`
- License: `LICENSE`

## Install

The plugin is not in the community plugin list. Build it and copy two files:

1. Run `npm ci` and `npm run build`.
2. Copy `main.js` and `manifest.json` into `<vault>/.obsidian/plugins/ratatoskr/`.
3. In Obsidian, open **Settings → Community plugins** and turn on **Ratatoskr**.

## Pair the plugin

The plugin pairs as a registered device of kind `obsidian_plugin` (Platform ADR-0016).

1. In the plugin settings, enter the **Edge address**. It must start with `https://`, and it must
   not contain a user name or a password.
2. Enter a **Device name**. Ratatoskr shows this name in your list of devices.
3. Select **Save**. The plugin uses the address only after you save it.
4. In Ratatoskr, make a pairing code.
5. Enter the code in **Pairing code** and select **Pair**.
6. Select **Connect**. The plugin connects this vault with the channel `plugin`.

After the connect, the plugin sends a manifest of the vault. Then it sends each change. At each
start of the plugin, it sends a manifest again, because the vault can change while the plugin is
off.

The credential is bound to the origin of the Edge address at pairing. When you save another
address, the plugin sends nothing to it, and it does not send the credential, the refresh token or
the device secret there. The status line asks you to pair again.

To stop, select **Unpair** in the plugin settings. The plugin deletes the device credential from
the app and forgets the connection. Then remove the device in Ratatoskr. To pause, turn off the
plugin.

## Where the credential is kept

Pairing gives a device id, a device secret, a session credential and a refresh token. The plugin
keeps them outside the vault folder, in the first store that the app has:

| Store | Where | Condition |
|---|---|---|
| `app.secretStorage` | Encrypted with the protected storage of the operating system (on macOS, the Keychain), in the app profile, for this vault only. | Obsidian 1.11.4 or later, on desktop. |
| `remote.safeStorage` | Encrypted with the same protected storage. The plugin keeps the ciphertext in the local storage of the app profile. | An older Obsidian on desktop. |
| Memory | Nowhere on disk. You must pair again after each restart of Obsidian. | A platform without the two stores above. |

The plugin uses the first store that the app has. On a phone or a tablet, it uses
`app.secretStorage` if the app has it, and else memory. There is no store that is specific to
mobile.

The plugin never writes the credential into the vault folder. This includes its own `data.json`.
The vault folder can be copied by Obsidian Sync, iCloud, Git or a backup, and a copy must not carry
the credential. `data.json` keeps only these fields:

| Field | Content |
|---|---|
| `settings.edgeUrl` | The saved Edge address. |
| `settings.deviceName` | The device name. |
| `state.connectionId` | The connection id. |
| `state.nextSequence` | The device sequence of the next change. |
| `state.committedSequence` | The last sequence that Ratatoskr committed. |
| `state.outbox` | The changes that Ratatoskr has not committed yet: paths, kinds, hashes, lengths and sequences. No file content. |
| `state.known` | The path, SHA-256 and length of each file that Ratatoskr has. |
| `state.blocked` | Why the plugin sends nothing: `sync`, `cli` or `channel_mismatch`, or `null`. |
| `state.needsManifest` | `true` when the plugin must send a manifest before the next batch. |
| `state.results` | The results of writes from Ratatoskr that did not reach Ratatoskr yet, by operation id: outcomes, paths of linking notes, and hashes. No file content. |

## What the plugin sends

The plugin talks only to the Edge address that you saved, and only to the origin of the pairing
for a request with a credential. The transport is different on each platform:

| Platform | Transport | Redirect | Limits |
|---|---|---|---|
| Desktop, with `process.getBuiltinModule` (Node 20.16 or later) | The Node `http` and `https` clients. | Not followed. A 3xx answer is refused, and nothing goes to the new address. | The answer body stops at 8 MiB, and at 64 MiB for the bytes of a write. A request stops after 30 s without data, and after 60 s in total. |
| Desktop, without `process.getBuiltinModule` | None. The plugin sends no request, the pairing included, and reads no file for a manifest. The status line asks you to update Obsidian. | Not applicable. | Not applicable. |
| Mobile | Obsidian `requestUrl`, the only transport that the app has. | Followed. `requestUrl` does not report the final address, so the plugin cannot refuse a redirect, and a request with a credential goes to the address of the redirect. | The limits of `requestUrl`. The plugin refuses the bytes of a write over 64 MiB, by the length header first. |

It sends:

| Request | Content |
|---|---|
| `POST /v1/devices/pair` | The pairing code, the kind `obsidian_plugin`, and the device name. |
| `POST /v1/sessions/refresh`, `POST /v1/sessions/device` | The refresh token, or the device id and the device secret, when the session ends. |
| `POST /v1/notes/connections` | The channel `plugin`, the vault id of Obsidian, and the vault name. |
| `POST /v1/notes/connections/{id}/manifest` | The path, SHA-256 and length of each file in the vault. |
| `/v1/notes/connections/{id}/blobs` | The bytes of a file, in chunks, only when Ratatoskr names their SHA-256 as missing. |
| `POST /v1/notes/connections/{id}/changes` | Up to 256 changes. Each change has the path, the kind (`created`, `updated`, `renamed` with the path before the rename in `previous_path`, or `deleted`), the SHA-256 and length of the new bytes (not for `deleted`), and the device sequence. |
| `GET /v1/notes/connections/{id}/device-operations?after=<cursor>` | The cursor of the last page that the plugin read, exactly as Ratatoskr sent it. Nothing for the first page. |
| `GET /v1/notes/connections/{id}/device-operations/{operation_id}/content` | Nothing. The answer is the bytes of a write. |
| `POST /v1/notes/connections/{id}/device-operations/{operation_id}/result` | The result of one write: `applied` with the SHA-256 of the file after the write (none after a delete), `base_mismatch` with the SHA-256 of the local file (`null` when there is no file), or `failed` with a code. |

How the plugin makes the changes:

- It listens to the vault events `create`, `modify`, `rename` and `delete`.
- A rename in Obsidian is one `renamed` change. When Obsidian rewrites links after a rename, each
  rewritten note is an `updated` change.
- A folder rename is one `renamed` change for each file in the folder, and none for the folder.
- A rename outside Obsidian (for example in Finder) arrives as a `create` and a `delete`. When the
  two have the same content hash and come within 3 seconds, the plugin sends one `renamed` change.
- All paths are sent in Unicode NFC.
- The device sequence increases by one for each change. After a restart or a time offline, the
  plugin sends again from the last sequence that Ratatoskr committed.
- When the plugin cannot prove that it saw each change, it sends a manifest again.

How the plugin sends the bytes:

- It sends a batch or a manifest first. Ratatoskr answers with the SHA-256 of the bytes that it
  does not have (`notes.channel.bytes_missing` with `missing_sha256` for a batch, `needed_sha256`
  for a manifest). The plugin uploads only those bytes, and then sends the batch or the manifest
  again.
- Ratatoskr needs no bytes for an empty file, a file over its size limit (64 MiB by default), or a
  file whose first folder is `.obsidian` or `.trash` in any case. The plugin does not upload them.
- When Ratatoskr refuses a batch as too large (`notes.channel.batch_too_large`), the plugin sends
  the changes again in smaller batches, at most `max_changes` each.
- When Ratatoskr failed the connection, for example because no manifest arrived within 30 minutes
  of the connect (`notes.channel.manifest_missing`), the routes of the connection answer
  `notes.connection.not_found`. The plugin then connects the vault again, sends a manifest to the
  new connection, and starts the device sequence of that connection at 1.

## How the plugin applies a change from Ratatoskr

When you create, edit, rename, move or delete a note in Ratatoskr, or set a property, Ratatoskr
keeps the change as a write in a queue of the connection. The write mode of the connection must be
on. The plugin reads the queue and applies each write to the vault.

- **When.** At each flush (every 5 seconds while Obsidian is open), after the plugin sent the
  waiting changes. A phone reads the queue when Obsidian is open on it. Until then, Ratatoskr shows
  the write as waiting for the device.
- **Order.** The plugin reads the queue from the start, page by page. It sends the cursor back
  exactly as Ratatoskr sent it. It applies and reports each write before the next one.
- **The path check.** Before it touches the vault, the plugin refuses a write whose path or new
  path has `.obsidian` or the configuration folder of the vault as its first folder (in any letter
  case), an empty part, a part that ends in a dot or a space (so also `.` and `..`, because Windows
  removes those characters), a leading `/`, a `\`, a `:`, or a control character. It reports
  `failed` with `notes.write.unsafe_path`. Ratatoskr refuses most of these paths too; the plugin
  checks them again on the device.
- **The base check.** Each write names the SHA-256 that the local file must have (for a new file:
  no file). Before a write, the plugin compares that hash with the local file. When they differ,
  you changed the file on this device after Ratatoskr read it. Then the plugin does not change the
  file. It reports `base_mismatch` with the hash of the local file, and it sends the local file as
  a change. Ratatoskr shows a conflict, and you select the result in Ratatoskr. Ratatoskr names
  each path in Unicode NFC. macOS and iOS can keep a file name in NFD, so when the vault has no file
  at the NFC path, the plugin looks for the NFD form of the path. When the plugin applied a write
  before and its result was lost, it reports `applied` and changes nothing: for a `create`, an
  `update` or a `set_property`, the local file already has the SHA-256 that the write gives; for a
  `rename` or a `move`, the old path has no file and the new path has that SHA-256 (or the base
  hash, when Ratatoskr names none).
- **How.** The plugin uses the vault API of Obsidian:

  | Write | Vault API |
  |---|---|
  | `create` | `vault.createBinary`. It creates the folder first when the folder does not exist. |
  | `update` | `vault.modifyBinary`. |
  | `rename`, `move` | `fileManager.renameFile`. Obsidian updates the links to the file by the settings of the vault, as for a rename that you make in Obsidian. |
  | `delete` | `vault.trash` to the trash of the system, or to `.trash` in the vault. The plugin never deletes a file permanently. |
  | `set_property` | `fileManager.processFrontMatter`. It sets one property to the value from Ratatoskr, or removes it. The keys `__proto__`, `constructor` and `prototype` give `failed` with `notes.write.unsafe_path`. |

  The plugin downloads the bytes of a write only after the base check, and it uses them only when
  they have the length and the SHA-256 that Ratatoskr named. Other bytes change nothing: the plugin
  reports `failed` with `notes.channel.refused`.
- **A rename and its links.** Ratatoskr sends a rename or a move with the list of the notes that
  link to the file, each with its base SHA-256 and the SHA-256 that Ratatoskr expects after the
  link update. The plugin checks the path of each linking note. Before the rename, it compares each
  linking note with its base, as for the renamed file: when one differs, it renames nothing,
  reports `base_mismatch` for the whole rename with the SHA-256 of each listed note in `rewrites`
  (each as `base_mismatch`, `null` when the note is gone), and sends each newer note as a change. After the
  rename, Obsidian has updated the links, and the plugin reports each listed note in `rewrites`:
  `applied` with its SHA-256 now, or `base_mismatch` when the note is gone. A note whose SHA-256 is
  not the one that Ratatoskr expects is uploaded before the result.
- **The result.** After a write, the plugin reports `applied` with the SHA-256 of the file (of the
  new path after a rename or a move; no hash after a delete). When Ratatoskr does not have those
  bytes, for example after a property change, or after another plugin changed the file on save, it
  answers `notes.channel.bytes_missing`. The plugin then uploads the bytes and reports again. When
  the vault API refuses a write, for example a rename to a path that has a file, the plugin reports
  `failed` with `notes.channel.refused`. For a write of a kind that the plugin does not know, it
  reports `failed` with `notes.write.unsupported`. In both cases the file in Ratatoskr does not
  change.
- **The echo.** Obsidian reports the change of each write as a vault event, and the plugin sends it
  as a change, as for an edit that you make. Ratatoskr takes that change as the confirmation of its
  write, not as a new edit. Each note whose links Obsidian updated after a rename is an `updated`
  change.
- **When the plugin stops.** When the download, the report or the upload fails, the plugin stops
  the queue at that write and tries again at the next flush. A result that did not reach Ratatoskr
  (for example an error `5xx` or a network error) stays in `data.json`, and the next flush sends
  the same result again, also after a restart, until Ratatoskr answers `200`. The plugin does not
  apply that write a second time. Two cases are different, so that one result never stops the
  queue: when Ratatoskr refuses the result with an error `4xx` other than `401`, `408`, `409` and
  `429`, or names bytes that the file no longer has, the plugin drops the result and checks the
  write again at the next flush. When a full read of the queue no longer lists a write, the plugin
  drops its result. A write stays in the queue until Ratatoskr has its result, so the plugin keeps
  no cursor between two flushes.

## When the plugin sends nothing

In each of these cases, the plugin also applies no write from Ratatoskr.

- **The vault uses Obsidian Sync.** When the vault already has a `sync` connection, the plugin shows
  status only. It sends no change, because each change would arrive two times.
- **The vault uses the export agent.** When the vault already has a `cli` connection, the plugin
  shows status only for the same reason.
- **Another device has the connection.** One `plugin` connection has one device. When a copy of the
  vault on another device tries to connect, send a manifest, upload or send changes, Ratatoskr
  refuses it, and the plugin stops. The status line tells you to use Obsidian Sync to share a vault
  between devices.
- **You removed the connection in Ratatoskr.** The routes of that connection answer
  `410 notes.connection.removed`. The plugin stops, deletes the changes that wait, and does not
  connect again. To send again, select **Connect** in the plugin settings: the plugin makes a new
  connection and sends a manifest of the vault.
- **The Edge address changed after pairing.** Pair again.
- **The credential is from an older version of the plugin.** That version did not keep the Edge
  origin of the pairing. A new pairing is necessary.
- **Update Obsidian.** On desktop, the app has no `process.getBuiltinModule`, so the plugin has no
  transport that refuses a redirect. It sends nothing.
- **The plugin is not paired or not connected.** The status bar tells you the next step.

## What Ratatoskr can read

- Every file of the connected vault that the vault API lists: notes, attachments and other files.
  The plugin does not send the `.obsidian` configuration folder.
- The path, the SHA-256 and the length of each file, and each change after the connect.
- The bytes of each file that Ratatoskr asks for. It does not ask for an empty file, a file over
  its size limit, or a file under `.obsidian` or `.trash`.
- The vault id and the vault name.

Ratatoskr cannot read files outside the vault. It cannot read your Obsidian account, your Obsidian
Sync password, or other vaults. Ratatoskr stores a revision for each change, and it makes an index
of the notes, their links and their tags.

## What Ratatoskr can change

When the write mode of the connection is on, Ratatoskr can create, change, rename, move and delete
files of the vault, and set or remove a property of a note, through the vault API. It changes a file
only when the file has the hash that Ratatoskr read before. A delete moves the file to a trash. The
plugin never writes the `.obsidian` configuration folder for Ratatoskr, and it refuses a path that
could leave the vault folder.
