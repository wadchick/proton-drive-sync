import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { FakeRemote } from '../testing/fakeRemote.js';
import { RemoteMirror } from './remoteMirror.js';
import { listRemoteTree } from './views.js';

/**
 * A failed remote refresh must never look complete (spec: test-suite / Absence
 * is not a delete — an incomplete or failed listing withholds deletes). The
 * mirror only adopts a listing that finished; a throw leaves it incomplete and
 * keeps no half listing.
 */

function seedTree(): { fake: FakeRemote; root: string } {
  const fake = new FakeRemote();
  const root = fake.seedFolder(fake.rootUid, 'Sync').uid;
  fake.seedFile(root, 'a.txt', 'A');
  const sub = fake.seedFolder(root, 'sub').uid;
  fake.seedFile(sub, 'b.txt', 'B');
  return { fake, root };
}

describe('RemoteMirror and changes the engine made itself', () => {
  it('reflects an own change at once, and a node that is gone takes its descendants with it', async () => {
    const { fake, root } = seedTree();
    const mirror = new RemoteMirror(fake, root, () => 1000);
    await mirror.fullRefresh();
    const a = [...mirror.view().items.values()].find((i) => i.name === 'a.txt');
    if (a === undefined) throw new Error('a.txt not listed');
    mirror.applyOwnChange({ type: 'upsert', node: await fake.rename(a.uid, 'renamed.txt') });
    expect(mirror.view().items.get(a.uid)?.name).toBe('renamed.txt');
    const sub = [...mirror.view().items.values()].find((i) => i.name === 'sub');
    if (sub === undefined) throw new Error('sub not listed');
    mirror.applyOwnChange({ type: 'remove', uid: sub.uid });
    // The sync root itself is in the view too.
    expect([...mirror.view().items.values()].map((i) => i.name).sort()).toEqual(['Sync', 'renamed.txt']);
  });

  it('an event that read a node before an own change does not overwrite that change', async () => {
    const { fake, root } = seedTree();
    const mirror = new RemoteMirror(fake, root, () => 1000);
    await mirror.fullRefresh();
    const a = [...mirror.view().items.values()].find((i) => i.name === 'a.txt');
    if (a === undefined) throw new Error('a.txt not listed');
    // The event's re-read gets the node (still a.txt), then is slow to come back.
    const get = fake.getNode.bind(fake);
    let read!: () => void;
    let resume!: () => void;
    const atRead = new Promise<void>((r) => { read = r; });
    const resumed = new Promise<void>((r) => { resume = r; });
    fake.getNode = async (uid: string) => {
      const node = await get(uid);
      fake.getNode = get;
      read();
      await resumed;
      return node;
    };
    const applying = mirror.applyEvent({ type: 'node_updated', nodeUid: a.uid, parentUid: root, isTrashed: false, eventId: '9', scopeId: 'scope-1' });
    await atRead;
    mirror.applyOwnChange({ type: 'upsert', node: await fake.rename(a.uid, 'renamed.txt') });
    resume();
    await applying;
    expect(mirror.view().items.get(a.uid)?.name).toBe('renamed.txt');
  });

  it('an event that read a node does not bring it back after an own removal of its folder', async () => {
    const { fake, root } = seedTree();
    const mirror = new RemoteMirror(fake, root, () => 1000);
    await mirror.fullRefresh();
    const sub = [...mirror.view().items.values()].find((i) => i.name === 'sub');
    const b = [...mirror.view().items.values()].find((i) => i.name === 'b.txt');
    if (sub === undefined || b === undefined) throw new Error('sub/b.txt not listed');
    // The child's event re-read gets the node, then is slow to come back.
    const get = fake.getNode.bind(fake);
    let read!: () => void;
    let resume!: () => void;
    const atRead = new Promise<void>((r) => { read = r; });
    const resumed = new Promise<void>((r) => { resume = r; });
    fake.getNode = async (uid: string) => {
      const node = await get(uid);
      fake.getNode = get;
      read();
      await resumed;
      return node;
    };
    const applying = mirror.applyEvent({ type: 'node_updated', nodeUid: b.uid, parentUid: sub.uid, isTrashed: false, eventId: '9', scopeId: 'scope-1' });
    await atRead;
    // The engine removes the folder, and with it the child.
    mirror.applyOwnChange({ type: 'remove', uid: sub.uid });
    resume();
    await applying;
    expect(mirror.view().items.has(b.uid)).toBe(false);
  });

  it('keeps an own change made while a full listing was under way', async () => {
    const { fake, root } = seedTree();
    const mirror = new RemoteMirror(fake, root, () => 1000);
    await mirror.fullRefresh();
    const a = [...mirror.view().items.values()].find((i) => i.name === 'a.txt');
    if (a === undefined) throw new Error('a.txt not listed');
    // The listing reads the root's children (a.txt still under its old name), then waits.
    const list = fake.listChildren.bind(fake);
    let listed!: () => void;
    let resume!: () => void;
    const atPause = new Promise<void>((r) => { listed = r; });
    fake.listChildren = async (parentUid: string) => {
      const children = await list(parentUid);
      if (parentUid === root) {
        listed();
        await new Promise<void>((r) => { resume = r; });
      }
      return children;
    };
    const refreshing = mirror.fullRefresh();
    await atPause;
    mirror.applyOwnChange({ type: 'upsert', node: await fake.rename(a.uid, 'renamed.txt') });
    resume();
    await refreshing;
    // The listing's older result does not undo the rename the engine made meanwhile.
    expect(mirror.view().items.get(a.uid)?.name).toBe('renamed.txt');
  });
});

