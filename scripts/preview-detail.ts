/**
 * Preview the details page with made-up data, one local server per scenario, so
 * every state (a held plan, each kind of conflict, paging, offline, ...) can be
 * seen and clicked through without a running engine or touching any files.
 *
 *   npx vite-node scripts/preview-detail.ts            # every scenario
 *   npx vite-node scripts/preview-detail.ts held paging   # just these
 *
 * The page, its script and the server are the real ones (DetailPageServer and the
 * active Omarchy theme); only the engine behind them is fake. The buttons act on
 * the fake data: Proceed/Reject clear a held plan, resolving removes a conflict,
 * the switch pauses and resumes. Ctrl+C stops the previews.
 *
 * Scenarios, ports and troubleshooting: scripts/preview-detail.md.
 */
import type { Resolution } from '../src/conflict/handler.js';
import type { ControlTarget } from '../src/engine/control.js';
import { initialStatus, summarize, type EngineStatus } from '../src/engine/status.js';
import type { RecycledItem } from '../src/safety/recycle.js';
import type { ConflictEntry, QuarantineEntry } from '../src/state/misc.js';
import { DetailPageServer } from '../src/tray/detailPage.js';

const BASE_PORT = 47800;
const NOW = Date.now();
const MIN = 60_000;
const ROOTS = { local: '/home/you/Drive', remote: '/my-files/Drive' };

interface Scenario {
  title: string;
  status?: Partial<EngineStatus>;
  conflicts?: ConflictEntry[];
  quarantine?: QuarantineEntry[];
  recycle?: RecycledItem[];
  /** Stop the server this many ms after the page first loads, to show the lost-connection notice. */
  stopAfterMs?: number;
}

const counts = (files: number, folders = 6, extra: Partial<EngineStatus['counts']> = {}): EngineStatus['counts'] => ({
  baseline: files + folders,
  localFiles: files,
  remoteFiles: files + (extra.protonDocuments ?? 0),
  pairedFiles: files,
  pairedFolders: folders,
  protonDocuments: 0,
  onlyLocal: 0,
  onlyRemote: 0,
  ...extra,
});

/** A synced, healthy library to build the other scenarios on. */
const synced: Partial<EngineStatus> = {
  state: 'idle',
  lastSuccessfulSyncAt: NOW - 2 * MIN,
  lastRunFilesCopied: 3,
  lastFullSyncAt: NOW - 30 * MIN,
  counts: counts(128, 14, { protonDocuments: 2 }),
  protonDocumentPaths: ['Plans/Roadmap', 'Plans/Budget 2026'],
  protonDocumentModifiedAt: { 'Plans/Roadmap': NOW - 3 * 24 * 60 * MIN, 'Plans/Budget 2026': NOW - 50 * MIN },
};

const recycled = (n: number, prefix = 'Notes'): RecycledItem[] =>
  Array.from({ length: n }, (_, i) => ({
    bucket: NOW - (i + 1) * 37 * MIN,
    relPath: `${prefix}/${i % 3 === 0 ? 'Archive/2025/' : ''}note-${String(i + 1).padStart(3, '0')}.md`,
    absolutePath: '',
    kind: 'file' as const,
    size: 400 + ((i * 7919) % 90_000),
  }));

const conflict = (id: number, relPath: string, kind: string, local: unknown, remote: unknown): ConflictEntry => ({
  id, relPath, nodeUid: `node-${String(id)}`, kind, local, remote, createdAt: NOW - id * MIN, resolvedAt: null, resolution: null,
});

const heldPaths = Array.from({ length: 63 }, (_, i) => `Photos/2024/Trip/IMG_${String(4100 + i)}.jpg`);

