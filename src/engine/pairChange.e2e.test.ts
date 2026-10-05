import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { readRootIdentity } from '../config/localRoot.js';
import { BaselineRepo } from '../state/baseline.js';
import { JournalRepo } from '../state/journal.js';
import { ConflictRepo } from '../state/misc.js';
import { EngineHarness } from '../testing/engineHarness.js';

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
