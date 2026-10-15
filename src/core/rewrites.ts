import type { DeviceOperation, DeviceResult, RewriteMismatch, RewriteResult, RewriteTarget } from '../api/notes';
import type { VaultApp } from './types';
import { hashAt } from './vault-lookup';

// The link rewrites of a rename (workspace OBS-024, `ratatoskr-notes`
// `services/notes/src/api/device_operations.rs`): notes lists each linking note of the rename in
// `rewrites`, Obsidian rewrites the links on the device in `fileManager.renameFile`, and the
// `applied` result names what the device did with each listed note. A note that the result does not
// name counts as not applied, and the group fails.

/** The linking notes of a rename; none for any other operation. */
export function rewriteTargets(operation: DeviceOperation): readonly RewriteTarget[] {
  return operation.rewrites ?? [];
}

/** A file whose hash is not the base hash that notes saw, and its local hash (`null`: no file). */
export interface StaleFile {
  readonly path: string;
  readonly local: string | null;
}

/** The file of the operation and each linking note whose local hash is not its base hash. */
export async function staleFiles(app: VaultApp, operation: DeviceOperation): Promise<StaleFile[]> {
  const stale: StaleFile[] = [];
  for (const file of [{ path: operation.path, base_hash: operation.base_hash }, ...rewriteTargets(operation)]) {
    const local = await hashAt(app, file.path);
    if (local !== file.base_hash) {
      stale.push({ path: file.path, local });
    }
  }
  return stale;
}

/** Whether a linking note of the rename has another hash than its base: then nothing is renamed. */
export async function hasStaleRewrite(app: VaultApp, operation: DeviceOperation): Promise<boolean> {
  for (const target of rewriteTargets(operation)) {
    if ((await hashAt(app, target.path)) !== target.base_hash) {
      return true;
    }
  }
  return false;
}

/**
 * The `base_mismatch` result with the hash of the file of the operation, and for a rename each
 * listed linking note as `base_mismatch` with its own hash (`null`: gone). Notes takes these hashes
 * for the conflicts of the group (`ratatoskr-notes` 7cdb2a2).
 */
export async function mismatchWith(app: VaultApp, seen: { operation: DeviceOperation; local: string | null }): Promise<DeviceResult> {
  const targets = rewriteTargets(seen.operation);
  if (targets.length === 0) {
    return { outcome: 'base_mismatch', local_sha256: seen.local };
  }
  const rewrites: RewriteMismatch[] = [];
  for (const target of targets) {
    rewrites.push({ path: target.path, outcome: 'base_mismatch', local_sha256: await hashAt(app, target.path) });
  }
  return { outcome: 'base_mismatch', local_sha256: seen.local, rewrites };
}

/** The `applied` result with `sha256`, and for a rename what the device did with each linking note. */
export async function appliedWith(app: VaultApp, applied: { operation: DeviceOperation; sha256: string }): Promise<DeviceResult> {
  const targets = rewriteTargets(applied.operation);
  if (targets.length === 0) {
    return { outcome: 'applied', sha256: applied.sha256 };
  }
  const rewrites: RewriteResult[] = [];
  for (const target of targets) {
    const sha256 = await hashAt(app, target.path);
    rewrites.push(sha256 === null ? { path: target.path, outcome: 'base_mismatch', local_sha256: null } : { path: target.path, outcome: 'applied', sha256 });
  }
  return { outcome: 'applied', sha256: applied.sha256, rewrites };
}

/** The linking notes that Obsidian wrote with another hash than notes expected: their bytes go up first. */
export function rewritesToUpload(operation: DeviceOperation, result: DeviceResult): { path: string; sha256: string }[] {
  const expected = new Map(rewriteTargets(operation).map((target) => [target.path, target.expected_sha256]));
  return appliedRewrites(result).filter((rewrite) => rewrite.sha256 !== expected.get(rewrite.path));
}

/** The path of the reported file whose hash is `sha256`: a linking note, or else the file of the operation. */
export function pathOfHash(report: { operation: DeviceOperation; result: DeviceResult }, sha256: string): string {
  const rewrite = appliedRewrites(report.result).find((candidate) => candidate.sha256 === sha256);
  return rewrite?.path ?? report.operation.target_path ?? report.operation.path;
}

function appliedRewrites(result: DeviceResult): { path: string; sha256: string }[] {
  const rewrites = result.outcome === 'applied' ? (result.rewrites ?? []) : [];
  return rewrites.flatMap((rewrite) => (rewrite.outcome === 'applied' ? [{ path: rewrite.path, sha256: rewrite.sha256 }] : []));
}
