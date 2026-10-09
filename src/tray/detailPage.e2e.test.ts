// @vitest-environment happy-dom
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { EngineHarness } from '../testing/engineHarness.js';
import { DetailPageServer, systemLocale } from './detailPage.js';
import { applySnapshot, type DetailData } from './detailView.js';

/** A plain HTTP GET via node:http (happy-dom's fetch blocks cross-origin 127.0.0.1 requests). */
function httpGet(url: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    http
      .get(url, (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (c: string) => { body += c; });
        res.on('end', () => { resolve({ status: res.statusCode ?? 0, body }); });
      })
      .on('error', reject);
  });
}

/**
 * End to end: after a real sync, the detail page's live snapshot (fetched from
 * the running server) rendered into the visible DOM shows the engine state and
 * file counts — it is not a blank shell (spec: tray-status-ui / Detail page is a
 * live view — Open details with files already synced).
 */

let h: EngineHarness;
let server: DetailPageServer;
let themeDir: string;
beforeEach(() => {
  h = EngineHarness.create();
  themeDir = mkdtempSync(join(tmpdir(), 'pds-theme-'));
});
afterEach(async () => {
  await server.close();
  await h.dispose();
  rmSync(themeDir, { recursive: true, force: true });
});

describe('detail page after a sync', () => {
  it('the visible page shows the engine state and non-zero file counts', async () => {
    h.write('one.txt', '1');
    h.write('two.txt', '2');
    await h.start();
    await h.waitForConvergence();
    // Let the remote count settle as the feed reflects our uploads.
    for (let i = 0; i < 100 && h.live.engine.getStatus().counts.remoteFiles !== 2; i++) await new Promise((r) => setTimeout(r, 20));

    server = new DetailPageServer(h.live.controlTarget);
    await server.listen();

    // Fetch the live snapshot from the running server and render it into the page.
    const res = await httpGet(`${server.url}api/state`);
    expect(res.status).toBe(200);
    const data = JSON.parse(res.body) as DetailData;

    document.body.innerHTML = `
      <span id="state"></span>
      <div id="lines"></div><div id="proton-documents"></div><div id="held"></div>
      <div id="transfers"></div><div id="conflicts"></div>
      <div id="quarantine"></div><div id="recycle"></div>`;
    applySnapshot(document, data);

    expect(document.getElementById('state')?.textContent).toBe('idle');
    const stat = (label: string): string | null =>
      Array.from(document.querySelectorAll('#lines .stats .k')).find((k) => k.textContent === label)?.nextElementSibling?.textContent ?? null;
    expect(stat('Last sync')).not.toBe('--');
    expect(stat('Local files')).toBe('2');
    expect(stat('Proton Drive files')).toBe('2');
    expect(stat('Files in sync')).toBe('2');
    expect(data.locale).toBe(systemLocale());
    expect(document.getElementById('lines')?.textContent).not.toContain('synced');
    expect(document.getElementById('proton-documents')?.querySelector('[data-rows]')?.innerHTML).toBe('');
    expect(document.getElementById('proton-documents')?.textContent).not.toContain('one.txt');
  });

  it('serves the page behind the run token and 404s an unknown token', async () => {
    await h.start();
    await h.waitFor(['idle']);
    server = new DetailPageServer(h.live.controlTarget, { themePath: join(themeDir, 'colors.toml'), iconRoots: [join(themeDir, 'no-icons')] });
    await server.listen();

    const ok = await httpGet(server.url);
    expect(ok.status).toBe(200);
    // The served page carries the tested renderer, the page colors, and the library section.
    expect(ok.body).toContain('id="lines"');
    expect(ok.body).toContain('id="proton-documents"');
    expect(ok.body).not.toContain('id="glance"');
    expect(ok.body).toContain('id="action-error"');
    expect(ok.body).toContain('function applySnapshot');
    expect(ok.body).toContain('border-radius');
    // No Omarchy theme on disk: the page keeps its own look.
    expect(ok.body).toContain('<html lang="en">');
    // No icon theme either: the title icon stays hidden and its route 404s.
    expect(ok.body).toMatch(/<img[^>]+id="title-icon"[^>]+hidden>/);
    expect((await httpGet(`${server.url}icon/folder`)).status).toBe(404);
    expect(ok.body).toContain('<style id="omarchy-theme"></style>');
    for (const color of ['#cdfae4', '#d0d8fc', '#fcfdfe', '#2c3343', '#2cd1ec', '#42aefc']) expect(ok.body).toContain(color);
    expect(ok.body).not.toMatch(/<link[^>]+stylesheet/i);
    // Without a theme the header and sections are white rounded cards; with one, sections sit under dividers.
    expect(ok.body).toMatch(/html:not\(\.omarchy\) header, html:not\(\.omarchy\) main > section:not\(\[hidden\]\) \{[^}]*background: var\(--pds-card\);[^}]*border-radius: 20px;/);
    expect(ok.body).toMatch(/html\.omarchy main > section:not\(\[hidden\]\) \{[^}]*border-top: 1px solid var\(--divider\);/);
    expect(ok.body).not.toMatch(/(?:^|\n)main > section:not\(\[hidden\]\) \{[^}]*border-top/);
    // The held plan's warning box is its card, not a box inside a white card.
    expect(ok.body).toMatch(/html:not\(\.omarchy\) main > section#held \{[^}]*background: none;[^}]*padding: 0;[^}]*box-shadow: none;/);
    expect(ok.body).toMatch(/html:not\(\.omarchy\) #held > \.warn \{[^}]*border-radius: 20px;/);
    // A lone row action (Dismiss, Release) sits flush right in its column.
    expect(ok.body).toContain('td.actions-cell.end { text-align: right; }');
    // Sync now as the call to action is a filled icon button, so its icon stays visible on any theme.
    expect(ok.body).toContain('.btn.icon.primary { background: var(--primary-bg); border-color: var(--primary-bg); color: var(--primary-fg); }');
    // Proceed and Reject sit flush right on the filter's row.
    expect(ok.body).toMatch(/\.held-actions \{[^}]*margin-left: auto;/);
    // The details live in the alternating state line: no separate reason line or notes.
    expect(ok.body).not.toContain('id="reason"');
    expect(ok.body).not.toContain('id="flags"');
    // It fades like the Wi-Fi panel's caption (180ms out, 260ms in), without motion if asked.
    expect(ok.body).toContain('.state { transition: opacity 260ms ease-in; }');
    expect(ok.body).toContain('.state.fading { opacity: 0; transition: opacity 180ms ease-out; }');
    expect(ok.body).toMatch(/@media \(prefers-reduced-motion: reduce\) \{ \.state, \.state\.fading \{ transition: none; \} \}/);
    // Warnings and errors take their own colours.
    expect(ok.body).toContain('.state[data-tone="warn"] { color: var(--status-warn); }');
    expect(ok.body).toContain('.state[data-tone="danger"] { color: var(--status-danger); }');
    expect(ok.body).toMatch(/html\.omarchy \{[^}]*--status-warn: var\(--om-yellow, var\(--om-accent\)\);[^}]*--status-danger: var\(--om-red, var\(--om-accent\)\);/);
    expect(ok.body).toContain('function advanceStatus');
    expect(ok.body).toContain('setInterval(rotateStatus, 2800)');
    // Control widths may be a per-side list, which the border shorthand rejects (no border at all).
    expect(ok.body).not.toMatch(/border:\s*var\(--ctl-border-width\)/);
    expect(ok.body).not.toMatch(/<script[^>]+src=/i);
    const order = ['id="act-sync"', 'id="lines"', 'id="held"', 'id="conflicts"', 'id="quarantine"', 'id="transfers"', 'id="proton-documents"', 'id="recycle"'];
    let at = -1;
    for (const id of order) {
      const next = ok.body.indexOf(id);
      expect(next).toBeGreaterThan(at);
      at = next;
    }

    const bad = await httpGet(server.url.replace(server.token, 'deadbeef'));
    expect(bad.status).toBe(404);
  });

  it('follows the Omarchy theme on disk, live', async () => {
    await h.start();
    await h.waitFor(['idle']);
    const colors = join(themeDir, 'colors.toml');
    writeFileSync(colors, 'mode = "dark"\naccent = "#81a1c1"\nbackground = "#2e3440"\nforeground = "#d8dee9"\n');
    const icons = join(themeDir, 'icons');
    mkdirSync(join(icons, 'Adwaita', 'scalable', 'places'), { recursive: true });
    writeFileSync(join(icons, 'Adwaita', 'scalable', 'places', 'folder.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
    server = new DetailPageServer(h.live.controlTarget, { themePath: colors, iconRoots: [icons] });
    await server.listen();

    const page = await httpGet(server.url);
    expect(page.body).toContain('<html lang="en" class="omarchy">');
    expect(page.body).toContain('--om-background: #2e3440;');
    expect(page.body).toMatch(/<img[^>]+id="title-icon"[^>]+src="icon\/folder"/);
    expect(page.body).not.toMatch(/<img[^>]+id="title-icon"[^>]+hidden>/);
    const icon = await httpGet(`${server.url}icon/folder`);
    expect(icon.status).toBe(200);
    expect(icon.body).toContain('<svg');

    writeFileSync(colors, 'mode = "light"\naccent = "#1e66f5"\nbackground = "#eff1f5"\nforeground = "#4c4f69"\n');
    const theme = JSON.parse((await httpGet(`${server.url}api/theme`)).body) as { css: string };
    expect(theme.css).toContain('color-scheme: light;');
    expect(theme.css).toContain('--om-accent: #1e66f5;');
  });
});

describe('systemLocale', () => {
  it('follows LC_ALL, then LC_TIME, then LANG, as POSIX does', () => {
    expect(systemLocale({ LANG: 'en_US.UTF-8' })).toBe('en-US');
    expect(systemLocale({ LANG: 'en_US.UTF-8', LC_TIME: 'en_GB.UTF-8' })).toBe('en-GB');
    expect(systemLocale({ LC_ALL: 'de_DE.UTF-8', LC_TIME: 'en_GB.UTF-8' })).toBe('de-DE');
    expect(systemLocale({ LC_ALL: '', LANG: 'fr_FR.UTF-8@euro' })).toBe('fr-FR');
  });

  it('leaves C, POSIX and unset to the browser', () => {
    expect(systemLocale({ LANG: 'C.UTF-8' })).toBeNull();
    expect(systemLocale({ LC_ALL: 'POSIX' })).toBeNull();
    expect(systemLocale({})).toBeNull();
  });
});
