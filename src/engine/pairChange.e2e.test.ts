import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { readRootIdentity } from '../config/localRoot.js';
import { BaselineRepo } from '../state/baseline.js';
import { JournalRepo } from '../state/journal.js';
import { ConflictRepo } from '../state/misc.js';
import { StateStore } from '../state/store.js';
import { EngineHarness } from '../testing/engineHarness.js';
import { PAIR_KEY } from './pairState.js';

/**
 * The sync history (baseline) belongs to one pair of folders: the remote root
 * and the local root. Changing either one must start a fresh first sync, which
 * never deletes, instead of applying the old history to the new folder.
 */

const RESTING = ['idle', 'attention', 'awaiting_confirmation', 'error', 'paused', 'needs_login', 'offline'] as const;

let h: EngineHarness;
beforeEach(() => {
  h = EngineHarness.create();
});
afterEach(async () => {
  await h.dispose();
});

async function settle(): Promise<void> {
  await h.waitFor([...RESTING]);
  await h.bundle?.engine.syncNow().catch(() => undefined);
  await h.waitFor([...RESTING]);
}

const store = () => {
  const s = h.bundle?.store;
  if (s === undefined) throw new Error('engine not started');
  return s;
};

/** A second local folder, next to the harness root, holding `files`. */
function otherRoot(name: string, files: Record<string, string>): string {
  const root = path.join(h.root, '..', name);
  mkdirSync(root);
  for (const [rel, content] of Object.entries(files)) writeFileSync(path.join(root, rel), content);
  return root;
}

describe('sync pair changes', () => {
  it('changing only the local folder starts fresh instead of trashing remote files', async () => {
    h.write('old.txt', 'OLD');
    await h.start();
    await h.waitForConvergence();
    expect(h.remoteFiles().get('old.txt')).toBe('OLD');

    // Point the same remote folder at a different local folder, as setup does.
    const next = otherRoot('root2', { 'new.txt': 'NEW' });
    h.config = { ...h.config, localRoot: next, localRootIdentity: readRootIdentity(next) };
    await h.restart();
    await settle();

    expect(h.fake.trashedUids(), 'nothing may be trashed because of the old pair').toEqual([]);
    expect(h.remoteFiles().get('old.txt'), 'the old file stays on Proton').toBe('OLD');
    expect(h.remoteFiles().get('new.txt'), 'the new folder still syncs').toBe('NEW');
  });

  it('state from a version that recorded only the remote folder is not applied to a different local folder', async () => {
    h.write('old.txt', 'OLD');
    h.write('kept.txt', 'KEPT');
    await h.start();
    await h.waitForConvergence();
    // Make the stored state look like an older version's: the remote root only.
    store().db.prepare('DELETE FROM meta WHERE key = ?').run(PAIR_KEY);

    // The folder changes in the same upgrade, or before the new version first runs.
    const next = otherRoot('root4', { 'kept.txt': 'KEPT' });
    h.config = { ...h.config, localRoot: next, localRootIdentity: readRootIdentity(next) };
    await h.restart();
    await settle();

    expect(h.fake.trashedUids(), 'the old history must not trash files missing from the new folder').toEqual([]);
    expect(h.remoteFiles().get('old.txt')).toBe('OLD');
  });

  it('legacy state is not applied even when most of its files were moved into the new folder', async () => {
    h.write('a.txt', 'A');
    h.write('b.txt', 'B');
    h.write('c.txt', 'C');
    await h.start();
    await h.waitForConvergence();
    store().db.prepare('DELETE FROM meta WHERE key = ?').run(PAIR_KEY);
    await h.bundle?.dispose();

    // Two of three files move (same inodes) into a new folder; the third stays behind.
    const next = otherRoot('root5', {});
    renameSync(path.join(h.root, 'a.txt'), path.join(next, 'a.txt'));
    renameSync(path.join(h.root, 'b.txt'), path.join(next, 'b.txt'));
    h.config = { ...h.config, localRoot: next, localRootIdentity: readRootIdentity(next) };
    await h.start();
    await settle();

    expect(h.fake.trashedUids(), 'the file left behind must not be trashed remotely').toEqual([]);
    expect(h.remoteFiles().get('c.txt')).toBe('C');
  });

  it('legacy state for the same folder is rebuilt by a first sync, deleting nothing', async () => {
    h.write('a.txt', 'A');
    h.write('b.txt', 'B');
    await h.start();
    await h.waitForConvergence();
    const rows = new BaselineRepo(store()).all().length;
    store().db.prepare('DELETE FROM meta WHERE key = ?').run(PAIR_KEY);

    await h.restart();
    await h.waitForConvergence();

    expect(h.fake.trashedUids()).toEqual([]);
    expect(new BaselineRepo(store()).all().length, 'the first sync pairs the same files again').toBe(rows);
  });

  it('a dry run with a changed folder previews a first sync without touching the stored state', async () => {
    h.write('old.txt', 'OLD');
    await h.start();
    await h.waitForConvergence();
    const rows = new BaselineRepo(store()).all().length;
    const pair = store().getMeta(PAIR_KEY);
    await h.bundle?.dispose();

    const next = otherRoot('root6', { 'new.txt': 'NEW' });
    h.config = { ...h.config, dryRun: true, localRoot: next, localRootIdentity: readRootIdentity(next) };
    await h.start();
    await settle();
    expect(h.fake.trashedUids(), 'a preview trashes nothing').toEqual([]);
    await h.bundle?.dispose();

    // The real store, read directly: the baseline and the recorded pair are as before.
    const real = StateStore.open(h.paths.stateDb);
    try {
      expect(new BaselineRepo(real).all().length, 'the dry run must not reset the baseline').toBe(rows);
      expect(real.getMeta(PAIR_KEY), 'the dry run must not record the new pair').toBe(pair);
    } finally {
      real.close();
    }
  });

  it('restarting with the same pair keeps the sync history', async () => {
    h.write('a.txt', 'A');
    await h.start();
    await h.waitForConvergence();
    const rows = new BaselineRepo(store()).all().length;
    expect(rows).toBeGreaterThan(0);

    await h.restart();
    await settle();

    expect(new BaselineRepo(store()).all().length).toBe(rows);
    expect(h.fake.trashedUids()).toEqual([]);
  });

  it('a local pair change closes the old pair\'s unfinished work and open conflicts', async () => {
    h.write('a.txt', 'A');
    await h.start();
    await h.waitForConvergence();
    // Leftovers from the old pair: an unfinished journal entry and an open conflict.
    new JournalRepo(store()).plan({ op: 'upload', relPath: 'a.txt', previousRelPath: null, nodeUid: null, intended: { kind: 'upload' }, preState: {} });
    new ConflictRepo(store()).add({ relPath: 'a.txt', nodeUid: null, kind: 'content', local: {}, remote: {} });

    const next = otherRoot('root3', {});
    h.config = { ...h.config, localRoot: next, localRootIdentity: readRootIdentity(next) };
    await h.restart();
    await settle();

    expect(new JournalRepo(store()).unresolved(), 'old operations must not be recovered against the new folder').toEqual([]);
    expect(new ConflictRepo(store()).open(), 'old conflicts do not carry over').toEqual([]);
  });
});
