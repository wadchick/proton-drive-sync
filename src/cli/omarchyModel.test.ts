import { readFileSync } from 'node:fs';
import path from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

interface Chip {
  state: string;
  urgent: boolean;
  label: string;
  tooltip: string;
}

interface ModelApi {
  chipModel(input: unknown): Chip;
  transferLine(transfer: unknown): string;
  readingLines(lines: unknown): string[];
  heroMeta(chip: unknown, status: unknown): string;
  ago(ms: unknown, now: number): string;
  pendingText(pending: unknown): string;
  happened(conflict: unknown): string;
  canChooseSide(conflict: unknown): boolean;
  transferPercent(transfer: unknown): string;
}

const sandbox: { ProtonDriveModel?: ModelApi } = {};
runInNewContext(readFileSync(path.resolve(import.meta.dirname, '../../omarchy/Model.js'), 'utf8'), sandbox);
const model = sandbox.ProtonDriveModel;
if (model === undefined) throw new Error('ProtonDriveModel was not evaluated');

const quiet = { conflicts: 0, quarantined: 0, heldPlan: null };

describe('bar chip model', () => {
  it('covers install, sign-in, setup, stopped engine, syncing, and attention', () => {
    expect(model.chipModel({ installed: false }).state).toBe('not_installed');
    expect(model.chipModel({ installed: true, doctor: { loggedIn: false, configured: false } }).state).toBe('not_signed_in');
    expect(model.chipModel({ installed: true, doctor: { loggedIn: true, configured: false } }).state).toBe('not_configured');
    expect(model.chipModel({ installed: true, doctor: { loggedIn: true, configured: true, running: false } }).state).toBe('not_running');
    expect(model.chipModel({ installed: true, status: { state: 'syncing', attention: quiet } })).toMatchObject({ state: 'syncing', urgent: false, label: 'Sync' });
    expect(model.chipModel({ installed: true, status: { state: 'syncing', attention: quiet, progress: { done: 34, total: 5685 } } })).toMatchObject({ label: 'Sync (34/5685)', tooltip: 'Sync (34/5685)' });
    expect(model.chipModel({ installed: true, status: { state: 'paused', attention: quiet, progress: { done: 34, total: 5685 } } })).toMatchObject({ label: 'Paused (34/5685)' });
    expect(model.chipModel({ installed: true, status: { state: 'scanning', attention: quiet, progress: null } })).toMatchObject({ label: 'Scan' });
    expect(model.chipModel({ installed: true, status: { state: 'idle', attention: quiet, progress: { done: 10, total: 10 } } })).toMatchObject({ label: 'Drive' });
    expect(model.chipModel({
      installed: true,
      status: { state: 'syncing', attention: { conflicts: 1, quarantined: 0, heldPlan: null }, progress: { done: 34, total: 5685 } },
    })).toMatchObject({ state: 'attention', label: 'Check' });
    const attention = model.chipModel({
      installed: true,
      status: { state: 'idle', attention: { conflicts: 1, quarantined: 0, heldPlan: null } },
    });
    expect(attention).toMatchObject({ state: 'attention', urgent: true });
    const held = model.chipModel({
      installed: true,
      status: { state: 'syncing', attention: { conflicts: 0, quarantined: 0, heldPlan: { id: 'held-1' } } },
    });
    expect(held.state).toBe('awaiting_confirmation');
  });

  it('keeps every engine state visually distinct', () => {
    const states = ['starting', 'idle', 'scanning', 'syncing', 'paused', 'offline', 'throttled', 'attention', 'awaiting_confirmation', 'error', 'needs_login', 'stopped'];
    const labels = states.map((state) => model.chipModel({ installed: true, status: { state, attention: quiet } }).label);
    expect(new Set(labels).size).toBe(states.length);
  });

  it('keeps the library reading off the chip and out of the pending line', () => {
    const idle = model.chipModel({
      installed: true,
      status: {
        state: 'idle',
        attention: quiet,
        progress: null,
        summaryLines: [
          'In sync',
          'Last sync: 2026-09-22T17:42:23.000Z, 2 files copied',
          'Proton documents: 7 on Proton only (Docs and Sheets stay in the browser)',
        ],
      },
    });
    expect(idle.label).toBe('Drive');
    expect(idle.label).not.toContain('Last sync');
    expect(idle.label).not.toContain('Proton documents');
    expect(model.readingLines([
      'In sync',
      'Pending: 1 up, 0 down, 0 other',
      'Last sync: 2026-09-22T17:42:23.000Z, 2 files copied',
      'Proton documents: 7 on Proton only (Docs and Sheets stay in the browser)',
    ])).toEqual([
      'Last sync: 2026-09-22T17:42:23.000Z, 2 files copied',
      'Proton documents: 7 on Proton only (Docs and Sheets stay in the browser)',
    ]);
  });

  it('the panel leads with the chip glance in its header, then the stats grid, without restating sentences', () => {
    const qml = readFileSync(path.resolve(import.meta.dirname, '../../omarchy/Panel.qml'), 'utf8');
    const header = qml.indexOf('ProtonDriveModel.heroMeta');
    const stats = qml.indexOf('GridLayout');
    expect(header).toBeGreaterThan(-1);
    expect(stats).toBeGreaterThan(header);
    // The last-sync, last-full-sync and library readings appear as grid labels.
    for (const label of ['"Last sync"', '"Full sync"', '"Local"', '"Proton"', '"In sync"', '"Skipped"']) expect(qml).toContain(label);
    expect(qml).not.toContain('on this computer');
    expect(qml).not.toContain('Docs and Sheets stay');
  });

  it('heads the panel with the same glance the chip shows while a run moves', () => {
    const quietStatus = { state: 'syncing', progress: { done: 3, total: 10 }, attention: quiet };
    expect(model.heroMeta(null, quietStatus)).toBe('Sync (3/10)');
    expect(model.heroMeta(null, { ...quietStatus, state: 'paused' })).toBe('Paused (3/10)');
    expect(model.heroMeta(null, { state: 'idle', progress: null, attention: quiet })).toBe('In sync');
    // Something waiting for the user outranks progress.
    expect(model.heroMeta(null, { ...quietStatus, attention: { ...quiet, conflicts: 2 } })).toBe('Needs you');
    expect(model.heroMeta({ state: 'not_configured' }, null)).toBe('Not set up');
  });

  it('formats panel times, pending work, conflicts and transfers', () => {
    const now = 1_700_000_000_000;
    expect(model.ago(now - 20_000, now)).toBe('Just now');
    expect(model.ago(now - 5 * 60_000, now)).toBe('5 min ago');
    expect(model.ago(now - 3 * 3_600_000, now)).toBe('3 h ago');
    expect(model.ago(now - 30 * 3_600_000, now)).toBe('Yesterday');
    expect(model.ago(now - 30 * 86_400_000, now)).toBe('');
    expect(model.ago(Number.NaN, now)).toBe('');
    expect(model.pendingText({ uploads: 2, downloads: 0, other: 1 })).toBe('2 up, 1 other');
    expect(model.pendingText({ uploads: 0, downloads: 0, other: 0 })).toBe('None');
    expect(model.happened({ kind: 'delete_vs_edit', local: { deleted: false }, remote: { deleted: true } })).toBe('Edited here, deleted on Proton');
    // A delete-versus-edit conflict already kept the edit: only "keep both" is offered.
    expect(model.canChooseSide({ kind: 'delete_vs_edit' })).toBe(false);
    for (const kind of ['content', 'create_create', 'divergent_move']) expect(model.canChooseSide({ kind }), kind).toBe(true);
    expect(model.canChooseSide(null)).toBe(true);
    expect(model.transferPercent({ bytes: 1, total: 4 })).toBe('25%');
    expect(model.transferPercent({ bytes: 1, total: 0 })).toBe('');
  });

  it('formats a transfer with direction and percent', () => {
    expect(model.transferLine({ kind: 'upload', relPath: 'a.txt', bytes: 1, total: 4 })).toBe('↑ a.txt 25%');
    expect(model.transferLine({ kind: 'download', relPath: 'b.txt', bytes: 0, total: 0 })).toBe('↓ b.txt');
  });
});
