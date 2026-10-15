# Security Policy for the Ratatoskr Obsidian Plugin

Report a vulnerability privately to the repository owner. Do not publish a device credential, a
refresh token, the content of a vault, a `data.json` file, or a log that contains a path of a real
vault.

A security review is necessary for each change to pairing, credential storage, the requests to
Edge, the data that the plugin persists, the writes that the plugin applies to the vault, and the
dependencies that ship in `main.js`.

Baseline:

- The device secret, the session credential and the refresh token stay outside the vault folder.
  On desktop they go into `app.secretStorage`, or into `remote.safeStorage` ciphertext in the local
  storage of the app profile. Where neither exists, they stay in memory only.
- `data.json` holds no secret. It holds the Edge address, the connection id, the device sequence and
  the changes that are not committed yet, and the results of writes from Ratatoskr that did not
  reach Ratatoskr yet (outcomes, paths and hashes, no file content).
- The plugin talks only to the Edge address that the owner saves, over HTTPS. A request with a
  credential goes only to the Edge origin of the pairing.
- On desktop, the plugin sends with the Node `http` and `https` clients, loaded through
  `process.getBuiltinModule`. It follows no redirect, stops an answer body at 8 MiB (64 MiB for
  the bytes of a write), and stops a request after 30 s without data or 60 s in total. A desktop
  app without `process.getBuiltinModule` gets no transport: the plugin sends no request and asks
  the owner to update Obsidian. It does not use `requestUrl` or `window.require` on desktop.
- On mobile, the only transport is Obsidian `requestUrl`. It follows a redirect and does not report
  the final address, so a redirect from the Edge address can send a credential to another address.
  The plugin cannot refuse this on mobile. It refuses the bytes of a write over 64 MiB there too.
- A renewal changes only the session credential, the refresh token and their expiry times. **Unpair**
  deletes the device credential from the app.
- Ratatoskr can change the vault through the plugin only while the write mode of the connection is
  on. The plugin applies a write only when the local file has the base hash of the write, so it
  never replaces a local edit that Ratatoskr did not see. It refuses, before any vault call, a path
  whose first folder is `.obsidian` or the configuration folder of the vault in any letter case, or
  that has an empty part, a part that ends in a dot or a space, a leading `/`, a `\`, a `:` or a
  control character. It writes only
  bytes with the length and the SHA-256 that Ratatoskr named, and it refuses a property key that
  names the prototype of an object (`__proto__`, `constructor`, `prototype`). A delete goes to the
  trash of the system, never permanently.
- The plugin has no remote code and no `eval`.
- Logs and status text name no credential and no file content.
