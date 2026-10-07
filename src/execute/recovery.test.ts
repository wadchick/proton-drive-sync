import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { INTERNAL_DIR_NAME } from '../config/paths.js';
import type { Operation } from '../reconcile/types.js';
import { ConflictRepo } from '../state/misc.js';
import { sha1Hex } from '../testing/fakeRemote.js';
import { SyncHarness } from '../testing/harness.js';
import { tempDir } from './localWrite.js';

let h: SyncHarness;
beforeEach(() => {
  h = SyncHarness.create();
});
afterEach(() => {
  h.dispose();
});

/** Journal an operation as in_progress, as if the process died right after starting it. */
function inProgress(op: Operation): number {
  const entry = h.journal.plan({ op: op.kind, relPath: 'relPath' in op ? op.relPath : op.to, previousRelPath: 'from' in op ? op.from : null, nodeUid: 'remoteUid' in op ? (op.remoteUid ?? null) : null, intended: op, preState: {} });
  h.journal.start(entry.id);
  return entry.id;
}

describe('recoverJournal', () => {
  it('crash after upload but before completion: completes the entry from the remote state without re-uploading', async () => {
    h.write('u.txt', 'U');
    const uploaded = h.fake.seedFile(h.remoteRootUid, 'u.txt', 'U'); // the upload landed
    const st = (await import('node:fs')).statSync(path.join(h.root, 'u.txt'));
    inProgress({ id: 'x', kind: 'upload', relPath: 'u.txt', mode: 'new', remoteUid: undefined, expectedLocal: { dev: st.dev, ino: st.ino, size: 1, mtimeMs: st.mtimeMs, sha1: sha1Hex('U') }, expectedRemote: undefined, evidence: [] });
    h.reopen();
    const report = await h.recover();
    expect(report).toMatchObject({ completed: 1, failed: 0, abandoned: 0 });
    expect(h.baseline.byPath('u.txt')?.nodeUid).toBe(uploaded.uid);
    expect(h.journal.unresolved()).toEqual([]);
    expect(h.fake.calls.filter((c) => c.op === 'upload')).toHaveLength(0);
    const plan = await h.plan();
    expect(plan.operations).toEqual([]);
    h.assertBaselineConsistent();
  });

  it('crash during download: temp file removed, entry failed, download replanned', async () => {
    const node = h.fake.seedFile(h.remoteRootUid, 'd.txt', 'D');
    mkdirSync(tempDir(h.root), { recursive: true });
    writeFileSync(path.join(tempDir(h.root), 'download-partial'), 'partial');
    inProgress({ id: 'x', kind: 'download', relPath: 'd.txt', remoteUid: node.uid, expectedRemote: { uid: node.uid, parentUid: node.parentUid, name: node.name, revisionUid: node.revisionUid, sha1: node.claimedSha1 }, expectedLocal: undefined, evidence: [] });
    h.reopen();
    const report = await h.recover();
    expect(report).toMatchObject({ completed: 0, failed: 1, abandoned: 0, tempFilesRemoved: 1 });
    expect(readdirSync(tempDir(h.root))).toEqual([]);
    expect(h.journal.byStatus('failed')).toHaveLength(1);
    const plan = await h.plan();
    expect(plan.operations.map((o) => o.kind)).toEqual(['download']);
  });

  it('crash after a completed download but before commit: completes from the local content', async () => {
    const node = h.fake.seedFile(h.remoteRootUid, 'd.txt', 'D');
    h.write('d.txt', 'D'); // the download landed
    inProgress({ id: 'x', kind: 'download', relPath: 'd.txt', remoteUid: node.uid, expectedRemote: { uid: node.uid, parentUid: node.parentUid, name: node.name, revisionUid: node.revisionUid, sha1: node.claimedSha1 }, expectedLocal: undefined, evidence: [] });
    h.reopen();
    expect(await h.recover()).toMatchObject({ completed: 1 });
    expect(h.baseline.byPath('d.txt')?.remoteSha1).toBe(sha1Hex('D'));
    h.assertBaselineConsistent();
  });

  it('unknown outcome: entry abandoned, item quarantined, nothing deleted', async () => {
    h.write('a.txt', 'A');
    const node = h.fake.seedFile(h.remoteRootUid, 'a.txt', 'A');
    await h.settle();
    // A local move whose source and destination are both absent now.
    rmSync(path.join(h.root, 'a.txt'));
    inProgress({ id: 'x', kind: 'move_local', from: 'a.txt', to: 'b.txt', remoteUid: node.uid, expectedLocal: { dev: 1, ino: 1, size: 1, mtimeMs: 1 }, evidence: [] });
    h.reopen();
    const report = await h.recover();
    expect(report).toMatchObject({ abandoned: 1 });
    expect(h.quarantine.open().map((q) => q.reason)).toEqual(['unknown_outcome']);
    expect(h.fake.trashedUids()).toEqual([]);
    expect(h.recycledContents()).toEqual([]);
    const plan = await h.plan();
    expect(plan.operations).toEqual([]);
  });

  it('move already performed locally is completed; trash already performed remotely is completed; planned-but-never-started is abandoned', async () => {
    h.write('m.txt', 'M');
    h.write('t.txt', 'T');
    const m = h.fake.seedFile(h.remoteRootUid, 'm.txt', 'M');
    const t = h.fake.seedFile(h.remoteRootUid, 't.txt', 'T');
    await h.settle();
    const row = h.baseline.byPath('m.txt');
    if (row === null) throw new Error('missing baseline');
    // The remote was renamed (that is what a move_local follows); the local rename happened, then the process died.
    await h.fake.rename(m.uid, 'moved.txt');
    renameSync(path.join(h.root, 'm.txt'), path.join(h.root, 'moved.txt'));
    inProgress({ id: 'x', kind: 'move_local', from: 'm.txt', to: 'moved.txt', remoteUid: m.uid, expectedLocal: { dev: row.localDev, ino: row.localIno, size: row.localSize, mtimeMs: row.localMtimeMs }, evidence: [] });
    // The local copy was deleted (which is why a trash was planned); the remote trash happened, then the process died.
    rmSync(path.join(h.root, 't.txt'));
    await h.fake.trash([t.uid]);
    inProgress({ id: 'y', kind: 'trash_remote', remoteUid: t.uid, relPath: 't.txt', itemKind: 'file', expectedRemote: { uid: t.uid, parentUid: t.parentUid, name: t.name }, evidence: [] });
    h.journal.plan({ op: 'upload', relPath: 'never.txt', previousRelPath: null, nodeUid: null, intended: { kind: 'upload' }, preState: {} });
    h.reopen();
    const report = await h.recover();
    expect(report).toMatchObject({ completed: 2, abandoned: 1, failed: 0 });
    expect(h.baseline.byPath('moved.txt')?.nodeUid).toBe(m.uid);
    expect(h.baseline.byPath('m.txt')).toBeNull();
    expect(h.baseline.byPath('t.txt')).toBeNull();
    expect(h.journal.unresolved()).toEqual([]);
    const plan = await h.plan();
    expect(plan.operations.map((o) => o.kind)).toEqual([]);
    h.assertBaselineConsistent();
  });
});

