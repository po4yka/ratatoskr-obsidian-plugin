# Security Policy for the Ratatoskr Obsidian Plugin

Report a vulnerability privately to the repository owner. Do not publish a device credential, a
refresh token, the content of a vault, a `data.json` file, or a log that contains a path of a real
vault.

A security review is necessary for each change to pairing, credential storage, the requests to
Edge, the data that the plugin persists, and the dependencies that ship in `main.js`.

Baseline:

- The device secret, the session credential and the refresh token stay outside the vault folder.
  On desktop they go into `app.secretStorage`, or into `remote.safeStorage` ciphertext in the local
  storage of the app profile. Where neither exists, they stay in memory only.
- `data.json` holds no secret. It holds the Edge address, the connection id, the device sequence and
  the changes that are not committed yet.
- The plugin talks only to the Edge address that the owner enters, over HTTPS.
- The plugin has no remote code and no `eval`.
- Logs and status text name no credential and no file content.
