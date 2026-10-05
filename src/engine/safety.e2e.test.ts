import { chmodSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { EngineHarness } from '../testing/engineHarness.js';

/**
 * "Absence is not a delete" (spec: test-suite / Absence is not a delete). A path
 * that vanishes from a partial view — ignored after a sync, unreadable, replaced
 * by a symlink, missing from an empty/incomplete listing, or gone because the
 * local root was swapped — must never cause a remote trash or a local recycle.
 *
 * Each scenario mutates the world after a clean sync and then forces a full
 * re-evaluation with `restart()` (a fresh watcher scan and remote refresh), so
 * the reconciler really re-sees the changed side rather than a cached snapshot.
 */

const RESTING = ['idle', 'attention', 'awaiting_confirmation', 'error', 'paused', 'needs_login', 'offline'] as const;

let h: EngineHarness;
beforeEach(() => {
  h = EngineHarness.create();
});
afterEach(async () => {
  h.assertNoUserContentLost();
  await h.dispose();
});

/** Let the current/next cycle come to rest, then nudge one more and rest again. */
async function settle(): Promise<void> {
  await h.waitFor([...RESTING]);
  await h.bundle?.engine.syncNow().catch(() => undefined);
  await h.waitFor([...RESTING]);
}

describe('absence is not a delete', () => {
  it('Ignore after sync: a previously synced file added to ignore is left on both sides', async () => {
    h.write('keep.txt', 'K');
    h.write('secret.txt', 'S');
    await h.start();
    await h.waitForConvergence();
    expect(h.remotePathToUid('secret.txt')).toBeDefined();

    h.config = { ...h.config, ignore: [...h.config.ignore, 'secret.txt'] };
    await h.restart();
    await settle();

    expect(h.fake.trashedUids(), 'ignored-after-sync must not trash the remote node').toEqual([]);
    expect(existsSync(path.join(h.root, 'secret.txt')), 'the ignored local file must remain').toBe(true);
    expect(readFileSync(path.join(h.root, 'secret.txt'), 'utf8')).toBe('S');
  });

  it('Unreadable after sync: a file that becomes unreadable is not trashed remotely', async () => {
    h.write('doc.txt', 'D');
    await h.start();
    await h.waitForConvergence();

    chmodSync(path.join(h.root, 'doc.txt'), 0o000);
    try {
      await h.restart();
      await settle();
      expect(h.fake.trashedUids(), 'an unreadable local file must not trash the remote node').toEqual([]);
    } finally {
      chmodSync(path.join(h.root, 'doc.txt'), 0o644); // so dispose can clean up
    }
  });

  it('Symlink after sync: a file replaced by a symlink is not trashed remotely', async () => {
    h.write('link-me.txt', 'L');
    await h.start();
    await h.waitForConvergence();

    rmSync(path.join(h.root, 'link-me.txt'));
    symlinkSync('/etc/hostname', path.join(h.root, 'link-me.txt'));
    await h.restart();
    await settle();

    expect(h.fake.trashedUids(), 'a symlink replacing a synced file must not trash the remote node').toEqual([]);
  });

  it('Symlinked folder: a remote file under a local symlink is never written through it', async () => {
    // root/linked -> ../outside, and Proton has linked/secret.txt that was never synced.
    const outside = path.join(h.root, '..', 'outside');
    mkdirSync(outside);
    symlinkSync(outside, path.join(h.root, 'linked'));
    const folder = h.fake.seedFolder(h.remoteRootUid, 'linked');
    h.fake.seedFile(folder.uid, 'secret.txt', 'REMOTE');
    await h.start();
    await settle();

    expect(readdirSync(outside), 'nothing may be written outside the sync root').toEqual([]);
    expect(lstatSync(path.join(h.root, 'linked')).isSymbolicLink(), 'the symlink itself is left alone').toBe(true);
  });

  it('Symlinked folder deeper in the tree: a nested link is not written through either', async () => {
    const outside = path.join(h.root, '..', 'outside-nested');
    mkdirSync(outside);
    mkdirSync(path.join(h.root, 'docs'));
    symlinkSync(outside, path.join(h.root, 'docs', 'linked'));
    const docs = h.fake.seedFolder(h.remoteRootUid, 'docs');
    const linked = h.fake.seedFolder(docs.uid, 'linked');
    const deeper = h.fake.seedFolder(linked.uid, 'deeper');
    h.fake.seedFile(linked.uid, 'a.txt', 'A');
    h.fake.seedFile(deeper.uid, 'b.txt', 'B');
    await h.start();
    await settle();

    expect(readdirSync(outside), 'nothing may be written outside the sync root').toEqual([]);
  });

  it('Incomplete or empty remote listing: a failed then empty listing trashes and recycles nothing', async () => {
    h.write('a.txt', 'A');
    h.write('b.txt', 'B');
    await h.start();
    await h.waitForConvergence();
    const recycledBefore = h.recycledContents().length;

    // A listing that fails outright (the first refresh after restart throws).
    h.fake.injectFault('list', { kind: 'connection' });
    await h.restart();
    await settle();
    expect(h.fake.trashedUids(), 'a failed listing must not trash anything').toEqual([]);
    expect(h.recycledContents().length, 'a failed listing must not recycle anything').toBe(recycledBefore);

    // A listing that returns only the root (looks empty) while the baseline is populated.
    h.fake.listSuppressed = () => true;
    await h.restart();
    await settle();
    expect(h.fake.trashedUids(), 'an empty listing must not trash anything').toEqual([]);
    expect(h.recycledContents().length, 'an empty listing must not recycle anything').toBe(recycledBefore);
    h.fake.listSuppressed = undefined;
  });

  it('Local root replaced: swapping the root directory for a new inode pauses without deleting', async () => {
    h.write('one.txt', '1');
    h.write('two.txt', '2');
    await h.start();
    await h.waitForConvergence();

    // Replace the directory at the same path with a different filesystem object.
    rmSync(h.root, { recursive: true, force: true });
    mkdirSync(h.root);
    await h.restart();
    await settle();

    expect(h.fake.trashedUids(), 'a replaced root must not trash the remote tree').toEqual([]);
    expect(['error', 'paused', 'offline', 'needs_login'], `state was ${h.bundle?.engine.getStatus().state ?? '?'}`).toContain(h.bundle?.engine.getStatus().state);
  });

  it('Unreadable nested directory: an unlistable subtree does not mark the snapshot complete or trash its children', async () => {
    h.write('top.txt', 'T');
    h.write('nested/a.txt', 'A');
    h.write('nested/b.txt', 'B');
    await h.start();
    await h.waitForConvergence();

    // The nested directory becomes unreadable while the engine re-evaluates.
    chmodSync(path.join(h.root, 'nested'), 0o000);
    try {
      await h.restart();
      await settle();
      // Its children are absent from the scan, but an unreadable directory marks the snapshot
      // incomplete, so their absence is not trusted and nothing is trashed remotely.
      expect(h.fake.trashedUids(), 'children of an unreadable directory must not be trashed').toEqual([]);
    } finally {
      chmodSync(path.join(h.root, 'nested'), 0o755);
    }
  });

  it('Proton document: a document node is blocked, a normal file syncs, and nothing is trashed', async () => {
    h.fake.seedProtonDocument(h.remoteRootUid, 'design.protondoc');
    h.fake.seedFile(h.remoteRootUid, 'real.txt', 'R');
    await h.start();
    await h.waitFor(['idle', 'attention']);
    // Give the file time to download.
    for (let i = 0; i < 50 && !h.localFiles().has('real.txt'); i++) await new Promise((r) => setTimeout(r, 30));

    // The normal file synced; the Proton document was not downloaded and neither side was trashed.
    expect(h.localFiles().get('real.txt')).toBe('R');
    expect(h.localFiles().has('design.protondoc'), 'a Proton document is not downloaded').toBe(false);
    expect(h.fake.trashedUids(), 'a Proton document must not be trashed').toEqual([]);
    const blocked = h.audit.readAll().entries.filter((e) => e.op === 'blocked' && e.message.includes('proton_document'));
    expect(blocked.length, 'the document is recorded as blocked').toBeGreaterThanOrEqual(1);
  });

  it('Pair changed: pointing setup at a different remote folder is a first sync, not a mass delete', async () => {
    h.write('keep-a.txt', 'A');
    h.write('keep-b.txt', 'B');
    await h.start();
    await h.waitForConvergence();

    // Re-point the pair at a brand-new empty remote folder (as `setup <newFolder>` would).
    const other = h.fake.seedFolder(h.fake.rootUid, 'Other');
    h.config = { ...h.config, remoteRootNodeUid: other.uid, remoteRoot: '/my-files/Other' };
    await h.restart();
    await settle();

    // A pair change is a first sync: no deletes anywhere, and no held mass-delete plan.
    expect(h.fake.trashedUids(), 'a pair change must not trash the old folder').toEqual([]);
    expect(h.recycledContents(), 'a pair change must not recycle the local tree').toEqual([]);
    expect(existsSync(path.join(h.root, 'keep-a.txt'))).toBe(true);
    expect(existsSync(path.join(h.root, 'keep-b.txt'))).toBe(true);
    const status = h.bundle?.engine.getStatus();
    expect(status?.attention.heldPlan, 'a pair change must not hold a mass-delete plan').toBeNull();
    expect(status?.state, `state was ${status?.state ?? '?'}`).not.toBe('awaiting_confirmation');
  });
});

/**
 * A replaced local root must be refused before anything changes files or state, not
 * only before the executor runs: conflict handling, a confirmed held plan and a user's
 * conflict resolution all mutate too.
 */
describe('a replaced local root is refused before any mutation', () => {
  /** Swap the root for a new directory at the same path holding `files`. */
  function replaceRoot(files: Record<string, string>): void {
    rmSync(h.root, { recursive: true, force: true });
    mkdirSync(h.root);
    for (const [relPath, content] of Object.entries(files)) h.write(relPath, content);
  }

  it('startup does not rename a conflicting file in the replaced root', async () => {
    h.write('doc.txt', 'base');
    await h.start();
    await h.waitForConvergence();
    await h.bundle?.dispose();

    replaceRoot({ 'doc.txt': 'other directory' });
    h.fake.seedRevision(h.remotePathToUid('doc.txt') ?? '', 'remote edit');
    await h.start();
    await settle();

    expect([...h.localFiles().keys()], 'the replaced root must be left untouched').toEqual(['doc.txt']);
    expect(h.bundle?.controlTarget.listConflicts(), 'no conflict may be recorded').toEqual([]);
    expect(h.bundle?.engine.getStatus().state).toBe('error');
  });

  it('confirming a held plan does not run it against a replaced root', async () => {
    for (let i = 0; i < 6; i++) h.write(`f${String(i)}.txt`, String(i));
    h.config = { ...h.config, safety: { ...h.config.safety, brakeMaxChanges: 2 } };
    await h.start();
    await h.waitForConvergence();
    for (let i = 0; i < 4; i++) rmSync(path.join(h.root, `f${String(i)}.txt`));
    const status = await h.waitFor(['awaiting_confirmation']);
    expect(status.attention.heldPlan?.affected).toHaveLength(4);

    replaceRoot({ 'f4.txt': '4', 'f5.txt': '5' });
    const result = await h.bundle?.engine.confirmHeldPlan(status.attention.heldPlan?.id ?? '');

    expect(h.fake.trashedUids(), 'held remote trashes must not run against a replaced root').toEqual([]);
    expect(result?.skipped).toMatch(/sync_root_changed/);
    expect(h.bundle?.engine.getStatus().attention.heldPlan?.id, 'the plan stays held').toBe(status.attention.heldPlan?.id);
  });

  it('resolving a conflict does not act on a replaced root', async () => {
    h.write('doc.md', 'base');
    await h.start();
    await h.waitForConvergence();
    h.bundle?.engine.pause();
    await h.waitFor(['paused']);
    h.write('doc.md', 'local');
    h.fake.seedRevision(h.remotePathToUid('doc.md') ?? '', 'remote');
    h.bundle?.engine.resume();
    await h.waitFor(['attention']);
    await h.waitForConvergence();
    const conflict = h.bundle?.controlTarget.listConflicts()[0];
    const copy = [...h.localFiles().keys()].find((p) => p !== 'doc.md') ?? '';
    const copyUid = h.remotePathToUid(copy);
    expect(copyUid).toBeDefined();

    replaceRoot({ 'doc.md': 'other', [copy]: 'other copy' });
    await expect(h.bundle?.engine.resolveConflict(conflict?.id ?? 0, 'keep_remote')).rejects.toThrow(/sync_root_changed/);

    expect(h.fake.trashedUids(), 'the remote copy must not be trashed').toEqual([]);
    expect(h.localFiles().get(copy)).toBe('other copy');
    expect(h.bundle?.controlTarget.listConflicts().map((c) => c.id), 'the conflict stays open').toEqual([conflict?.id]);
  });
});
