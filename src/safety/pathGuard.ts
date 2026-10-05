/**
 * Writes stay inside the sync root. The scanner never follows a symlink, so a
 * symlinked folder inside the root is not part of the synced tree; a write that
 * passes through one would land wherever it points. Before any local mutation,
 * every existing ancestor of the target, from the root down, must be a real
 * directory: not a symlink and not a file or other special entry.
 *
 * The planner keeps such paths out of a plan (see `blockUnsyncableTargets`); this
 * check runs again immediately before the write, so a symlink that appears in
 * between is caught too.
 */
import { lstatSync } from 'node:fs';
import path from 'node:path';

import type { Blocked, Operation, Plan } from '../reconcile/types.js';

export class UnsafePathError extends Error {
  constructor(
    readonly relPath: string,
    detail: string,
  ) {
    super(`Refusing to write ${relPath}: ${detail}`);
    this.name = 'UnsafePathError';
  }
}

/** Root-relative POSIX path made only of real names: no empty, ".", ".." or absolute parts. */
function partsOf(relPath: string): string[] {
  if (relPath === '' || path.isAbsolute(relPath)) throw new UnsafePathError(relPath, 'not a path inside the sync root');
  const parts = relPath.split('/');
  if (parts.some((p) => p === '' || p === '.' || p === '..')) throw new UnsafePathError(relPath, 'not a path inside the sync root');
  return parts;
}

/**
 * Throws `UnsafePathError` unless every existing ancestor of `relPath` under
 * `root` is a real directory. Missing ancestors are fine: they will be created as
 * real directories. The final component itself is not checked (a rename replaces
 * a symlink there rather than following it).
 */
export function assertWritableInsideRoot(root: string, relPath: string): void {
  const parts = partsOf(relPath);
  let current = root;
  for (let i = 0; i < parts.length - 1; i++) {
    current = path.join(current, parts[i] ?? '');
    let st;
    try {
      st = lstatSync(current);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
    const at = parts.slice(0, i + 1).join('/');
    if (st.isSymbolicLink()) throw new UnsafePathError(relPath, `${at} is a symlink`);
    if (!st.isDirectory()) throw new UnsafePathError(relPath, `${at} is not a directory`);
  }
}

/** True when `relPath` is `prefix` itself or lies under it. */
function atOrUnder(relPath: string, prefix: string): boolean {
  return relPath === prefix || relPath.startsWith(`${prefix}/`);
}

/** The local paths an operation would create, write or move into. */
function localTargets(op: Operation): string[] {
  switch (op.kind) {
    case 'create_local_folder':
    case 'download':
    case 'update_baseline':
      return [op.relPath];
    case 'move_local':
      return [op.from, op.to];
    case 'recycle_local':
      return [op.relPath];
    // Remote-side work and baseline removal write nothing locally.
    case 'create_remote_folder':
    case 'upload':
    case 'move_remote':
    case 'trash_remote':
    case 'remove_baseline':
      return [];
  }
}

/**
 * Keep every local write at or under an unsyncable path (a symlink, special file,
 * unreadable entry or invalid name the scanner skipped) out of the plan, and
 * record each as blocked. Without this, a remote folder whose name matches a
 * local symlink looks absent locally and would be created and filled through it.
 */
export function blockUnsyncableTargets(plan: Plan, unsyncable: readonly { relPath: string }[]): Plan {
  if (unsyncable.length === 0) return plan;
  const prefixes = unsyncable.map((u) => u.relPath);
  const blocked: Blocked[] = [];
  const operations = plan.operations.filter((op) => {
    const hit = localTargets(op).find((t) => prefixes.some((p) => atOrUnder(t, p)));
    if (hit === undefined) return true;
    const under = prefixes.find((p) => atOrUnder(hit, p)) ?? hit;
    blocked.push({ reason: 'unsyncable_destination', relPath: hit, remoteUid: 'remoteUid' in op ? op.remoteUid : undefined, detail: `${op.kind} ${hit} would write at or under ${under}, which is not synced (symlink, special file or unreadable)` });
    return false;
  });
  return blocked.length === 0 ? plan : { ...plan, operations, blocked: [...plan.blocked, ...blocked] };
}
