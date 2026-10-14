# Ratatoskr Obsidian Plugin

This plugin connects an Obsidian vault to your Ratatoskr. It sends each change of a file in the vault
to Ratatoskr through Edge. Use it for a vault that does not use Obsidian Sync. For a vault that uses
Obsidian Sync, Ratatoskr reads the vault through Sync, and the plugin shows status only.

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

To stop, remove the device in Ratatoskr, or turn off the plugin.

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

## What the plugin sends

The plugin talks only to the Edge address that you saved, and only to the origin of the pairing
for a request with a credential. On desktop, it follows no HTTP redirect: a redirect is refused,
and nothing goes to the new address. On mobile, Obsidian `requestUrl` follows a redirect and does
not report where, so the plugin cannot refuse it there. It sends:

| Request | Content |
|---|---|
| `POST /v1/devices/pair` | The pairing code, the kind `obsidian_plugin`, and the device name. |
| `POST /v1/sessions/refresh`, `POST /v1/sessions/device` | The refresh token, or the device id and the device secret, when the session ends. |
| `POST /v1/notes/connections` | The channel `plugin`, the vault id of Obsidian, and the vault name. |
| `POST /v1/notes/connections/{id}/manifest` | The path, SHA-256 and length of each file in the vault. |
| `/v1/notes/connections/{id}/blobs` | The bytes of a new or changed file, in chunks, before the change that names them. |
| `POST /v1/notes/connections/{id}/changes` | Up to 256 changes. Each change has the path, the kind (`created`, `updated`, `renamed` with the old path, or `deleted`), the SHA-256 and length of the new bytes (not for `deleted`), and the device sequence. |

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

## When the plugin sends nothing

- **The vault uses Obsidian Sync.** When the vault already has a `sync` connection, the plugin shows
  status only. It sends no change, because each change would arrive two times.
- **The vault uses the export agent.** When the vault already has a `cli` connection, the plugin
  shows status only for the same reason.
- **Another device has the connection.** One `plugin` connection has one device. When a copy of the
  vault on another device tries to connect, send a manifest, upload or send changes, Ratatoskr
  refuses it, and the plugin stops. The status line tells you to use Obsidian Sync to share a vault
  between devices.
- **The Edge address changed after pairing.** Pair again.
- **The plugin is not paired or not connected.** The status bar tells you the next step.

## What Ratatoskr can read

- Every file of the connected vault that the vault API lists: notes, attachments and other files.
  The plugin does not send the `.obsidian` configuration folder.
- The path, the bytes, the SHA-256 and the length of each file, and each change after the connect.
- The vault id and the vault name.

Ratatoskr cannot read files outside the vault. It cannot read your Obsidian account, your Obsidian
Sync password, or other vaults. Ratatoskr stores a revision for each change, and it makes an index
of the notes, their links and their tags.
