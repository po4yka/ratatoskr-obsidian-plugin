import type { DeviceOperation, DeviceResult } from '../api/notes';
import { appliedWith, hasStaleRewrite, rewriteTargets } from './rewrites';
import type { VaultApp } from './types';
import { fileAt, hashAt } from './vault-lookup';

/** The code of an operation that the vault API refused, for example a rename onto a file that exists. */
const REFUSED = 'notes.channel.refused';

/** The code of an operation of a kind that this plugin does not know. */
const UNSUPPORTED = 'notes.write.unsupported';

/** The code of an operation whose path the plugin never touches (`isUnsafe`). */
const UNSAFE_PATH = 'notes.write.unsafe_path';

/**
 * One operation, and the loader of its bytes. The bytes are loaded only after the base check. The
 * loader gives `null` for bytes that do not have the hash of the content.
 */
export interface Step {
  readonly operation: DeviceOperation;
  readonly content: () => Promise<Uint8Array | null>;
}

interface Write {
  readonly operation: DeviceOperation;
  readonly bytes: Uint8Array | null;
}

type Apply = (app: VaultApp, write: Write) => Promise<void>;

const APPLY: Record<DeviceOperation['kind'], Apply> = {
  create: async (app, write) => {
    await parentFolder(app, write.operation.path);
    await app.vault.createBinary(write.operation.path, buffer(write.bytes));
  },
  update: (app, write) => app.vault.modifyBinary(fileAt(app, write.operation.path), buffer(write.bytes)),
  // `renameFile`, not `vault.rename`: Obsidian then updates the links to the file on this device.
  rename: (app, write) => renameTo(app, write.operation),
  move: (app, write) => renameTo(app, write.operation),
  delete: (app, write) => app.vault.trash(fileAt(app, write.operation.path), true),
  set_property: (app, write) => setProperty(app, write),
};

/**
 * Applies one operation of the device queue through the vault API (workspace OBS-024 design D5):
 * the base check first, then the write. Returns the result that the plugin reports to notes. When
 * the bytes cannot be loaded, it throws: that is not a result, and the operation stays in the queue.
 */
export async function applyOperation(app: VaultApp, step: Step): Promise<DeviceResult> {
  return (await refusal(app, step.operation)) ?? write(app, step);
}

/** Why the plugin does not apply the operation, or `null`. The path check comes before any vault call. */
async function refusal(app: VaultApp, operation: DeviceOperation): Promise<DeviceResult | null> {
  if (isUnsafeOperation(app, operation)) {
    return { outcome: 'failed', code: UNSAFE_PATH };
  }
  const local = await hashAt(app, operation.path);
  if (local !== operation.base_hash) {
    return otherBase(app, { operation, local });
  }
  // A rename and its link rewrites are one group: one linking note with another base stops all.
  if (MOVES.has(operation.kind) && (await hasStaleRewrite(app, operation))) {
    return { outcome: 'base_mismatch', local_sha256: local };
  }
  return Object.hasOwn(APPLY, operation.kind) ? null : { outcome: 'failed', code: UNSUPPORTED };
}

/** The kinds whose bytes land at `path`, and the kinds that move the file to `target_path`. */
const WRITES_AT_PATH = new Set(['create', 'update', 'set_property']);
const MOVES = new Set(['rename', 'move']);

interface Seen {
  readonly operation: DeviceOperation;
  /** The hash of the file at `path`, or `null` when there is no file. */
  readonly local: string | null;
}

/**
 * The result for a local file without the base hash. A write that the device applied before its
 * result was lost is `applied`, not a conflict (`earlierResult`).
 */
async function otherBase(app: VaultApp, seen: Seen): Promise<DeviceResult> {
  const earlier = await earlierResult(app, seen);
  return earlier === null ? { outcome: 'base_mismatch', local_sha256: seen.local } : appliedWith(app, { operation: seen.operation, sha256: earlier });
}

/**
 * The hash of a write that the device already applied, or `null`: for a create, an update or a
 * property, the file at `path` has `expected_sha256`; for a rename or a move, `path` has no file and
 * the file at `target_path` has `expected_sha256`, or the base hash when notes names none.
 */
async function earlierResult(app: VaultApp, seen: Seen): Promise<string | null> {
  const { operation, local } = seen;
  if (WRITES_AT_PATH.has(operation.kind)) {
    return local !== null && local === operation.expected_sha256 ? local : null;
  }
  return local === null && MOVES.has(operation.kind) ? movedBefore(app, operation) : null;
}

