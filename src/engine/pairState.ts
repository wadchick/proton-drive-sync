/**
 * The stored sync state belongs to one pair of folders: the remote root (by node
 * uid) and the local root (by file-system identity). Applying one pair's
 * baseline to another would make every file missing from the new folder look
 * deleted, and trash it on the other side. When either end changes, the old
 * state is archived (recoverable in `meta`), the old pair's unfinished work is
 * closed, and the baseline is reset so the next run is a first sync, which never
 * deletes. This is the archive-on-next-start that setup.ts promises.
 */
import { lstatSync } from 'node:fs';
import path from 'node:path';

import type { AuditLog } from '../audit/logger.js';
import { sameIdentity, type RootIdentity } from '../config/localRoot.js';
import { BaselineRepo, type BaselineRow } from '../state/baseline.js';
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

/** Baseline rows checked against the folder when the old state has no local root recorded. */
const LEGACY_SAMPLE = 200;

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
 * Does `rows` describe the folder at `localRootPath`? Most of a sample of the
 * recorded items must still be there, at the same path with the same inode. A
 * different folder (even a copy of the same files) fails this; so does one where
 * more than half the items were removed while nothing ran, which then starts as
 * a first sync and downloads them again rather than deleting them remotely.
 */
function baselineDescribesFolder(rows: readonly BaselineRow[], localRootPath: string): boolean {
  if (rows.length === 0) return true; // nothing to apply, so nothing to delete
  const step = Math.ceil(rows.length / LEGACY_SAMPLE);
  let checked = 0;
  let found = 0;
  for (let i = 0; i < rows.length; i += step) {
    const row = rows[i];
    if (row === undefined) continue;
    checked++;
    try {
      if (lstatSync(path.join(localRootPath, row.relPath)).ino === row.localIno) found++;
    } catch {
      // missing: not found
    }
  }
  return found * 2 > checked;
}

/**
 * Record `current` as the pair the stored state belongs to, first resetting that
 * state if it was built for a different pair. Returns true when it reset.
 *
 * A state from a version that recorded only the remote root has no local root to
 * compare. It is adopted only when its baseline still describes the folder at
 * `localRootPath` (see `baselineDescribesFolder`), so an upgrade keeps its sync
 * history but a folder changed before or during the upgrade starts fresh.
 */
export function bindStateToPair(store: StateStore, current: SyncPair, localRootPath: string, audit: AuditLog, now: () => number): boolean {
  const previous = storedPair(store);
  const remoteChanged = previous !== null && previous.remoteRootUid !== current.remoteRootUid;
  const previousLocal = previous === null ? null : previous.localRoot;
  const localChanged =
    previous !== null && (previousLocal !== null ? !sameIdentity(previousLocal, current.localRoot) : !remoteChanged && !baselineDescribesFolder(new BaselineRepo(store).all(), localRootPath));
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
