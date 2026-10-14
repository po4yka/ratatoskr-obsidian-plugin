# Developing the Ratatoskr Obsidian Plugin

## Toolchain

TypeScript in strict mode, the layout of the Obsidian sample plugin (`manifest.json`,
`versions.json`, `esbuild.config.mjs`, `src/main.ts`), esbuild for the bundle, Vitest for the tests,
ESLint for the lint, and `openapi-typescript` for the Edge types. Every dependency is pinned to an
exact version, and `package-lock.json` is committed.

## Commands

Install once per clone. The Node line is in `.nvmrc`:

```bash
npm ci
```

`.npmrc` pins the public registry, keeps `save-exact`, and sets `legacy-peer-deps`, because
`openapi-typescript@7.13.0` declares its TypeScript peer as `^5.x` and this tree pins 6.0.3.

The gate runs these commands:

```bash
npm run api:check
npm run lint
npm run typecheck
npm run test
npm run build
```

This list and `.github/workflows/ci.yml` are one list. A step in `ci.yml` and
`tests/gate-parity.test.ts` fail when they differ, so change both or neither.

`npm run build` writes `main.js` at the repository root. To try the plugin, copy `main.js` and
`manifest.json` into `<test vault>/.obsidian/plugins/ratatoskr/` of a vault made for the test. Do
not use a vault that holds real notes.

## The Edge types

`openapi/openapi.json` is a byte-exact copy of `ratatoskr-platform/openapi/openapi.json`.
`openapi/openapi.lock.json` records its SHA-256 and the platform commit. To move the pin:

1. Copy the new document from the platform commit.
2. Write its digest and the commit into the lock.
3. Run `npm run api:gen` and commit the regenerated `src/api/generated/schema.ts`.

## Code size limits

`eslint.config.js` carries the size limits: file length, function length, cyclomatic complexity,
and parameter count, all at severity `error`. The values are the fleet TypeScript standard from
`ratatoskr-workspace/docs/QUALITY_GATES.md`. Raising one is a measured change recorded there.

## Tests

The tests run in Node. They use a fake vault API, a fake Edge and temporary directories, and they
never open a real vault or the real Obsidian profile. A test reads an injected clock, never the wall
clock. `tests/fixtures/spike-obsidian-1.14.4/` holds the event and credential recordings of the
workspace spike, copied without change.

## What a clone needs before you plan a change

A change is planned with OpenSpec, which is a CLI a clone installs for itself. Use the version
`.github/workflows/openspec.yml` pins, so your terminal and the gate answer the same:

```bash
npm install --global @fission-ai/openspec@1.10.0
```

Cross-repository behaviour lives in a store, and registering one is per-machine state:

```bash
git clone git@github.com:po4yka/ratatoskr-workspace.git <path>
openspec store register <path> --id ratatoskr-workspace
```

Set the hooks path once per clone:

```bash
git config core.hooksPath .githooks
```