describe('RemoteMirror observation ordering', () => {
  it('keeps an event newer than an in-flight listing, even after an own rename', async () => {
    const { fake, root } = seedTree();
    const mirror = new RemoteMirror(fake, root);
    await mirror.fullRefresh();
    const uid = [...mirror.view().items.values()].find((item) => item.name === 'a.txt')?.uid;
    if (uid === undefined) throw new Error('missing a.txt');
    const list = fake.listChildren.bind(fake);
    let listed!: () => void;
    let resume!: () => void;
    const paused = new Promise<void>((resolve) => { listed = resolve; });
    const release = new Promise<void>((resolve) => { resume = resolve; });
    fake.listChildren = async (parentUid: string) => {
      const children = await list(parentUid);
      if (parentUid === root) { listed(); await release; }
      return children;
    };
    const refreshing = mirror.fullRefresh();
    await paused;
    mirror.applyOwnChange({ type: 'upsert', node: await fake.rename(uid, 'b.txt') });
    await fake.rename(uid, 'c.txt');
    await mirror.applyEvent({ type: 'node_updated', nodeUid: uid, parentUid: root, isTrashed: false, eventId: '10', scopeId: 'scope-1' });
    resume();
    await refreshing;
    expect(mirror.view().items.get(uid)?.name).toBe('c.txt');
  });

  it('rejects an event read and a verified own read older than a completed listing or event', async () => {
    const { fake, root } = seedTree();
    const mirror = new RemoteMirror(fake, root);
    await mirror.fullRefresh();
    const uid = [...mirror.view().items.values()].find((item) => item.name === 'a.txt')?.uid;
    if (uid === undefined) throw new Error('missing a.txt');
    const get = fake.getNode.bind(fake);
    let read!: () => void;
    let resume!: () => void;
    const paused = new Promise<void>((resolve) => { read = resolve; });
    const release = new Promise<void>((resolve) => { resume = resolve; });
    fake.getNode = async (nodeUid: string) => {
      const node = await get(nodeUid);
      if (nodeUid === uid) { fake.getNode = get; read(); await release; }
      return node;
    };
    const event = mirror.applyEvent({ type: 'node_updated', nodeUid: uid, parentUid: root, isTrashed: false, eventId: '10', scopeId: 'scope-1' });
    await paused;
    const ownStamp = mirror.beginRead();
    const oldOwn = await get(uid);
    await fake.rename(uid, 'new.txt');
    await mirror.fullRefresh();
    resume();
    await event;
    if (oldOwn === null) throw new Error('missing own read');
    mirror.applyOwnChange({ type: 'upsert', node: oldOwn }, ownStamp);
    mirror.endRead(ownStamp);
    expect(mirror.view().items.get(uid)?.name).toBe('new.txt');
  });

  it('keeps a new node omitted by an older listing and releases removal tombstones', async () => {
    const { fake, root } = seedTree();
    const mirror = new RemoteMirror(fake, root);
    await mirror.fullRefresh();
    const list = fake.listChildren.bind(fake);
    let listed!: () => void;
    let resume!: () => void;
    const paused = new Promise<void>((resolve) => { listed = resolve; });
    const release = new Promise<void>((resolve) => { resume = resolve; });
    fake.listChildren = async (parentUid: string) => {
      const children = await list(parentUid);
      if (parentUid === root) { listed(); await release; }
      return children;
    };
    const refreshing = mirror.fullRefresh();
    await paused;
    const fresh = fake.seedFile(root, 'fresh.txt', 'F');
    mirror.applyOwnChange({ type: 'upsert', node: fresh });
    const aUid = [...mirror.view().items.values()].find((item) => item.name === 'a.txt')?.uid;
    if (aUid === undefined) throw new Error('missing a.txt');
    await mirror.applyEvent({ type: 'node_deleted', nodeUid: aUid, parentUid: root, eventId: '11', scopeId: 'scope-1' });
    expect(mirror.tombstoneCount).toBeGreaterThan(0);
    resume();
    await refreshing;
    expect(mirror.view().items.has(fresh.uid)).toBe(true);
    expect(mirror.view().items.has(aUid)).toBe(false);
    expect(mirror.tombstoneCount).toBe(0);
  });

  it('does not restore a newly discovered child after its folder was removed', async () => {
    const { fake, root } = seedTree();
    const mirror = new RemoteMirror(fake, root);
    await mirror.fullRefresh();
    const subUid = [...mirror.view().items.values()].find((item) => item.name === 'sub')?.uid;
    if (subUid === undefined) throw new Error('missing sub');
    const fresh = fake.seedFile(subUid, 'new.txt', 'N');
    const list = fake.listChildren.bind(fake);
    let listed!: () => void;
    let resume!: () => void;
    const paused = new Promise<void>((resolve) => { listed = resolve; });
    const release = new Promise<void>((resolve) => { resume = resolve; });
    fake.listChildren = async (parentUid: string) => {
      const children = await list(parentUid);
      if (parentUid === subUid) { listed(); await release; }
      return children;
    };
    const refreshing = mirror.fullRefresh();
    await paused;
    await mirror.applyEvent({ type: 'node_deleted', nodeUid: subUid, parentUid: root, eventId: '12', scopeId: 'scope-1' });
    resume();
    await refreshing;
    expect(mirror.view().items.has(subUid)).toBe(false);
    expect(mirror.view().items.has(fresh.uid)).toBe(false);
    expect(mirror.tombstoneCount).toBe(0);
  });

  it('coalesces refresh requests into one follow-up and never moves asOf backwards', async () => {
    const { fake, root } = seedTree();
    let now = 100;
    const mirror = new RemoteMirror(fake, root, () => now);
    const list = fake.listChildren.bind(fake);
    let listed!: () => void;
    let resume!: () => void;
    const paused = new Promise<void>((resolve) => { listed = resolve; });
    const release = new Promise<void>((resolve) => { resume = resolve; });
    let active = 0;
    let maximum = 0;
    let rootCalls = 0;
    fake.listChildren = async (parentUid: string) => {
      if (parentUid === root) { active++; maximum = Math.max(maximum, active); rootCalls++; }
      const children = await list(parentUid);
      if (parentUid === root && rootCalls === 1) { listed(); await release; }
      if (parentUid === root) active--;
      return children;
    };
    const first = mirror.fullRefresh();
    await paused;
    const second = mirror.fullRefresh();
    const third = mirror.fullRefresh();
    expect(third).toBe(second);
    now = 200;
    mirror.markPolled(now);
    resume();
    await Promise.all([first, second, third]);
    expect(rootCalls).toBe(2);
    expect(maximum).toBe(1);
    expect(mirror.view().asOf).toBe(200);
  });

  it('runs a queued refresh after the active listing fails', async () => {
    const { fake, root } = seedTree();
    const mirror = new RemoteMirror(fake, root);
    const list = fake.listChildren.bind(fake);
    let listed!: () => void;
    let resume!: () => void;
    const paused = new Promise<void>((resolve) => { listed = resolve; });
    const release = new Promise<void>((resolve) => { resume = resolve; });
    let rootCalls = 0;
    fake.listChildren = async (parentUid: string) => {
      if (parentUid === root && ++rootCalls === 1) { listed(); await release; throw new Error('listing failed'); }
      return list(parentUid);
    };
    const first = mirror.fullRefresh();
    await paused;
    const followUp = mirror.fullRefresh();
    resume();
    await expect(first).rejects.toThrow('listing failed');
    await followUp;
    expect(rootCalls).toBe(2);
    expect(mirror.isComplete).toBe(true);
    expect(mirror.view().available).toBe(true);
  });

  it('queues a new follow-up when a request arrives during the previous follow-up', async () => {
    const { fake, root } = seedTree();
    const mirror = new RemoteMirror(fake, root);
    const list = fake.listChildren.bind(fake);
    const started: (() => void)[] = [];
    const released: (() => void)[] = [];
    const atStart = [0, 1].map(() => new Promise<void>((resolve) => { started.push(resolve); }));
    const release = [0, 1].map(() => new Promise<void>((resolve) => { released.push(resolve); }));
    let rootCalls = 0;
    fake.listChildren = async (parentUid: string) => {
      if (parentUid === root) {
        const call = rootCalls++;
        if (call < 2) { started[call]?.(); await release[call]; }
      }
      return list(parentUid);
    };
    const first = mirror.fullRefresh();
    await atStart[0];
    const second = mirror.fullRefresh();
    released[0]?.();
    await atStart[1];
    const third = mirror.fullRefresh();
    expect(third).not.toBe(second);
    released[1]?.();
    await Promise.all([first, second, third]);
    expect(rootCalls).toBe(3);
  });

  it('orders arbitrary overlapping updates and removals by read start', () => {
    fc.assert(fc.property(
      fc.array(fc.record({ present: fc.boolean(), name: fc.string({ minLength: 1, maxLength: 8 }), finishOrder: fc.integer() }), { minLength: 1, maxLength: 25 }),
      (observations) => {
        const { fake, root } = seedTree();
        const mirror = new RemoteMirror(fake, root);
        const node = fake.seedFile(root, 'target.txt', 'T');
        const stamped = observations.map((observation, index) => ({ ...observation, index, stamp: mirror.beginRead() }));
        for (const observation of [...stamped].sort((a, b) => a.finishOrder - b.finishOrder || a.index - b.index)) {
          mirror.applyOwnChange(observation.present ? { type: 'upsert', node: { ...node, name: observation.name } } : { type: 'remove', uid: node.uid }, observation.stamp);
          mirror.endRead(observation.stamp);
        }
        const latest = observations.at(-1);
        expect(mirror.view().items.get(node.uid)?.name).toBe(latest?.present ? latest.name : undefined);
        expect(mirror.tombstoneCount).toBe(0);
      },
    ), { numRuns: 100 });
  });
});

