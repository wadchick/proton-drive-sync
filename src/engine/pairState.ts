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

/**
 * Record `current` as the pair the stored state belongs to, first resetting that
 * state if it was built for a different pair. Returns true when it reset.
 *
 * A state from a version that recorded only the remote root is adopted as the
 * current pair when the remote root matches: its local side was never recorded,
 * so there is nothing to compare, and resetting every upgraded install would
 * force a full first sync on all of them.
 */
export function bindStateToPair(store: StateStore, current: SyncPair, audit: AuditLog, now: () => number): boolean {
  const previous = storedPair(store);
  const remoteChanged = previous !== null && previous.remoteRootUid !== current.remoteRootUid;
  // Unknown when the old state predates recording the local side (see above).
  const previousLocal = previous === null ? null : previous.localRoot;
  const localChanged = previousLocal !== null && !sameIdentity(previousLocal, current.localRoot);
  if (remoteChanged || localChanged) {
    store.transaction(() => {
      resetForNewPair(store, previous, { remoteChanged, localChanged }, audit, now);
    });
  }
  store.setMeta(PAIR_KEY, JSON.stringify(current));
  store.setMeta(LEGACY_REMOTE_KEY, current.remoteRootUid);
  return remoteChanged || localChanged;
}

function resetForNewPair(
  store: StateStore,
  previous: { remoteRootUid: string; localRoot: RootIdentity | null } | null,
  changed: { remoteChanged: boolean; localChanged: boolean },
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
  const which = [changed.remoteChanged ? 'remote root' : '', changed.localChanged ? 'local root' : ''].filter((w) => w !== '').join(' and ');
  audit.append({
    kind: 'engine',
    op: 'setup',
    message: `sync pair changed (${which}): archived ${String(rows.length)} baseline row(s), closed ${String(unfinished.length)} unfinished operation(s), ${String(openConflicts.length)} conflict(s) and ${String(quarantined.length)} quarantined item(s); the next run is a first sync`,
    outcome: 'ok',
  });
}
