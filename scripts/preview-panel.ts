/**
 * Screenshot the bar panel (omarchy/Panel.qml) in every state with made-up data, without
 * a running sync engine and without showing anything on screen.
 *
 *   npx vite-node scripts/preview-panel.ts                          # working tree, every scenario
 *   npx vite-node scripts/preview-panel.ts held conflicts           # just these
 *   npx vite-node scripts/preview-panel.ts --ref origin/master      # the panel at a git ref
 *   npx vite-node scripts/preview-panel.ts --compare origin/master  # side by side: the ref, then the working tree
 *   npx vite-node scripts/preview-panel.ts --out ~/shots            # where the PNGs go (default: a new temp folder)
 *
 * The panel, the shell's Commons and Ui modules and the Omarchy theme are the real ones,
 * rendered by Quickshell on Qt's offscreen platform. Two pieces are stand-ins: the engine
 * data, built here with the engine's own initialStatus() and summarize(), and the shell's
 * KeyboardPanel, replaced by scripts/preview-panel/KeyboardPanel.qml, which draws the
 * same card without the full-screen popup window.
 *
 * Scenarios, options and troubleshooting: scripts/preview-panel.md.
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { initialStatus, summarize, type EngineStatus } from '../src/engine/status.js';
import type { ConflictEntry, QuarantineEntry } from '../src/state/misc.js';
import { clearShots, harnessLine, readRun, type Shots } from './preview-panel/outcome.js';

const REPO = resolve(import.meta.dirname, '..');
const HARNESS = join(REPO, 'scripts', 'preview-panel');
const SHELL = join(process.env['OMARCHY_PATH'] ?? '/usr/share/omarchy', 'shell');
const NOW = Date.now();
const MIN = 60_000;
const ROOTS = { local: '/home/you/Drive', remote: '/my-files/Drive' };
const LAUNCHER = '/home/you/.config/omarchy/plugins/io.github.zakkoo.proton-drive/bin/proton-drive-sync';

/** The fields of `doctor --json` the panel reads. */
interface Doctor {
  nodeOk: boolean;
  configured: boolean;
  loggedIn: boolean;
  running: boolean;
  localRoot?: string;
  remoteRoot?: string;
  configFile?: string;
  detailUrl?: string;
  version: string;
}

interface Scenario {
  title: string;
  doctor: Doctor;
  /** Null before the engine runs (signed out, not set up, engine failed). */
  status: EngineStatus | null;
  conflicts?: ConflictEntry[];
  quarantine?: QuarantineEntry[];
  engineFailed?: boolean;
}

const RUNNING: Doctor = {
  nodeOk: true,
  configured: true,
  loggedIn: true,
  running: true,
  localRoot: ROOTS.local,
  remoteRoot: ROOTS.remote,
  configFile: '/home/you/.config/proton-drive-sync/config.json',
  detailUrl: 'file:///run/user/1000/proton-drive-sync/details.html',
  version: 'preview',
};
const STOPPED: Doctor = { ...RUNNING, running: false };

/** A synced, healthy library to build the other scenarios on. */
const synced: Partial<EngineStatus> = {
  state: 'idle',
  since: NOW - 2 * MIN,
  lastSuccessfulSyncAt: NOW - 2 * MIN,
  lastRunFilesCopied: 3,
  lastFullSyncAt: NOW - 14 * MIN,
  lastCycleAt: NOW - 2 * MIN,
  counts: { baseline: 1280, localFiles: 1184, remoteFiles: 1188, pairedFiles: 1184, pairedFolders: 96, protonDocuments: 4, onlyLocal: 0, onlyRemote: 0 },
};

/** The status as `status --json` returns it: the engine's object plus its summary lines. */
function status(patch: Partial<EngineStatus>): EngineStatus {
  const s: EngineStatus = { ...initialStatus(false, NOW), ...synced, ...patch };
  return { ...s, summaryLines: summarize(s) };
}

const attention = (conflicts: number, quarantined: number, heldPlan: EngineStatus['attention']['heldPlan'] = null): EngineStatus['attention'] =>
  ({ conflicts, quarantined, heldPlan });

const conflict = (id: number, relPath: string, kind: string, local: unknown, remote: unknown): ConflictEntry => ({
  id, relPath, nodeUid: `node-${String(id)}`, kind, local, remote, createdAt: NOW - id * MIN, resolvedAt: null, resolution: null,
});

