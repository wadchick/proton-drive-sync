/**
 * In-memory mirror of the remote tree under the sync root, kept current by
 * the event feed and refreshed by full listings (startup, expiry, interval).
 */
import type { RemoteChange } from '../execute/types.js';
import type { NodeRemoteEvent } from '../remote/events.js';
import type { RemoteDrive, RemoteNode } from '../remote/interface.js';
import type { RemoteView } from '../reconcile/types.js';
import { remoteViewFromNodes } from './views.js';

interface StampedNode { node: RemoteNode; stamp: number }

export class RemoteMirror {
  private nodes = new Map<string, RemoteNode>();
  private readonly nodeStamps = new Map<string, number>();
  private readonly tombstones = new Map<string, number>();
  private readonly readsInFlight = new Set<number>();
  private nextObservation = 0;
  private complete = false;
  private available = true;
  lastFullListingAt: number | null = null;
  /** The mirror reflects the server at least as of this time (start of the last listing or completed poll). */
  private asOf: number | undefined;
  private activeRefresh: Promise<void> | null = null;
  private queuedRefresh: {
    promise: Promise<void>;
    resolve: () => void;
    reject: (error: unknown) => void;
    signal: AbortSignal | undefined;
  } | null = null;

  constructor(
    private readonly remote: RemoteDrive,
    private readonly rootUid: string,
    private readonly now: () => number = Date.now,
  ) {}

  get isComplete(): boolean {
    return this.complete;
  }

  get size(): number {
    return this.nodes.size;
  }

  /** A read stays registered until its result has been published or discarded. */
  beginRead(): number {
    const stamp = ++this.nextObservation;
    this.readsInFlight.add(stamp);
    return stamp;
  }

  endRead(stamp: number): void {
    this.readsInFlight.delete(stamp);
    this.pruneTombstones();
  }

  private stamp(): number {
    return ++this.nextObservation;
  }

  private pruneTombstones(): void {
    let oldest = Infinity;
    for (const stamp of this.readsInFlight) oldest = Math.min(oldest, stamp);
    for (const [uid, stamp] of this.tombstones) {
      if (stamp <= oldest) this.tombstones.delete(uid);
    }
  }

  get tombstoneCount(): number {
    return this.tombstones.size;
  }

  /** Concurrent requests queue one follow-up, so no two listings overlap. */
  fullRefresh(signal?: AbortSignal): Promise<void> {
    if (this.activeRefresh !== null) {
      if (this.queuedRefresh === null) {
        let resolve!: () => void;
        let reject!: (error: unknown) => void;
        const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
        this.queuedRefresh = { promise, resolve, reject, signal };
      }
      return this.queuedRefresh.promise;
    }
    return this.startRefresh(signal);
  }

  private startRefresh(signal?: AbortSignal): Promise<void> {
    const refresh = this.performRefresh(signal);
    this.activeRefresh = refresh;
    void refresh.then(() => { this.afterRefresh(refresh); }, () => { this.afterRefresh(refresh); });
    return refresh;
  }

  private afterRefresh(refresh: Promise<void>): void {
    if (this.activeRefresh !== refresh) return;
    this.activeRefresh = null;
    const queued = this.queuedRefresh;
    if (queued === null) return;
    this.queuedRefresh = null;
    void this.startRefresh(queued.signal).then(queued.resolve, queued.reject);
  }

  private async performRefresh(signal?: AbortSignal): Promise<void> {
    const startedAt = this.now();
    const startStamp = this.beginRead();
    try {
      const root = await this.remote.getNode(this.rootUid);
      if (root === null) throw new Error(`remote root ${this.rootUid} not found`);
      const observed: StampedNode[] = [{ node: root, stamp: startStamp }];
      const queue: RemoteNode[] = [root];
      while (queue.length > 0) {
        const dir = queue.shift();
        if (dir === undefined) break;
        const folderStamp = this.stamp();
        for (const child of await this.remote.listChildren(dir.uid, signal)) {
          observed.push({ node: child, stamp: folderStamp });
          if (child.type === 'folder' && !child.isTrashed && child.nameStatus === 'ok') queue.push(child);
        }
      }
      const seen = new Set(observed.map(({ node }) => node.uid));
      for (const { node, stamp } of observed) this.applyNode(node, stamp);
      for (const [uid, stamp] of [...this.nodeStamps]) {
        if (!seen.has(uid) && stamp < startStamp) this.applyRemoval(uid, startStamp);
      }
      this.complete = true;
      this.available = true;
      this.lastFullListingAt = this.now();
      this.markPolled(startedAt);
    } catch (error) {
      this.complete = false;
      this.available = false;
      throw error;
    } finally {
      this.endRead(startStamp);
    }
  }

  /** Apply one node event by re-reading the node (events carry no metadata). */
  async applyEvent(event: NodeRemoteEvent): Promise<void> {
    const stamp = this.beginRead();
    try {
      if (event.type === 'node_deleted') this.applyRemoval(event.nodeUid, stamp);
      else {
        const node = await this.remote.getNode(event.nodeUid);
        if (node === null) this.applyRemoval(event.nodeUid, stamp);
        else this.applyNode(node, stamp);
        this.available = true;
      }
    } finally {
      this.endRead(stamp);
    }
  }