describe('recovery of an interrupted conflict rename', () => {
  /** The exact journal entry ConflictHandler.handleContent writes and starts before renaming. */
  function journalConflictRename(from: string, to: string, nodeUid: string | null): number {
    const st = statSync(path.join(h.root, from));
    const local = { dev: st.dev, ino: st.ino, size: st.size, mtimeMs: st.mtimeMs };
    const entry = h.journal.plan({ op: 'conflict_rename_local', relPath: to, previousRelPath: from, nodeUid, intended: { kind: 'conflict_rename_local', from, to }, preState: { local } });
    h.journal.start(entry.id);
    return entry.id;
  }

  async function syncedFile(relPath: string, content: string): Promise<string> {
    h.write(relPath, content);
    await h.settle();
    const uid = h.remotePathToUid(relPath);
    if (uid === undefined) throw new Error('not synced');
    return uid;
  }

  it('finishes a rename that happened before the crash: drops the old row and records the conflict', async () => {
    const uid = await syncedFile('same.txt', 'LOCAL');
    const id = journalConflictRename('same.txt', 'same.conflict-host-1.txt', uid);
    renameSync(path.join(h.root, 'same.txt'), path.join(h.root, 'same.conflict-host-1.txt'));

    const report = await h.recover();

    expect(report.completed).toBe(1);
    expect(h.journal.get(id).status).toBe('completed');
    expect(h.baseline.byPath('same.txt'), 'the original path now belongs to the remote version').toBeNull();
    const open = new ConflictRepo(h.store).open();
    expect(open.map((c) => [c.relPath, (c.local as { path?: string }).path])).toEqual([['same.txt', 'same.conflict-host-1.txt']]);
    expect(h.quarantine.sets().paths.size).toBe(0);
    // Running recovery again changes nothing.
    await h.recover();
    expect(new ConflictRepo(h.store).open()).toHaveLength(1);
  });

  it('closes a rename that never happened without quarantining, so the next cycle re-detects it', async () => {
    const uid = await syncedFile('same.txt', 'LOCAL');
    const id = journalConflictRename('same.txt', 'same.conflict-host-1.txt', uid);

    const report = await h.recover();

    expect(report.failed).toBe(1);
    expect(h.journal.get(id).status).toBe('failed');
    expect(h.baseline.byPath('same.txt')?.nodeUid, 'nothing happened, so the row stays').toBe(uid);
    expect(new ConflictRepo(h.store).open()).toEqual([]);
    expect(h.quarantine.sets().paths.size).toBe(0);
  });

  it('closes an unsupported journal entry safely instead of failing startup', async () => {
    const entry = h.journal.plan({ op: 'mystery', relPath: 'x.txt', previousRelPath: null, nodeUid: null, intended: { kind: 'mystery' }, preState: {} });
    h.journal.start(entry.id);

    await expect(h.recover()).resolves.toBeDefined();
    expect(h.journal.get(entry.id).status).toBe('abandoned');
  });
});

