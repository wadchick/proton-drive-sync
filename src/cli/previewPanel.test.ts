import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clearShots, readRun, type QuickshellRun } from '../../scripts/preview-panel/outcome.js';

// The harness prints one line per screenshot, as shell.qml's save() does, among Quickshell's
// own colored log lines.
const saved = (path: string): string => `\x1b[34m DEBUG\x1b[97m qml\x1b[0m: panel-preview: saved ${path}`;
const failed = (path: string): string => `\x1b[34m DEBUG\x1b[97m qml\x1b[0m: panel-preview: failed ${path}`;

function run(lines: string[], patch: Partial<QuickshellRun> = {}): QuickshellRun {
  return { status: 0, signal: null, stdout: '', stderr: [' INFO: Launching config', ...lines].join('\n'), ...patch };
}

describe('preview-panel: reading a Quickshell run', () => {
  it('collects each scenario’s card and scrolled shot, card first', () => {
    const outcome = readRun(run([saved('/out/01-idle.png'), saved('/out/06-held.png'), saved('/out/06-held-scrolled.png')]), ['01-idle', '06-held']);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.shots.get('01-idle')).toEqual(['/out/01-idle.png']);
    expect(outcome.shots.get('06-held')).toEqual(['/out/06-held.png', '/out/06-held-scrolled.png']);
    expect(outcome.log).not.toContain('\x1b[');
  });

  it('fails the run when one save failed, even though another scenario saved', () => {
    const outcome = readRun(run([saved('/out/01-idle.png'), failed('/out/02-syncing.png')]), ['01-idle', '02-syncing']);
    expect(outcome).toMatchObject({ ok: false, message: 'Some screenshots could not be saved; see the lines above.' });
  });

  it('fails the run when a scenario has no card shot', () => {
    const outcome = readRun(run([saved('/out/01-idle.png')]), ['01-idle', '02-syncing']);
    expect(outcome).toMatchObject({ ok: false, message: 'Quickshell stopped before saving: 02-syncing.', showLog: true });
  });

  it('does not count a scrolled shot as the card', () => {
    const outcome = readRun(run([saved('/out/06-held-scrolled.png')]), ['06-held']);
    expect(outcome).toMatchObject({ ok: false, message: 'Quickshell stopped before saving: 06-held.' });
  });

  it('fails the run on a non-zero exit or a signal, even with every shot saved', () => {
    expect(readRun(run([saved('/out/01-idle.png')], { status: 1 }), ['01-idle'])).toMatchObject({ ok: false, message: 'Quickshell exited with status 1.' });
    expect(readRun(run([saved('/out/01-idle.png')], { status: null, signal: 'SIGSEGV' }), ['01-idle'])).toMatchObject({ ok: false, message: 'Quickshell was stopped by SIGSEGV.' });
  });

  it('fails the run when Quickshell could not start or timed out', () => {
    const outcome = readRun(run([], { status: null, signal: 'SIGTERM', error: new Error('spawnSync qs ETIMEDOUT') }), ['01-idle']);
    expect(outcome).toMatchObject({ ok: false, message: 'Quickshell could not run or did not finish (spawnSync qs ETIMEDOUT).' });
  });

  it('ignores shots of scenarios that were not asked for', () => {
    const outcome = readRun(run([saved('/out/01-idle.png'), saved('/out/02-syncing.png')]), ['01-idle']);
    expect(outcome.ok && [...outcome.shots.keys()]).toEqual(['01-idle']);
  });
});

describe('preview-panel: reusing an output folder', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'pds-preview-panel-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('removes the earlier shots of the scenarios about to render, and only those', () => {
    for (const file of ['01-idle.png', '01-idle-scrolled.png', '06-held.png', '06-held-scrolled.png', 'notes.txt']) writeFileSync(join(dir, file), 'x');
    expect(clearShots(dir, ['01-idle'])).toBeNull();
    expect(existsSync(join(dir, '01-idle.png'))).toBe(false);
    expect(existsSync(join(dir, '01-idle-scrolled.png'))).toBe(false);
    expect(existsSync(join(dir, '06-held.png'))).toBe(true);
    expect(existsSync(join(dir, '06-held-scrolled.png'))).toBe(true);
    expect(existsSync(join(dir, 'notes.txt'))).toBe(true);
  });

  it('a stale scrolled shot from an earlier run is gone and is not part of the new run', () => {
    // An earlier run on a short screen scrolled; this one does not.
    writeFileSync(join(dir, '01-idle-scrolled.png'), 'old');
    expect(clearShots(dir, ['01-idle'])).toBeNull();
    const outcome = readRun(run([saved(join(dir, '01-idle.png'))]), ['01-idle']);
    expect(outcome.ok && outcome.shots.get('01-idle')).toEqual([join(dir, '01-idle.png')]);
    expect(existsSync(join(dir, '01-idle-scrolled.png'))).toBe(false);
  });

  it('leaves anything that is not a plain file alone and reports it', () => {
    mkdirSync(join(dir, '02-syncing.png'));
    expect(clearShots(dir, ['02-syncing'])).toBe(`${join(dir, '02-syncing.png')} is in the way and is not a screenshot. Move it, or choose another --out.`);
    expect(existsSync(join(dir, '02-syncing.png'))).toBe(true);
  });
});
