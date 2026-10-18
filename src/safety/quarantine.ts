/**
 * Quarantine: items the engine refuses to touch until the user releases them.
 */
import type { AuditLog } from '../audit/logger.js';
import type { QuarantineEntry, QuarantineRepo } from '../state/misc.ts';

export type QuarantineReason = 'digest_mismatch' | 'remote_metadata_inconsistent' | 'unreadable' | 'unknown_outcome' | 'verification_failed' | 'manual';

/**
 * Retention bounds. An editor of a shared folder can churn distinct files that
 * fail integrity checks, so the open set and the released history are both
 * capped; the oldest open entry is released (and re-reconciled from scratch,
 * which re-quarantines it if the problem persists) when a new one would exceed
 * the cap.
 */
export const MAX_OPEN_QUARANTINE = 200;
export const MAX_RELEASED_QUARANTINE = 200;

export class QuarantineService {
  constructor(
    private readonly repo: QuarantineRepo,
    private readonly audit: AuditLog,
  ) {}

  quarantine(item: { relPath: string | null; nodeUid: string | null; reason: QuarantineReason; details?: unknown }): QuarantineEntry {
    const entry = this.repo.add({ relPath: item.relPath, nodeUid: item.nodeUid, reason: item.reason, details: item.details ?? null });
    this.audit.append({
      kind: 'safety',
      op: 'quarantine',
      message: `quarantined ${item.relPath ?? item.nodeUid ?? 'item'}: ${item.reason}`,
      ...(item.relPath !== null ? { path: item.relPath } : {}),
      ...(item.nodeUid !== null ? { nodeUid: item.nodeUid } : {}),
      outcome: 'skipped',
      details: { id: entry.id, ...(typeof item.details === 'object' && item.details !== null ? (item.details as Record<string, unknown>) : {}) },
    });
    for (const evicted of this.repo.trim(MAX_OPEN_QUARANTINE, MAX_RELEASED_QUARANTINE)) {
      this.audit.append({
        kind: 'safety',
        op: 'evict_quarantine',
        message: `released quarantined item ${String(evicted.id)} to stay within ${String(MAX_OPEN_QUARANTINE)} open entries; it will be re-reconciled from scratch`,
        ...(evicted.relPath !== null ? { path: evicted.relPath } : {}),
        ...(evicted.nodeUid !== null ? { nodeUid: evicted.nodeUid } : {}),
        outcome: 'ok',
      });
    }
    return entry;
  }

  release(id: number): QuarantineEntry {
    const entry = this.repo.release(id);
    this.audit.append({
      kind: 'user',
      op: 'release_quarantine',
      message: `user released quarantined item ${String(id)}; it will be re-reconciled from scratch`,
      ...(entry.relPath !== null ? { path: entry.relPath } : {}),
      ...(entry.nodeUid !== null ? { nodeUid: entry.nodeUid } : {}),
      outcome: 'ok',
    });
    return entry;
  }

  open(): QuarantineEntry[] {
    return this.repo.open();
  }

  /** Sets for the reconciler input. */
  sets(): { paths: Set<string>; uids: Set<string> } {
    const paths = new Set<string>();
    const uids = new Set<string>();
    for (const e of this.repo.open()) {
      if (e.relPath !== null) paths.add(e.relPath);
      if (e.nodeUid !== null) uids.add(e.nodeUid);
    }
    return { paths, uids };
  }
}