describe('RemoteMirror modifiedAt', () => {
  it('reports when a known item last changed, and nothing for an unknown one', async () => {
    const { fake, root } = seedTree();
    const dated = fake.seedFile(root, 'dated.txt', 'D', { modifiedAt: new Date(1_700_000_000_000) });
    const mirror = new RemoteMirror(fake, root, () => 1000);
    await mirror.fullRefresh();
    expect(mirror.modifiedAt(dated.uid)).toBe((dated.claimedModifiedAt ?? dated.serverModifiedAt).getTime());
    expect(mirror.modifiedAt(dated.uid)).toBeGreaterThan(0);
    expect(mirror.modifiedAt('no-such-uid')).toBeNull();
  });

  it('keeps a Proton document named like an Object member as its own entry', async () => {
    const { fake, root } = seedTree();
    fake.seedProtonDocument(root, '__proto__');
    const mirror = new RemoteMirror(fake, root, () => 1000);
    await mirror.fullRefresh();
    const times = mirror.library().protonDocumentModifiedAt;
    expect(Object.keys(times)).toEqual(['__proto__']);
    // It survives the trip to the page as a number.
    expect(typeof (JSON.parse(JSON.stringify(times)) as Record<string, unknown>)['__proto__']).toBe('number');
  });
});

describe('RemoteMirror completeness', () => {
  it('a fresh mirror is incomplete until a full refresh succeeds', () => {
    const { fake, root } = seedTree();
    const mirror = new RemoteMirror(fake, root, () => 1000);
    expect(mirror.isComplete).toBe(false);
    expect(mirror.view().complete).toBe(false);
  });

  it('a failed full refresh throws, stays incomplete, and keeps no half listing', async () => {
    const { fake, root } = seedTree();
    const mirror = new RemoteMirror(fake, root, () => 1000);

    await mirror.fullRefresh();
    expect(mirror.isComplete).toBe(true);
    const completeSize = mirror.size;
    expect(completeSize).toBeGreaterThan(0);

    // The next listing fails partway (the root list rejects).
    fake.injectFault('list', { kind: 'connection' });
    await expect(mirror.fullRefresh()).rejects.toThrow();

    // The mirror is now marked incomplete and unavailable — a failed refresh cannot look complete.
    expect(mirror.isComplete).toBe(false);
    expect(mirror.view().complete).toBe(false);
    expect(mirror.view().available).toBe(false);
    // It did not adopt a partial listing: the node set was not replaced by a half result.
    expect(mirror.size).toBe(completeSize);
  });

  it('listRemoteTree throws instead of returning a partial tree', async () => {
    const { fake, root } = seedTree();
    fake.injectFault('list', { kind: 'connection' });
    await expect(listRemoteTree(fake, root)).rejects.toThrow();
  });
});
