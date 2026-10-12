/**
 * Launcher files: how a URL that carries a secret (the details page token, the
 * sign-in URL's AES key) reaches the browser without ever being a process
 * argument. The URL goes into a 0600 file under the user's runtime dir that
 * redirects to it, and `xdg-open` gets only that path. Another local account
 * can read `/proc/<pid>/cmdline` but not that file. Jupyter opens its token URL
 * the same way.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

/** The launcher: an immediate redirect to `url`, with a link in case the browser does not follow it. */
export function launcherDocument(url: string): string {
  const safe = url.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="refresh" content="0; url=${safe}"><title>Proton Drive Sync</title></head><body><a href="${safe}">Continue to Proton Drive Sync</a></body></html>\n`;
}

/** Writes the 0600 launcher for `url` at `path` and returns its `file:` URL. */
export function writeLauncher(path: string, url: string): string {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, launcherDocument(url), { mode: 0o600, flag: 'w' });
  return pathToFileURL(path).href;
}

export function removeLauncher(path: string): void {
  rmSync(path, { force: true });
}

/** Opens `target` (a launcher's `file:` URL or a local path) in the desktop's handler. Never a URL with a secret. */
export function xdgOpen(target: string): void {
  try {
    const child = spawn('xdg-open', [target], { stdio: 'ignore', detached: true });
    child.on('error', () => undefined);
    child.unref();
  } catch {
    // no opener available
  }
}
