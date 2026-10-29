/**
 * The parts of scripts/preview-panel.ts that decide what a run produced, kept apart from
 * Quickshell so they can be tested: clearing a reused output folder, and reading which
 * screenshots a Quickshell run saved.
 */
import { existsSync, lstatSync, rmSync } from 'node:fs';
import { basename, join } from 'node:path';

/** What spawnSync returned for the Quickshell run. */
export interface QuickshellRun {
  status: number | null;
  signal: NodeJS.Signals | null;
  error?: Error | undefined;
  stdout: string;
  stderr: string;
}

/** The screenshots saved for each scenario file name: the card, then its scrolled shot if any. */
export type Shots = Map<string, string[]>;

export type RunOutcome =
  | { ok: true; shots: Shots; log: string }
  /** `showLog`: the message alone doesn't explain it, so Quickshell's output should follow. */
  | { ok: false; message: string; showLog: boolean; log: string };

/** Quickshell colors its log; drop the color codes (ESC [ ... m). */
export function stripColors(text: string): string {
  return text.replace(new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g'), '');
}

/**
 * Remove the named scenarios' earlier shots from a reused output folder, so a scrolled shot
 * left by an earlier, scrolling run can't be taken for this run's. Returns a problem to report,
 * or null. Anything that isn't a plain file is left alone and reported.
 */
export function clearShots(dir: string, names: readonly string[]): string | null {
  for (const name of names) {
    for (const file of [`${name}.png`, `${name}-scrolled.png`]) {
      const path = join(dir, file);
      if (!existsSync(path)) continue;
      if (!lstatSync(path).isFile()) return `${path} is in the way and is not a screenshot. Move it, or choose another --out.`;
      rmSync(path);
    }
  }
  return null;
}

/**
 * Read a finished Quickshell run. Only the files the harness reports as saved in this run
 * count, never whatever else is in the folder. Every named scenario must have its card shot,
 * and a failed save or an abnormal exit fails the whole run.
 */
export function readRun(run: QuickshellRun, names: readonly string[]): RunOutcome {
  const log = stripColors(`${run.stdout}\n${run.stderr}`);
  if (run.error !== undefined) return { ok: false, message: `Quickshell could not run or did not finish (${run.error.message}).`, showLog: true, log };
  if (log.includes('panel-preview: failed')) return { ok: false, message: 'Some screenshots could not be saved; see the lines above.', showLog: false, log };
  if (run.status !== 0) {
    const how = run.signal !== null ? `was stopped by ${run.signal}` : `exited with status ${String(run.status)}`;
    return { ok: false, message: `Quickshell ${how}.`, showLog: true, log };
  }

  const shots: Shots = new Map();
  for (const match of log.matchAll(/panel-preview: saved (\S+\.png)/g)) {
    const path = match[1] ?? '';
    const name = basename(path, '.png').replace(/-scrolled$/, '');
    if (!names.includes(name)) continue;
    const list = shots.get(name) ?? [];
    list.push(path);
    shots.set(name, list);
  }
  for (const list of shots.values()) list.sort((a, b) => Number(a.endsWith('-scrolled.png')) - Number(b.endsWith('-scrolled.png')));

  const missing = names.filter((name) => !(shots.get(name) ?? []).some((path) => basename(path) === `${name}.png`));
  if (missing.length > 0) return { ok: false, message: `Quickshell stopped before saving: ${missing.join(', ')}.`, showLog: true, log };
  return { ok: true, shots, log };
}