  /**
   * A change the engine itself made on Proton (the executor reports it once verified): reflect it
   * at once instead of waiting for its event. Under load the event arrives after the next cycle
   * has planned, and a plan from the older tree undoes the change or records a conflict with it.
   * The event, when it comes, re-reads the node and agrees.
   */
  applyOwnChange(change: RemoteChange, stamp = this.stamp()): void {
    if (change.type === 'remove') this.applyRemoval(change.uid, stamp);
    else this.applyNode(change.node, stamp);
  }

  private applyNode(node: RemoteNode, stamp: number): void {
    const parentRemoval = node.parentUid === undefined ? undefined : this.tombstones.get(node.parentUid);
    if (parentRemoval !== undefined && stamp <= parentRemoval) {
      // A complete listing may contain a child that was not previously known when its parent
      // was removed. Carry the parent's tombstone through that child as well.
      this.tombstones.set(node.uid, Math.max(this.tombstones.get(node.uid) ?? 0, parentRemoval));
      return;
    }
    if (stamp < (this.nodeStamps.get(node.uid) ?? 0) || stamp <= (this.tombstones.get(node.uid) ?? 0)) return;
    this.nodes.set(node.uid, node);
    this.nodeStamps.set(node.uid, stamp);
    this.tombstones.delete(node.uid);
  }

  /**
   * Forget a node and everything under it (a trashed folder stays as an upsert, marked trashed).
   */
  private applyRemoval(uid: string, stamp: number): void {
    if (stamp < (this.nodeStamps.get(uid) ?? 0) || stamp < (this.tombstones.get(uid) ?? 0)) return;
    const gone = new Set([uid]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const node of this.nodes.values()) {
        if (!gone.has(node.uid) && node.parentUid !== undefined && gone.has(node.parentUid)) {
          gone.add(node.uid);
          grew = true;
        }
      }
    }
    for (const g of gone) {
      if (stamp < (this.nodeStamps.get(g) ?? 0) || stamp < (this.tombstones.get(g) ?? 0)) continue;
      this.nodes.delete(g);
      this.nodeStamps.delete(g);
      this.tombstones.set(g, stamp);
    }
    this.pruneTombstones();
  }

  /**
   * When a known, non-trashed item last changed (ms): the content's own time when the
   * saving app recorded one, else Proton's. Null when the item is unknown or trashed.
   */
  modifiedAt(uid: string): number | null {
    const node = this.nodes.get(uid);
    if (node === undefined || node.isTrashed) return null;
    return (node.claimedModifiedAt ?? node.serverModifiedAt).getTime();
  }

  /** A poll of the event stream that started at `startedAt` completed successfully. */
  markPolled(startedAt: number): void {
    if (this.asOf === undefined || startedAt > this.asOf) this.asOf = startedAt;
  }

  markUnavailable(): void {
    this.available = false;
  }

  markAvailable(): void {
    this.available = true;
  }

  view(): RemoteView {
    return remoteViewFromNodes([...this.nodes.values()], this.rootUid, this.complete, this.available, this.asOf);
  }

  files(): number {
    return this.library().files;
  }

  /**
   * Non-trashed files, Proton document paths, and the other file paths.
   * A file under a trashed ancestor has no path and is still counted in `files`.
   */
  library(): { files: number; protonDocumentPaths: string[]; protonDocumentModifiedAt: Record<string, number>; syncableFilePaths: string[] } {
    const protonDocumentPaths: string[] = [];
    // No prototype: a document named like an Object member (e.g. "__proto__") stays an own entry.
    const protonDocumentModifiedAt = Object.create(null) as Record<string, number>;
    const syncableFilePaths: string[] = [];
    let files = 0;
    for (const node of this.nodes.values()) {
      if (node.type !== 'file' || node.isTrashed) continue;
      files++;
      const rel = this.relPath(node);
      if (rel === null) continue;
      if (node.isProtonDocument) {
        protonDocumentPaths.push(rel);
        // The content's own time when the saving app recorded one, else Proton's.
        protonDocumentModifiedAt[rel] = (node.claimedModifiedAt ?? node.serverModifiedAt).getTime();
      } else syncableFilePaths.push(rel);
    }
    protonDocumentPaths.sort();
    syncableFilePaths.sort();
    return { files, protonDocumentPaths, protonDocumentModifiedAt, syncableFilePaths };
  }

  /** Root-relative path, or null when an ancestor is trashed or the chain is broken. */
  private relPath(node: RemoteNode): string | null {
    const parts: string[] = [];
    let current: RemoteNode | undefined = node;
    const seen = new Set<string>();
    while (current !== undefined && current.uid !== this.rootUid) {
      if (seen.has(current.uid)) return null;
      seen.add(current.uid);
      if (current !== node && current.isTrashed) return null;
      parts.push(current.name);
      if (current.parentUid === undefined) return null;
      current = this.nodes.get(current.parentUid);
    }
    if (current === undefined) return null;
    return parts.reverse().join('/');
  }
}