const CONFLICTS = [
  conflict(1, 'Documents/Budget 2026.ods', 'content', { fingerprint: { size: 48_200, mtimeMs: NOW - 12 * MIN } }, { sha1: '710e12b8', size: 48_900, mtimeMs: NOW - 9 * MIN }),
  conflict(2, 'Notes/Trip planning.md', 'delete_vs_edit', { deleted: true }, { deleted: false }),
  conflict(3, 'Photos/2026/Lisbon/IMG_4021.jpg', 'delete_vs_edit', { deleted: false }, { deleted: true }),
  conflict(4, 'Projects/website/drafts/about-page-final-final-v3.html', 'divergent_move', { path: 'Projects/www/about.html' }, { path: 'Projects/public/about.html' }),
  conflict(5, 'Taxes/receipts.pdf', 'create_create', { fingerprint: { size: 1_843_200, mtimeMs: NOW - 5 * MIN } }, { sha1: 'abc123', size: 1_901_000, mtimeMs: NOW - 4 * MIN }),
  conflict(6, 'Obsidian/Main/.obsidian/workspace.json', 'content', { fingerprint: { size: 6443, mtimeMs: NOW - 3 * MIN } }, { sha1: 'def456', size: 6475, mtimeMs: NOW - 2 * MIN }),
  conflict(7, 'Music/playlist.m3u', 'content', { fingerprint: { size: 900, mtimeMs: NOW - 2 * MIN } }, { sha1: '0a1b2c', size: 912, mtimeMs: NOW - MIN }),
];

// The engine sends the shell at most 50 rows of a list and the true total alongside.
const heldPaths = Array.from({ length: 50 }, (_, i) => `Archive/2019/scans/scan-${String(i + 1).padStart(3, '0')}.pdf`);

const SCENARIOS: Record<string, Scenario> = {
  idle: { title: 'In sync', doctor: RUNNING, status: status({}) },
  syncing: {
    title: 'Syncing 3 of 10, two transfers in progress',
    doctor: RUNNING,
    status: status({
      state: 'syncing',
      progress: { done: 3, total: 10 },
      pending: { uploads: 5, downloads: 2, other: 0 },
      transfers: [
        { id: 't1', kind: 'upload', relPath: 'Photos/2026/Lisbon/IMG_4102.jpg', bytes: 2_600_000, total: 4_100_000, startedAt: NOW - 8000, speed: 300_000 },
        { id: 't2', kind: 'download', relPath: 'Documents/Contracts/lease-renewal-2026.pdf', bytes: 120_000, total: 900_000, startedAt: NOW - 3000, speed: 40_000 },
      ],
    }),
  },
  paused: { title: 'Paused partway through a run', doctor: RUNNING, status: status({ state: 'paused', reason: 'paused by user', progress: { done: 3, total: 10 }, pending: { uploads: 5, downloads: 2, other: 0 } }) },
  conflicts: { title: 'Seven conflicts, more than a panel shows', doctor: RUNNING, status: status({ state: 'attention', attention: attention(7, 0) }), conflicts: CONFLICTS },
  'conflicts-few': { title: 'Three conflicts', doctor: RUNNING, status: status({ state: 'attention', attention: attention(3, 0) }), conflicts: CONFLICTS.slice(0, 3) },
  held: {
    title: 'A 64-file held plan (mass-change brake)',
    doctor: RUNNING,
    status: status({
      state: 'awaiting_confirmation',
      reason: 'a plan is waiting for confirmation',
      attention: attention(0, 0, { id: 'held-1', reason: '64 deletions or replacements exceed the limit of 50', affected: heldPaths, affectedTotal: 64 }),
    }),
  },
  quarantine: {
    title: 'Two quarantined items, one without a local path',
    doctor: RUNNING,
    status: status({ state: 'attention', attention: attention(0, 2) }),
    quarantine: [
      { id: 1, relPath: 'Videos/holiday.mp4', nodeUid: '-00Y37Ge-g3vI9OkQjThWg~o8jmGZPmprkcW2USSLYHMw', reason: 'verification_failed', details: { op: 'download' }, createdAt: NOW - 90 * MIN, releasedAt: null },
      { id: 2, relPath: null, nodeUid: 'vol~1a2b3c/node~9f8e7d', reason: 'unknown_outcome', details: { op: 'upload' }, createdAt: NOW - 20 * MIN, releasedAt: null },
    ],
  },
  offline: { title: 'Offline', doctor: RUNNING, status: status({ state: 'offline', reason: 'events for scope Y2xrZW5fc2NvcGU: connection failed' }) },
  error: { title: 'The sync folder is missing', doctor: RUNNING, status: status({ state: 'error', reason: `sync_root_missing: Sync root is unavailable: ${ROOTS.local}` }) },
  login: { title: 'The Proton session expired', doctor: RUNNING, status: status({ state: 'needs_login', reason: 'session rejected' }) },
  'signed-out': { title: 'Not signed in yet', doctor: { nodeOk: true, configured: false, loggedIn: false, running: false, version: 'preview' }, status: null },
  'not-configured': { title: 'Signed in, folders not chosen yet', doctor: { nodeOk: true, configured: false, loggedIn: true, running: false, version: 'preview' }, status: null },
  'engine-failed': { title: 'The engine keeps stopping', doctor: STOPPED, status: null, engineFailed: true },
};

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function onPath(command: string): boolean {
  return spawnSync('sh', ['-c', `command -v ${command}`], { stdio: 'ignore' }).status === 0;
}

