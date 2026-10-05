import { existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { EngineHarness } from '../testing/engineHarness.js';

/**
 * Ignore rules define what is synced, on both sides: an ignored remote item is
 * never downloaded, and the internal `.proton-sync` folder is never populated
 * from remote content, whatever the configured rules.
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

describe('ignore rules apply to remote items', () => {
  it('ignored remote files and folders are not downloaded', async () => {
    h.config = { ...h.config, ignore: [...h.config.ignore, 'ignored/**', '**/*.tmp'] };
    const folder = h.fake.seedFolder(h.remoteRootUid, 'ignored');
    h.fake.seedFile(folder.uid, 'secret.txt', 'S');
    h.fake.seedFile(h.remoteRootUid, 'example.tmp', 'T');
    h.fake.seedFile(h.remoteRootUid, 'keep.txt', 'K');
    await h.start();
    await settle();

    expect([...h.localFiles().keys()]).toEqual(['keep.txt']);
    expect(existsSync(path.join(h.root, 'ignored')), 'no folder is created for an ignored remote folder').toBe(false);
    expect(h.fake.trashedUids()).toEqual([]);
  });

  it('a remote item in the internal folder is never brought in, even with no ignore rules', async () => {
    h.config = { ...h.config, ignore: [] };
    const internal = h.fake.seedFolder(h.remoteRootUid, '.proton-sync');
    const tmp = h.fake.seedFolder(internal.uid, 'tmp');
    h.fake.seedFile(tmp.uid, 'download-planted', 'X');
    h.fake.seedFile(h.remoteRootUid, 'keep.txt', 'K');
    await h.start();
    await settle();

    expect(h.localFiles().get('keep.txt')).toBe('K');
    expect(existsSync(path.join(h.root, '.proton-sync', 'tmp', 'download-planted'))).toBe(false);
  });

  it('a file deleted locally is not trashed after its folder was renamed remotely to an ignored name', async () => {
    h.config = { ...h.config, ignore: [...h.config.ignore, 'ignored/**'] };
    h.write('dir/a.txt', 'A');
    h.write('dir/b.txt', 'B');
    await h.start();
    await h.waitForConvergence();
    await h.bundle?.dispose();
    rmSync(path.join(h.root, 'dir', 'a.txt'));
    await h.fake.rename(h.remotePathToUid('dir') ?? '', 'ignored');
    await h.start();
    await settle();

    expect(h.fake.trashedUids(), 'nothing under the ignored folder may be trashed').toEqual([]);
    expect(h.localFiles().get('dir/b.txt')).toBe('B');
  });

  it('a file trashed remotely inside a folder renamed to an ignored name is not recycled locally', async () => {
    h.config = { ...h.config, ignore: [...h.config.ignore, 'ignored/**'] };
    h.write('dir/a.txt', 'A');
    h.write('dir/b.txt', 'B');
    await h.start();
    await h.waitForConvergence();
    await h.bundle?.dispose();
    await h.fake.rename(h.remotePathToUid('dir') ?? '', 'ignored');
    await h.fake.trash([h.remotePathToUid('ignored/a.txt') ?? '']);
    await h.start();
    await settle();

    expect(h.localFiles().get('dir/a.txt'), 'the local file must not be recycled').toBe('A');
    expect(h.recycledContents()).toEqual([]);
  });

  it('a file moved remotely out of a folder renamed to an ignored name is moved locally too', async () => {
    h.config = { ...h.config, ignore: [...h.config.ignore, 'ignored/**'] };
    h.write('dir/a.txt', 'A');
    h.write('dir/b.txt', 'B');
    await h.start();
    await h.waitForConvergence();
    await h.bundle?.dispose();
    await h.fake.rename(h.remotePathToUid('dir') ?? '', 'ignored');
    await h.fake.move(h.remotePathToUid('ignored/a.txt') ?? '', h.remoteRootUid);
    await h.start();
    await settle();

    expect(h.localFiles().get('a.txt'), 'the valid move to the root is followed').toBe('A');
    expect(h.localFiles().has('dir/a.txt')).toBe(false);
    expect(h.fake.trashedUids()).toEqual([]);
  });

  for (const destination of ['ignored', '.proton-sync']) {
    it(`a folder deleted locally after it was renamed remotely to ${destination} is neither trashed nor a conflict`, async () => {
      h.config = { ...h.config, ignore: [...h.config.ignore, 'ignored/**'] };
      h.write('dir/a.txt', 'A');
      await h.start();
      await h.waitForConvergence();
      await h.bundle?.dispose();
      rmSync(path.join(h.root, 'dir'), { recursive: true });
      await h.fake.rename(h.remotePathToUid('dir') ?? '', destination);
      await h.start();
      await settle();

      expect(h.fake.trashedUids()).toEqual([]);
      expect(h.bundle?.controlTarget.listConflicts()).toEqual([]);
    });
  }

  it('a synced file moved remotely into an ignored folder stays where it is locally', async () => {
    h.config = { ...h.config, ignore: [...h.config.ignore, 'ignored/**'] };
    h.write('a.txt', 'A');
    await h.start();
    await h.waitForConvergence();
    const folder = h.fake.seedFolder(h.remoteRootUid, 'ignored');
    await h.fake.move(h.remotePathToUid('a.txt') ?? '', folder.uid);
    // A fresh remote listing, so the move is really seen.
    await h.restart();
    await settle();

    expect(h.localFiles().get('a.txt'), 'the local file is not moved into the ignored folder').toBe('A');
    expect(existsSync(path.join(h.root, 'ignored'))).toBe(false);
    expect(h.fake.trashedUids()).toEqual([]);
  });
});