async function movedBefore(app: VaultApp, operation: DeviceOperation): Promise<string | null> {
  if (operation.target_path === null) {
    return null;
  }
  const target = await hashAt(app, operation.target_path);
  return target !== null && target === (operation.expected_sha256 ?? operation.base_hash) ? target : null;
}

/** Whether a path of the operation, of a linking note, or its property key is one that the plugin never touches. */
function isUnsafeOperation(app: VaultApp, operation: DeviceOperation): boolean {
  const configDir = (app.vault.configDir ?? '.obsidian').toLowerCase();
  const paths = [operation.path, operation.target_path, ...rewriteTargets(operation).map((target) => target.path)];
  return paths.some((path) => path !== null && isUnsafe(path, configDir)) || isUnsafeKey(operation.property_key);
}

/** A frontmatter key that names the prototype of the object, which the write would change instead. */
function isUnsafeKey(key: string | null): boolean {
  return key === '__proto__' || key === 'constructor' || key === 'prototype';
}

/**
 * A path that the plugin never touches, whatever notes sends: a `\`, a `:`, a C0 control character
 * or DEL; a first segment that is `.obsidian` or the `configDir` of the vault, in any letter case;
 * an empty segment, so also a leading `/`; or a segment that ends in a dot or a space, so also `.`
 * and `..`. Windows reads `\` as a separator and `:` as a drive or a stream, and it removes trailing
 * dots and spaces from every name, so `.. ` is `..` there. The contract `notes/write-request.v1`
 * refuses most of these paths too; this is the second check, on the device.
 */
function isUnsafe(path: string, configDir: string): boolean {
  const segments = path.split('/');
  const first = (segments[0] ?? '').toLowerCase();
  return hasUnsafeCharacter(path) || first === '.obsidian' || first === configDir || segments.some(isUnsafeSegment);
}

function isUnsafeSegment(segment: string): boolean {
  return segment === '' || segment.endsWith('.') || segment.endsWith(' ');
}

function hasUnsafeCharacter(path: string): boolean {
  return [...path].some((character) => {
    const code = character.charCodeAt(0);
    return character === '\\' || character === ':' || code < 0x20 || code === 0x7f;
  });
}

async function write(app: VaultApp, step: Step): Promise<DeviceResult> {
  const { operation } = step;
  const bytes = operation.content === null ? null : await step.content();
  if (operation.content !== null && bytes === null) {
    return { outcome: 'failed', code: REFUSED };
  }
  try {
    await APPLY[operation.kind](app, { operation, bytes });
  } catch {
    return { outcome: 'failed', code: REFUSED };
  }
  return applied(app, operation);
}

/** The result of an applied operation: the hash of the file at its path, or at its target after a rename. */
async function applied(app: VaultApp, operation: DeviceOperation): Promise<DeviceResult> {
  if (operation.kind === 'delete') {
    return { outcome: 'applied' };
  }
  const sha256 = await hashAt(app, operation.target_path ?? operation.path);
  return sha256 === null ? { outcome: 'failed', code: REFUSED } : appliedWith(app, { operation, sha256 });
}

async function renameTo(app: VaultApp, operation: DeviceOperation): Promise<void> {
  const target = required(operation.target_path);
  await parentFolder(app, target);
  await app.fileManager.renameFile(fileAt(app, operation.path), target);
}

/** Sets a frontmatter key to the JSON value of the bytes, or removes it. Obsidian keeps the other bytes. */
async function setProperty(app: VaultApp, write: Write): Promise<void> {
  const { operation } = write;
  const key = required(operation.property_key);
  const remove = operation.property_change === 'remove';
  const value: unknown = remove ? undefined : JSON.parse(new TextDecoder().decode(required(write.bytes)));
  await app.fileManager.processFrontMatter(fileAt(app, operation.path), (frontmatter) => {
    if (remove) {
      Reflect.deleteProperty(frontmatter, key);
    } else {
      frontmatter[key] = value;
    }
  });
}

/** Creates the folder of `path` when it does not exist. */
async function parentFolder(app: VaultApp, path: string): Promise<void> {
  const folder = path.slice(0, Math.max(path.lastIndexOf('/'), 0));
  if (folder !== '' && app.vault.getFolderByPath(folder) === null) {
    await app.vault.createFolder(folder);
  }
}

/** A copy in an `ArrayBuffer` of its own: a `Buffer` can be a view into a larger pool. */
function buffer(bytes: Uint8Array | null): ArrayBuffer {
  return new Uint8Array(required(bytes)).buffer;
}

function required<T>(value: T | null): T {
  if (value === null) {
    throw new Error('the operation has no value for a field that its kind needs');
  }
  return value;
}