// ---- arguments ----------------------------------------------------------------------

const args = process.argv.slice(2);
function option(name: string): string | undefined {
  const at = args.indexOf(name);
  if (at < 0) return undefined;
  const value = args[at + 1];
  if (value === undefined || value.startsWith('--')) fail(`${name} needs a value.`);
  args.splice(at, 2);
  return value;
}
const ref = option('--ref');
const compare = option('--compare');
const outOption = option('--out');
const scale = option('--scale') ?? '2';
const screen = option('--screen') ?? '1920x1080';
if (ref !== undefined && compare !== undefined) fail('Use --ref or --compare, not both.');
const unknownFlag = args.find((a) => a.startsWith('-'));
if (unknownFlag !== undefined) fail(`Unknown option ${unknownFlag}. See scripts/preview-panel.md.`);
const screenMatch = /^(\d+)x(\d+)$/.exec(screen);
if (screenMatch === null) fail('--screen takes WIDTHxHEIGHT in logical pixels, e.g. 1920x1080.');
const [, screenW = '1920', screenH = '1080'] = screenMatch;

const names = Object.keys(SCENARIOS);
const unknown = args.filter((a) => !names.includes(a));
if (unknown.length > 0) fail(`Unknown scenario(s): ${unknown.join(', ')}. Choose from: ${names.join(', ')}`);
const wanted = args.length > 0 ? names.filter((n) => args.includes(n)) : names;
/** File names keep the list's order: 01-idle.png, 02-syncing.png, ... */
const fileName = (name: string): string => `${String(names.indexOf(name) + 1).padStart(2, '0')}-${name}`;

if (!onPath('qs')) fail('Quickshell (qs) was not found. The preview needs Omarchy\'s shell.');
if (!existsSync(join(SHELL, 'Ui', 'KeyboardPanel.qml'))) fail(`Omarchy's shell modules were not found in ${SHELL}. Set OMARCHY_PATH if Omarchy lives elsewhere.`);
if (compare !== undefined && !onPath('magick')) fail('--compare needs ImageMagick (magick) to put the pairs together.');

// ---- rendering ----------------------------------------------------------------------

/** The panel's files from the working tree, or from `rev` when given. */
function panelFile(rel: string, rev: string | undefined): string {
  if (rev === undefined) return readFileSync(join(REPO, rel), 'utf8');
  const shown = spawnSync('git', ['show', `${rev}:${rel}`], { cwd: REPO, encoding: 'utf8' });
  if (shown.status !== 0) fail(`Could not read ${rel} at ${rev}: ${shown.stderr.trim()}`);
  return shown.stdout;
}

