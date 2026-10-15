import type { DeviceOperation, DeviceResult } from '../api/notes';
import { factsOfBytes } from './hash';
import type { VaultApp, VaultFile } from './types';

/** The code of an operation that the vault API refused, for example a rename onto a file that exists. */
const REFUSED = 'notes.channel.refused';

/** The code of an operation of a kind that this plugin does not know. */
const UNSUPPORTED = 'notes.write.unsupported';

/** One operation, and the loader of its bytes. The bytes are loaded only after the base check. */
export interface Step {
  readonly operation: DeviceOperation;
  readonly content: () => Promise<Uint8Array>;
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
  const { operation } = step;
  const local = await hashAt(app, operation.path);
  if (local !== operation.base_hash) {
    return { outcome: 'base_mismatch', local_sha256: local };
  }
  if (!Object.hasOwn(APPLY, operation.kind)) {
    return { outcome: 'failed', code: UNSUPPORTED };
  }
  const bytes = operation.content === null ? null : await step.content();
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
  return sha256 === null ? { outcome: 'failed', code: REFUSED } : { outcome: 'applied', sha256 };
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

/** The SHA-256 of the file at `path`, or `null` when there is no file. */
async function hashAt(app: VaultApp, path: string): Promise<string | null> {
  const file = app.vault.getFileByPath(path);
  return file === null ? null : (await factsOfBytes(new Uint8Array(await app.vault.readBinary(file)))).sha256;
}

function fileAt(app: VaultApp, path: string): VaultFile {
  const file = app.vault.getFileByPath(path);
  if (file === null) {
    throw new Error('the file of the operation is not in the vault');
  }
  return file;
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
