/**
 * The stored sync state belongs to one pair of folders: the remote root (by node
 * uid) and the local root (by file-system identity). Applying one pair's
 * baseline to another would make every file missing from the new folder look
 * deleted, and trash it on the other side. When either end changes, the old
 * state is archived (recoverable in `meta`), the old pair's unfinished work is
 * closed, and the baseline is reset so the next run is a first sync, which never
 * deletes. This is the archive-on-next-start that setup.ts promises.
 */
import type { AuditLog } from '../audit/logger.js';
import { sameIdentity, type RootIdentity } from '../config/localRoot.js';
import { BaselineRepo } from '../state/baseline.js';
import { JournalRepo } from '../state/journal.js';
import { ConflictRepo, QuarantineRepo } from '../state/misc.js';
import type { StateStore } from '../state/store.js';

export const PAIR_KEY = 'baseline_pair';
/** Written by versions that recorded only the remote root; still kept up to date. */
export const LEGACY_REMOTE_KEY = 'baseline_remote_root';

export interface SyncPair {
  remoteRootUid: string;
  localRoot: RootIdentity;
}

function storedPair(store: StateStore): { remoteRootUid: string; localRoot: RootIdentity | null } | null {
  const raw = store.getMeta(PAIR_KEY);
  if (raw !== null) {
    try {
      const parsed = JSON.parse(raw) as { remoteRootUid?: unknown; localRoot?: unknown };
      if (typeof parsed.remoteRootUid === 'string' && typeof parsed.localRoot === 'object' && parsed.localRoot !== null) {
        return { remoteRootUid: parsed.remoteRootUid, localRoot: parsed.localRoot as RootIdentity };
      }
    } catch {
      // Unreadable: fall back to the legacy key below.
    }
  }
  const legacy = store.getMeta(LEGACY_REMOTE_KEY);
  return legacy === null ? null : { remoteRootUid: legacy, localRoot: null };
}

export interface PairChange {
  remoteChanged: boolean;
  /** The local root differs, or was never recorded for a non-empty state (see `pairChange`). */
  localChanged: boolean;
}

/**
 * Whether the stored state was built for a different pair than `current`. Reads only.
 *
 * State from a version that recorded only the remote root cannot show which local
 * folder it was built from: the files may have been moved into a new folder (keeping
 * their inodes) with some left behind, so no check of the folder proves it is the
 * same one. A non-empty such state counts as a local change and is reset; the next
 * run is a first sync, which pairs the same files again and deletes nothing.
 */
export function pairChange(store: StateStore, current: SyncPair): PairChange | null {
  const previous = storedPair(store);
  const remoteChanged = previous !== null && previous.remoteRootUid !== current.remoteRootUid;
  const previousLocal = previous === null ? null : previous.localRoot;
  const localChanged = previousLocal !== null ? !sameIdentity(previousLocal, current.localRoot) : new BaselineRepo(store).count() > 0;
  return remoteChanged || localChanged ? { remoteChanged, localChanged } : null;
}

/**
 * Record `current` as the pair the stored state belongs to, first resetting that
 * state if it was built for a different pair (see `pairChange`). Returns true when
 * it reset.
 */
export function bindStateToPair(store: StateStore, current: SyncPair, audit: AuditLog, now: () => number): boolean {
  const changed = pairChange(store, current);
  if (changed !== null) {
    const previous = storedPair(store);
    store.transaction(() => {
      resetForNewPair(store, previous, changed, audit, now);
    });
  }
  store.setMeta(PAIR_KEY, JSON.stringify(current));
  store.setMeta(LEGACY_REMOTE_KEY, current.remoteRootUid);
  return changed !== null;
}

function resetForNewPair(
  store: StateStore,
  previous: { remoteRootUid: string; localRoot: RootIdentity | null } | null,
  changed: PairChange,
  audit: AuditLog,
  now: () => number,
): void {
  const baseline = new BaselineRepo(store);
  const journal = new JournalRepo(store);
  const conflicts = new ConflictRepo(store);
  const quarantine = new QuarantineRepo(store);
  const at = String(now());
  const rows = baseline.all();
  const unfinished = journal.unresolved();
  const openConflicts = conflicts.open();
  const quarantined = quarantine.open();
  // Keep everything recoverable before closing it.
  if (rows.length > 0) store.setMeta(`archived_baseline:${previous?.remoteRootUid ?? 'unknown'}:${at}`, JSON.stringify(rows));
  if (unfinished.length + openConflicts.length + quarantined.length > 0) {
    store.setMeta(`archived_pair_state:${at}`, JSON.stringify({ pair: previous, journal: unfinished, conflicts: openConflicts, quarantine: quarantined }));
  }
  // The old pair's paths mean nothing in the new one: never recover, resolve or hold them here.
  for (const entry of unfinished) journal.abandon(entry.id, 'sync pair changed');
  for (const conflict of openConflicts) conflicts.resolve(conflict.id, 'pair_changed');
  for (const item of quarantined) quarantine.release(item.id);
  baseline.clear();
  const which = [changed.remoteChanged ? 'remote root' : '', changed.localChanged ? ((previous?.localRoot ?? null) === null ? 'local root not recorded' : 'local root') : ''].filter((w) => w !== '').join(' and ');
  audit.append({
    kind: 'engine',
    op: 'setup',
    message: `sync pair changed (${which}): archived ${String(rows.length)} baseline row(s), closed ${String(unfinished.length)} unfinished operation(s), ${String(openConflicts.length)} conflict(s) and ${String(quarantined.length)} quarantined item(s); the next run is a first sync`,
    outcome: 'ok',
  });
}
