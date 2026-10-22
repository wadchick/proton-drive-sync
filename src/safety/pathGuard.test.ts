import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AuditLog } from '../audit/logger.js';
import { SecretRegistry } from '../audit/redact.js';
import { atomicDownload } from '../execute/localWrite.js';
import type { Operation, Plan } from '../reconcile/types.js';
import { FakeRemote } from '../testing/fakeRemote.js';
import { assertWritableInsideRoot, blockUnsyncableTargets, pinInsideRoot, UnsafePathError } from './pathGuard.js';
import { RecycleBin } from './recycle.js';

let dir: string;
let root: string;
let outside: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'pds-guard-'));
  root = path.join(dir, 'root');
  outside = path.join(dir, 'outside');
  mkdirSync(root);
  mkdirSync(outside);
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('assertWritableInsideRoot', () => {
  it('allows real folders and folders that do not exist yet', () => {
    mkdirSync(path.join(root, 'a', 'b'), { recursive: true });
    expect(() => { assertWritableInsideRoot(root, 'a/b/file.txt'); }).not.toThrow();
    expect(() => { assertWritableInsideRoot(root, 'new/deeper/file.txt'); }).not.toThrow();
    expect(() => { assertWritableInsideRoot(root, 'top.txt'); }).not.toThrow();
  });

  it('refuses a symlinked ancestor, at any depth', () => {
    symlinkSync(outside, path.join(root, 'linked'));
    expect(() => { assertWritableInsideRoot(root, 'linked/secret.txt'); }).toThrow(UnsafePathError);
    mkdirSync(path.join(root, 'docs'));
    symlinkSync(outside, path.join(root, 'docs', 'linked'));
    expect(() => { assertWritableInsideRoot(root, 'docs/linked/deeper/x.txt'); }).toThrow(/docs\/linked is a symlink/);
  });

  it('refuses a file where a folder should be', () => {
    writeFileSync(path.join(root, 'plain'), 'x');
    expect(() => { assertWritableInsideRoot(root, 'plain/child.txt'); }).toThrow(/plain is not a directory/);
  });

  it('refuses paths that are not plainly inside the root', () => {
    for (const bad of ['', '/etc/passwd', '../escape.txt', 'a/../../escape.txt', 'a//b', './a']) {
      expect(() => { assertWritableInsideRoot(root, bad); }, bad).toThrow(UnsafePathError);
    }
  });
});

describe('blockUnsyncableTargets', () => {
  const plan = (operations: Operation[]): Plan => ({ operations, blocked: [], withheld: [], conflicts: [], requiresConfirmation: null, firstSync: false, stats: { deletes: 0, replaces: 0, transfers: 0 } });

  it('drops every local write at or under an unsyncable path and records it as blocked', () => {
    const ops = [
      { id: '1', kind: 'create_local_folder', relPath: 'linked', remoteUid: 'f' },
      { id: '2', kind: 'download', relPath: 'linked/secret.txt', remoteUid: 's' },
      { id: '3', kind: 'download', relPath: 'linkedin.txt', remoteUid: 'n' },
      { id: '4', kind: 'move_local', from: 'a.txt', to: 'linked/a.txt', remoteUid: 'm' },
      { id: '5', kind: 'upload', relPath: 'linked/x.txt', mode: 'new', remoteUid: undefined },
    ] as unknown as Operation[];
    const out = blockUnsyncableTargets(plan(ops), [{ relPath: 'linked' }]);
    // A sibling whose name only starts the same ("linkedin.txt") and remote-side work are kept.
    expect(out.operations.map((o) => o.id)).toEqual(['3', '5']);
    expect(out.blocked.map((b) => [b.reason, b.relPath])).toEqual([
      ['unsyncable_destination', 'linked'],
      ['unsyncable_destination', 'linked/secret.txt'],
      ['unsyncable_destination', 'linked/a.txt'],
    ]);
  });

  it('leaves a plan untouched when nothing is unsyncable', () => {
    const p = plan([{ id: '1', kind: 'download', relPath: 'a.txt', remoteUid: 'a' }] as unknown as Operation[]);
    expect(blockUnsyncableTargets(p, [])).toBe(p);
  });
});

describe('pinInsideRoot', () => {
  it('a rename through the pin lands in the checked folder even after it is swapped for a symlink', () => {
    mkdirSync(path.join(root, 'docs'));
    writeFileSync(path.join(root, 'staged.txt'), 'new');
    const pinned = pinInsideRoot(root, 'docs/file.txt');
    // Another local account races: the real folder is moved aside and a symlink out of the root takes its name.
    renameSync(path.join(root, 'docs'), path.join(root, 'docs.real'));
    symlinkSync(outside, path.join(root, 'docs'));
    renameSync(path.join(root, 'staged.txt'), pinned.path);
    pinned.close();
    expect(readdirSync(outside)).toEqual([]);
    expect(readdirSync(path.join(root, 'docs.real'))).toEqual(['file.txt']);
  });

  it('creates missing folders and refuses a symlinked or non-directory ancestor', () => {
    const pinned = pinInsideRoot(root, 'new/deeper/file.txt');
    pinned.close();
    expect(lstatSync(path.join(root, 'new', 'deeper')).isDirectory()).toBe(true);
    symlinkSync(outside, path.join(root, 'linked'));
    writeFileSync(path.join(root, 'plain'), 'x');
    expect(() => pinInsideRoot(root, 'linked/secret.txt')).toThrow(/linked is a symlink/);
    expect(() => pinInsideRoot(root, 'plain/child.txt')).toThrow(/plain is not a directory/);
  });
});

describe('writes re-check right before they happen', () => {
  it('a download refuses when a symlink appeared after planning, and writes nothing outside', async () => {
    const fake = new FakeRemote();
    const folder = fake.seedFolder(fake.rootUid, 'linked');
    const node = fake.seedFile(folder.uid, 'secret.txt', 'REMOTE');
    symlinkSync(outside, path.join(root, 'linked'));
    const recycle = new RecycleBin(root, 30, new AuditLog({ dir: path.join(dir, 'audit'), registry: new SecretRegistry() }));

    await expect(atomicDownload(root, fake, node, 'linked/secret.txt', undefined, recycle)).rejects.toThrow(UnsafePathError);
    expect(readdirSync(outside)).toEqual([]);
    // Its temp file is cleaned up too.
    expect(existsSync(path.join(root, '.proton-sync', 'tmp')) ? readdirSync(path.join(root, '.proton-sync', 'tmp')) : []).toEqual([]);
  });

  it('the recycle bin refuses to move an item through a symlinked folder', () => {
    writeFileSync(path.join(outside, 'victim.txt'), 'mine');
    symlinkSync(outside, path.join(root, 'linked'));
    const recycle = new RecycleBin(root, 30, new AuditLog({ dir: path.join(dir, 'audit'), registry: new SecretRegistry() }));
    expect(() => recycle.recycle('linked/victim.txt', 'test')).toThrow(UnsafePathError);
    expect(readdirSync(outside)).toEqual(['victim.txt']);
  });
});
