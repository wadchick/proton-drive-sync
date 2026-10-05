import { afterEach, describe, expect, it } from 'vitest';

import { JournalRepo } from '../state/journal.js';
import { ConflictRepo } from '../state/misc.js';
import { EngineHarness } from '../testing/engineHarness.js';

/**
 * Dry run is a preview: it must not change the user's files or the durable sync
 * state, including the paths that run before the executor (conflict handling,
 * conflict resolution, journal recovery).
 */

const RESTING = ['idle', 'attention', 'awaiting_confirmation', 'error', 'paused', 'needs_login', 'offline'] as const;

let h: EngineHarness;
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

describe('dry run changes nothing', () => {
  it('a new conflict neither renames the local file nor records conflict state', async () => {
    h = EngineHarness.create({ dryRun: true });
    h.write('same.txt', 'LOCAL');
    h.fake.seedFile(h.remoteRootUid, 'same.txt', 'REMOTE');
    await h.start();
    await settle();

    expect([...h.localFiles().entries()], 'the local file keeps its name and content').toEqual([['same.txt', 'LOCAL']]);
    expect(h.remoteFiles().get('same.txt')).toBe('REMOTE');
    expect(new ConflictRepo(store()).open(), 'no conflict is recorded').toEqual([]);
    expect(new JournalRepo(store()).unresolved()).toEqual([]);
  });

  it('resolving a conflict is refused instead of half-applying it', async () => {
    h = EngineHarness.create({ dryRun: true });
    h.write('a.txt', 'A');
    await h.start();
    await settle();
    const conflict = new ConflictRepo(store()).add({ relPath: 'a.txt', nodeUid: null, kind: 'content', local: {}, remote: {} });

    await expect(h.bundle?.engine.resolveConflict(conflict.id, 'keep_both')).rejects.toThrow(/dry run/i);
    expect(new ConflictRepo(store()).open().map((c) => c.id), 'the conflict stays open').toEqual([conflict.id]);
  });

  it('journal recovery waits for the next real run', async () => {
    h = EngineHarness.create();
    h.write('a.txt', 'A');
    await h.start();
    await h.waitForConvergence();
    // A real run left an unfinished operation behind.
    new JournalRepo(store()).plan({ op: 'upload', relPath: 'a.txt', previousRelPath: null, nodeUid: null, intended: { kind: 'upload' }, preState: {} });

    h.config = { ...h.config, dryRun: true };
    await h.restart();
    await settle();

    expect(new JournalRepo(store()).unresolved().map((e) => e.relPath), 'a preview leaves it for the next real run').toEqual(['a.txt']);
  });
});