const SCENARIOS: Record<string, Scenario> = {
  idle: { title: 'In sync, with some skipped and recycled files', status: synced, recycle: recycled(6) },
  held: {
    title: 'A held plan waiting for confirmation (mass-deletion brake)',
    status: {
      ...synced,
      state: 'awaiting_confirmation',
      reason: 'a plan is waiting for confirmation',
      attention: { conflicts: 0, quarantined: 0, heldPlan: { id: 'held-1', reason: '63 deletions or replacements exceed the limit of 50', affected: heldPaths } },
    },
  },
  conflicts: {
    title: 'One conflict of each kind',
    status: { ...synced, state: 'attention', attention: { conflicts: 5, quarantined: 0, heldPlan: null } },
    conflicts: [
      conflict(1, 'Obsidian/Main/.obsidian/workspace.json', 'content',
        { path: 'Obsidian/Main/.obsidian/workspace.conflict-laptop-20261004T101500.json', fingerprint: { size: 6443, mtimeMs: NOW - 12 * MIN } },
        { sha1: '710e12b8c74b01e11d655f035edd63881556d4b1', size: 6475, mtimeMs: NOW - 9 * MIN }),
      conflict(2, 'Docs/Proposal.odt', 'delete_vs_edit', { deleted: true }, { deleted: false }),
      conflict(3, 'Docs/Old notes.txt', 'delete_vs_edit', { deleted: false }, { deleted: true }),
      // A move records only each side's destination.
      conflict(4, 'Projects/site/index.html', 'divergent_move', { path: 'Projects/www/index.html' }, { path: 'Projects/public/index.html' }),
      conflict(5, 'Shared/Very/Long/Folder/Structure/That/Goes/On/And/On/meeting-notes-final-v2.md', 'create_create',
        { path: 'Shared/Very/Long/Folder/Structure/That/Goes/On/And/On/meeting-notes-final-v2.conflict-laptop.md', fingerprint: { size: 1_843_200, mtimeMs: NOW - 5 * MIN } },
        { sha1: 'abc123', size: 1_901_000, mtimeMs: NOW - 4 * MIN }),
    ],
  },
  quarantine: {
    title: 'Quarantined items',
    status: { ...synced, state: 'attention', attention: { conflicts: 0, quarantined: 2, heldPlan: null } },
    quarantine: [
      { id: 1, relPath: 'Videos/holiday.mp4', nodeUid: '-00Y37Ge-g3vI9OkQjThWg~o8jmGZPmprkcW2USSLYHMw', reason: 'verification_failed', details: {}, createdAt: NOW - 90 * MIN, releasedAt: null },
      { id: 2, relPath: 'Backups/db.sqlite', nodeUid: null, reason: 'unknown_outcome', details: {}, createdAt: NOW - 20 * MIN, releasedAt: null },
    ],
  },
  transfers: {
    title: 'Uploads and downloads in progress',
    status: {
      ...synced,
      state: 'syncing',
      progress: { done: 3, total: 10 },
      pending: { uploads: 6, downloads: 4, other: 2 },
      transfers: [
        { id: 't1', kind: 'upload', relPath: 'Photos/2026/IMG_0412.heic', bytes: 2_400_000, total: 3_100_000, startedAt: NOW - 8000, speed: 300_000 },
        { id: 't2', kind: 'download', relPath: 'Music/Album/03 - Track.flac', bytes: 9_000_000, total: 31_000_000, startedAt: NOW - 30000, speed: 700_000 },
        { id: 't3', kind: 'upload', relPath: 'Notes/today.md', bytes: 0, total: undefined, startedAt: NOW, speed: 0 },
      ],
    },
  },
  paging: {
    title: 'Long lists that page (60 recycled, 30 skipped)',
    status: {
      ...synced,
      counts: counts(128, 14, { protonDocuments: 30 }),
      protonDocumentPaths: Array.from({ length: 30 }, (_, i) => `Docs/Document ${String(i + 1).padStart(2, '0')}`),
      protonDocumentModifiedAt: Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`Docs/Document ${String(i + 1).padStart(2, '0')}`, NOW - i * 97 * MIN])),
    },
    recycle: recycled(60, 'Projects/Old'),
  },
  paused: { title: 'Paused by the user', status: { ...synced, state: 'paused', reason: 'paused by user', progress: { done: 12, total: 40 } } },
  offline: { title: 'Offline', status: { ...synced, state: 'offline', reason: 'no network connection' } },
  error: { title: 'Error', status: { ...synced, state: 'error', reason: 'the sync folder /home/you/Drive is missing' } },
  login: { title: 'Sign-in required', status: { ...synced, state: 'needs_login', reason: 'the Proton session expired' } },
  dryrun: { title: 'Dry run with a degraded event stream', status: { ...synced, dryRun: true, degraded: true } },
  empty: { title: 'Fresh install: nothing synced yet', status: { state: 'idle' } },
  lost: { title: 'Engine goes away 6 seconds after the page opens (connection notice)', status: synced, stopAfterMs: 6000 },
};