describe('temp cleanup never follows a symlink out of the root', () => {
  /** An unrelated folder outside the root, holding files that must survive. */
  function outsideFolder(): string {
    const outside = path.join(h.base, 'outside');
    mkdirSync(path.join(outside, 'tmp'), { recursive: true });
    writeFileSync(path.join(outside, 'precious.txt'), 'P');
    writeFileSync(path.join(outside, 'tmp', 'download-looks-like-ours'), 'Q');
    return outside;
  }

  it('leaves the target alone when the internal folder is a symlink', async () => {
    const outside = outsideFolder();
    rmSync(path.join(h.root, INTERNAL_DIR_NAME), { recursive: true, force: true });
    symlinkSync(outside, path.join(h.root, INTERNAL_DIR_NAME));
    const report = await h.recover();
    expect(report.tempFilesRemoved).toBe(0);
    expect(readdirSync(path.join(outside, 'tmp'))).toEqual(['download-looks-like-ours']);
    expect(readFileSync(path.join(outside, 'precious.txt'), 'utf8')).toBe('P');
  });

  it('leaves the target alone when the temp folder is a symlink', async () => {
    const outside = outsideFolder();
    rmSync(tempDir(h.root), { recursive: true, force: true });
    mkdirSync(path.dirname(tempDir(h.root)), { recursive: true });
    symlinkSync(outside, tempDir(h.root));
    const report = await h.recover();
    expect(report.tempFilesRemoved).toBe(0);
    expect(readdirSync(outside).sort()).toEqual(['precious.txt', 'tmp']);
  });

  it('removes only our own download temp files from the real temp folder', async () => {
    mkdirSync(tempDir(h.root), { recursive: true });
    writeFileSync(path.join(tempDir(h.root), 'download-partial'), 'partial');
    writeFileSync(path.join(tempDir(h.root), 'not-ours.txt'), 'N');
    const report = await h.recover();
    expect(report.tempFilesRemoved).toBe(1);
    expect(readdirSync(tempDir(h.root))).toEqual(['not-ours.txt']);
  });
});
