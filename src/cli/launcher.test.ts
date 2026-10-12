import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { launcherDocument, removeLauncher, writeLauncher } from './launcher.js';

describe('browser launcher files', () => {
  it('writes a 0600 redirect to the URL and returns its file: URL', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'pds-launcher-'));
    try {
      const file = path.join(dir, 'run', 'login.html');
      const url = 'https://account.proton.me/desktop/login?app=drive&pv=3#payload=0%3Acode%3Akey%3Aid';
      expect(writeLauncher(file, url)).toBe(`file://${file}`);
      expect(statSync(file).mode & 0o777).toBe(0o600);
      expect(statSync(path.dirname(file)).mode & 0o777).toBe(0o700);
      expect(readFileSync(file, 'utf8')).toBe(launcherDocument(url));
      expect(launcherDocument(url)).toContain('content="0; url=https://account.proton.me/desktop/login?app=drive&amp;pv=3#payload=0%3Acode%3Akey%3Aid"');
      removeLauncher(file);
      expect(readdirSync(path.dirname(file))).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // Secrets reach the browser only through a launcher: a URL in argv is readable by every local account via /proc.
  it('no other source file starts a subprocess or names xdg-open', () => {
    const src = path.resolve(__dirname, '..');
    const offenders: string[] = [];
    const walk = (d: string): void => {
      for (const entry of readdirSync(d, { withFileTypes: true })) {
        const full = path.join(d, entry.name);
        if (entry.isDirectory()) { walk(full); continue; }
        if (!entry.name.endsWith('.ts') || entry.name.includes('.test.') || full.includes(`${path.sep}testing${path.sep}`)) continue;
        const rel = path.relative(src, full);
        if (rel === path.join('cli', 'launcher.ts') || rel === path.join('config', 'secretStore.ts')) continue; // xdg-open on a launcher; secret-tool with its secret on stdin
        const text = readFileSync(full, 'utf8');
        if (/node:child_process|['"]xdg-open['"]/.test(text)) offenders.push(rel);
      }
    };
    walk(src);
    expect(offenders).toEqual([]);
  });
});