/** A stand-in engine that serves a scenario and applies the page's actions to it. */
class FakeTarget implements ControlTarget {
  private status: EngineStatus;
  private conflicts: ConflictEntry[];
  private quarantine: QuarantineEntry[];
  private readonly recycle: RecycledItem[];
  private readonly listeners = new Set<(s: EngineStatus) => void>();
  /** Called once, the first time the page asks for status. */
  onFirstUse: (() => void) | null = null;

  constructor(s: Scenario) {
    this.status = { ...initialStatus(false, 0), ...s.status };
    this.conflicts = [...(s.conflicts ?? [])];
    this.quarantine = [...(s.quarantine ?? [])];
    this.recycle = s.recycle ?? [];
  }

  private set(patch: Partial<EngineStatus>): void {
    this.status = { ...this.status, ...patch };
    for (const l of this.listeners) l(this.getStatus());
  }

  getStatus(): EngineStatus {
    const first = this.onFirstUse;
    this.onFirstUse = null;
    first?.();
    const live = { ...this.status, attention: { ...this.status.attention, conflicts: this.conflicts.length, quarantined: this.quarantine.length } };
    return { ...live, summaryLines: summarize(live) };
  }
  pause(): void { this.set({ state: 'paused', reason: 'paused by user' }); }
  resume(): void { this.set({ state: 'idle', reason: null }); }
  syncNow(): Promise<unknown> {
    this.set({ lastSuccessfulSyncAt: Date.now(), lastRunFilesCopied: 0 });
    return Promise.resolve(null);
  }
  confirmHeldPlan(): Promise<unknown> { return Promise.resolve(this.clearHeld()); }
  rejectHeldPlan(): unknown { return this.clearHeld(); }
  private clearHeld(): null {
    this.set({ state: 'idle', reason: null, attention: { ...this.status.attention, heldPlan: null } });
    return null;
  }
  listConflicts(): ConflictEntry[] { return this.conflicts; }
  resolveConflict(id: number, choice: Resolution): Promise<void> {
    console.log(`  [preview] conflict ${String(id)} resolved: ${choice}`);
    this.conflicts = this.conflicts.filter((c) => c.id !== id);
    if (this.conflicts.length === 0 && this.quarantine.length === 0) this.set({ state: 'idle' });
    return Promise.resolve();
  }
  listQuarantine(): QuarantineEntry[] { return this.quarantine; }
  releaseQuarantine(id: number): void {
    this.quarantine = this.quarantine.filter((q) => q.id !== id);
    if (this.conflicts.length === 0 && this.quarantine.length === 0) this.set({ state: 'idle' });
  }
  listRecycle(): RecycledItem[] { return this.recycle; }
  quit(): Promise<void> { return Promise.resolve(); }
  onStatus(listener: (s: EngineStatus) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }
}

const names = Object.keys(SCENARIOS);
const wanted = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const unknown = wanted.filter((w) => !names.includes(w));
if (unknown.length > 0) {
  console.error(`Unknown scenario(s): ${unknown.join(', ')}. Choose from: ${names.join(', ')}`);
  process.exit(1);
}

const servers: DetailPageServer[] = [];
console.log('Details page previews (Ctrl+C to stop):\n');
for (const [i, name] of names.entries()) {
  if (wanted.length > 0 && !wanted.includes(name)) continue;
  const scenario = SCENARIOS[name];
  if (scenario === undefined) continue;
  const target = new FakeTarget(scenario);
  const server = new DetailPageServer(target, { roots: name === 'empty' ? null : ROOTS });
  try {
    await server.listen(BASE_PORT + i);
  } catch (error) {
    const port = BASE_PORT + i;
    if ((error as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw error;
    console.error(`\nPort ${String(port)} (scenario "${name}") is already in use, most likely by another preview still running.`);
    console.error(`Stop it with Ctrl+C in its terminal, or find it with: ss -ltnp | grep ${String(port)}`);
    await Promise.all(servers.map((s) => s.close()));
    process.exit(1);
  }
  servers.push(server);
  console.log(`  ${name.padEnd(11)} ${server.url}  ${scenario.title}`);
  const stopAfter = scenario.stopAfterMs;
  if (stopAfter !== undefined) {
    target.onFirstUse = () => {
      setTimeout(() => {
        console.log(`  [preview] ${name}: engine stopped; the open page should report the lost connection`);
        void server.close();
      }, stopAfter);
    };
  }
}

const stop = (): void => {
  void Promise.all(servers.map((s) => s.close())).then(() => process.exit(0));
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