/** Render every wanted scenario of one panel version into `outDir`. Returns the shots this run saved. */
function render(rev: string | undefined, outDir: string): Shots {
  const work = mkdtempSync(join(tmpdir(), 'panel-preview-qs-'));
  try {
    // The harness folder is a Quickshell config: `qs.Commons` and `qs.Ui` resolve to its
    // own Commons/ and Ui/ folders, so the shell's are linked in, with the one stand-in.
    symlinkSync(join(SHELL, 'Commons'), join(work, 'Commons'));
    mkdirSync(join(work, 'Ui'));
    for (const file of readdirSync(join(SHELL, 'Ui'))) {
      if (file !== 'KeyboardPanel.qml') symlinkSync(join(SHELL, 'Ui', file), join(work, 'Ui', file));
    }
    copyFileSync(join(HARNESS, 'KeyboardPanel.qml'), join(work, 'Ui', 'KeyboardPanel.qml'));
    copyFileSync(join(HARNESS, 'shell.qml'), join(work, 'shell.qml'));
    mkdirSync(join(work, 'plugin'));
    writeFileSync(join(work, 'plugin', 'Panel.qml'), panelFile('omarchy/Panel.qml', rev));
    writeFileSync(join(work, 'plugin', 'Model.js'), panelFile('omarchy/Model.js', rev));
    const list = wanted.map((name) => {
      const s = SCENARIOS[name];
      if (s === undefined) fail(`No scenario ${name}`);
      return { file: fileName(name), doctor: s.doctor, status: s.status, conflicts: s.conflicts ?? [], quarantine: s.quarantine ?? [], engineFailed: s.engineFailed === true };
    });
    writeFileSync(join(work, 'Scenarios.js'), `.pragma library\nvar LAUNCHER = ${JSON.stringify(LAUNCHER)}\nvar LIST = ${JSON.stringify(list)}\n`);

    mkdirSync(outDir, { recursive: true });
    const blocked = clearShots(outDir, wanted.map(fileName));
    if (blocked !== null) fail(blocked);
    const run = spawnSync('qs', ['-p', join(work, 'shell.qml')], {
      encoding: 'utf8',
      timeout: 120_000,
      env: {
        ...process.env,
        QT_QPA_PLATFORM: 'offscreen',
        QT_SCALE_FACTOR: scale,
        PANEL_PREVIEW_OUT: outDir,
        PANEL_PREVIEW_SCREEN_W: screenW,
        PANEL_PREVIEW_SCREEN_H: screenH,
      },
    });
    const outcome = readRun(run, wanted.map(fileName));
    // Warnings from the panel itself are worth seeing; the shell's own startup chatter is not.
    for (const line of outcome.log.split('\n')) {
      if (line.includes('plugin/Panel.qml') || harnessLine(line)?.kind === 'failed') console.log(`  ${line.trim()}`);
    }
    if (!outcome.ok) fail(outcome.showLog ? `${outcome.message} Its output:\n${outcome.log}` : outcome.message);
    return outcome.shots;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/** One image per scenario: `left` beside `right`, each under its label. Uses only this run's shots. */
function pairUp(left: Shots, leftLabel: string, right: Shots, rightLabel: string, outDir: string): void {
  mkdirSync(outDir, { recursive: true });
  const blocked = clearShots(outDir, wanted.map(fileName));
  if (blocked !== null) fail(blocked);
  const bg = '#15171c';
  const font = spawnSync('fc-match', ['-f', '%{file}', 'monospace:bold'], { encoding: 'utf8' }).stdout.trim();
  const labelled = (images: string[], label: string): string[] => [
    '(', ...images.flatMap((img, i) => (i === 0 ? [img] : ['(', '-background', bg, '-size', '1x40', 'xc:' + bg, ')', img])),
    '-background', bg, '-gravity', 'center', '-append',
    ...(font ? ['-font', font] : []), '-fill', '#d8dee9', '-pointsize', '30', '-gravity', 'north', '-splice', '0x70', '-annotate', '+0+18', label, ')',
  ];
  for (const name of wanted.map(fileName)) {
    // render() has already checked that every scenario has its card shot on both sides.
    const leftShots = left.get(name) ?? [];
    const rightShots = right.get(name) ?? [];
    const scrolled = (files: string[], label: string): string => (files.length > 1 ? `${label} (top, then scrolled)` : label);
    const made = spawnSync('magick', [
      ...labelled(leftShots, scrolled(leftShots, leftLabel)),
      ...labelled(rightShots, scrolled(rightShots, rightLabel)),
      '-background', bg, '-gravity', 'north', '+smush', '60', '-bordercolor', bg, '-border', '40', join(outDir, `${name}.png`),
    ], { encoding: 'utf8' });
    if (made.status !== 0) fail(`ImageMagick could not make the ${name} pair: ${made.stderr.trim()}`);
  }
}

const out = outOption !== undefined ? resolve(outOption) : mkdtempSync(join(tmpdir(), 'panel-preview-'));
if (compare === undefined) {
  const shots = render(ref, out);
  const count = [...shots.values()].reduce((n, list) => n + list.length, 0);
  console.log(`${String(count)} screenshot(s) of ${ref ?? 'the working tree'}'s panel in ${out}`);
} else {
  const slug = compare.replace(/[^A-Za-z0-9._-]+/g, '-');
  const left = render(compare, join(out, slug));
  const right = render(undefined, join(out, 'working-tree'));
  pairUp(left, compare, right, 'working tree', join(out, 'pairs'));
  console.log(`Pairs (${compare} left, working tree right) in ${join(out, 'pairs')}; the single shots are beside them.`);
}
