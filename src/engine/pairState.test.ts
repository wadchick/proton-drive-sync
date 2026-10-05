import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AuditLog } from '../audit/logger.js';
import { SecretRegistry } from '../audit/redact.js';
import type { RootIdentity } from '../config/localRoot.js';
import { BaselineRepo, type BaselineRow } from '../state/baseline.js';
import { StateStore } from '../state/store.js';
import { bindStateToPair, LEGACY_REMOTE_KEY, PAIR_KEY } from './pairState.js';

let dir: string;
let store: StateStore;
let audit: AuditLog;
const now = (): number => 1_700_000_000_000;
beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'pds-pair-'));
  store = StateStore.open(path.join(dir, 'state.db'));
  audit = new AuditLog({ dir: path.join(dir, 'audit'), registry: new SecretRegistry() });
});
afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

const local: RootIdentity = { dev: 41, ino: 256, birthtimeMs: 1_600_000_000_000, fsKey: 'btrfs:abc' };
const row = (relPath: string): BaselineRow => ({
  relPath, nodeUid: `n-${relPath}`, kind: 'file', localDev: 41, localIno: 1, localSize: 1, localMtimeMs: 1, localSha1: 'a'.repeat(40),
  parentUid: 'root', remoteName: relPath, revisionUid: 'r', remoteSha1: 'a'.repeat(40), syncedAt: 1,
});
const rows = (): number => new BaselineRepo(store).all().length;

describe('bindStateToPair', () => {
  it('records the pair on a fresh install without resetting anything', () => {
    expect(bindStateToPair(store, { remoteRootUid: 'R', localRoot: local }, audit, now)).toBe(false);
    expect(JSON.parse(store.getMeta(PAIR_KEY) ?? '{}')).toEqual({ remoteRootUid: 'R', localRoot: local });
    expect(store.getMeta(LEGACY_REMOTE_KEY)).toBe('R');
  });

  it('adopts state from a version that recorded only the remote root, when that root matches', () => {
    store.setMeta(LEGACY_REMOTE_KEY, 'R');
    new BaselineRepo(store).upsert(row('a.txt'));
    expect(bindStateToPair(store, { remoteRootUid: 'R', localRoot: local }, audit, now)).toBe(false);
    expect(rows()).toBe(1);
  });

  it('resets when the remote root changes, as before', () => {
    store.setMeta(LEGACY_REMOTE_KEY, 'R');
    new BaselineRepo(store).upsert(row('a.txt'));
    expect(bindStateToPair(store, { remoteRootUid: 'R2', localRoot: local }, audit, now)).toBe(true);
    expect(rows()).toBe(0);
  });

  it('resets when only the local root changes, and keeps the old baseline recoverable', () => {
    bindStateToPair(store, { remoteRootUid: 'R', localRoot: local }, audit, now);
    new BaselineRepo(store).upsert(row('old.txt'));
    const other: RootIdentity = { dev: 41, ino: 999, birthtimeMs: 1_650_000_000_000, fsKey: 'btrfs:abc' };
    expect(bindStateToPair(store, { remoteRootUid: 'R', localRoot: other }, audit, now)).toBe(true);
    expect(rows()).toBe(0);
    const archived = store.getMeta(`archived_baseline:R:${String(now())}`);
    expect((JSON.parse(archived ?? '[]') as BaselineRow[]).map((r) => r.relPath)).toEqual(['old.txt']);
  });

  it('treats a btrfs device number that changed after a reboot as the same folder', () => {
    bindStateToPair(store, { remoteRootUid: 'R', localRoot: local }, audit, now);
    new BaselineRepo(store).upsert(row('a.txt'));
    expect(bindStateToPair(store, { remoteRootUid: 'R', localRoot: { ...local, dev: 77 } }, audit, now)).toBe(false);
    expect(rows()).toBe(1);
  });

  it('treats a replaced folder that reused the inode as a different folder', () => {
    bindStateToPair(store, { remoteRootUid: 'R', localRoot: local }, audit, now);
    new BaselineRepo(store).upsert(row('a.txt'));
    expect(bindStateToPair(store, { remoteRootUid: 'R', localRoot: { ...local, birthtimeMs: 1_699_000_000_000 } }, audit, now)).toBe(true);
    expect(rows()).toBe(0);
  });
});
