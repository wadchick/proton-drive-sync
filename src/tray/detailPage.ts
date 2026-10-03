/**
 * Local detail page: a small HTTP server bound to 127.0.0.1 with a random
 * port and a per-run token in the path. Shows transfers, conflicts,
 * quarantine and the held plan with the same actions as the tray, rendered
 * in the default browser (dbusmenu cannot show tables).
 */
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { dirname } from 'node:path';

import type { ControlTarget } from '../engine/control.js';
import { clientScript } from './detailView.js';
import { defaultIconRoots, omarchyColorsPath, omarchyThemeCss, readOmarchyTheme, resolveFolderIcon, type ThemeIcon } from './omarchyTheme.js';

export interface DetailPageOptions {
  /** The Omarchy theme's colors.toml; its directory also holds shell.toml and icons.theme. */
  themePath?: string;
  /** Directories holding icon themes, searched in order. */
  iconRoots?: string[];
  /** The configured sync pair, shown in the stats. */
  roots?: { local: string; remote: string } | null;
  /** BCP 47 tag dates are formatted with; null leaves it to the browser. */
  locale?: string | null;
}

/**
 * The system's date and time locale, as POSIX resolves it: LC_ALL, then
 * LC_TIME, then LANG ("en_GB.UTF-8" becomes "en-GB"). Null for C/POSIX or
 * anything Intl does not know, which leaves formatting to the browser.
 */
export function systemLocale(env: NodeJS.ProcessEnv = process.env): string | null {
  for (const key of ['LC_ALL', 'LC_TIME', 'LANG']) {
    const value = env[key];
    if (value === undefined || value === '') continue;
    const tag = (value.split('.')[0] ?? '').split('@')[0]?.replace(/_/g, '-') ?? '';
    if (tag === '' || tag === 'C' || tag === 'POSIX') return null;
    try {
      return Intl.DateTimeFormat.supportedLocalesOf([tag])[0] ?? null;
    } catch {
      return null;
    }
  }
  return null;
}

export class DetailPageServer {
  private server: Server | null = null;
  readonly token = randomBytes(16).toString('hex');
  private port = 0;
  private readonly themePath: string;
  private readonly iconRoots: string[];
  private readonly roots: { local: string; remote: string } | null;
  private readonly locale: string | null;

  constructor(
    private readonly target: ControlTarget,
    options: DetailPageOptions = {},
  ) {
    this.themePath = options.themePath ?? omarchyColorsPath();
    this.iconRoots = options.iconRoots ?? defaultIconRoots();
    this.roots = options.roots ?? null;
    this.locale = options.locale === undefined ? systemLocale() : options.locale;
  }

  get url(): string {
    return `http://127.0.0.1:${String(this.port)}/${this.token}/`;
  }

  async listen(port = 0): Promise<void> {
    this.server = createServer((req, res) => {
      void this.handle(req, res);
    });
    await new Promise<void>((resolve, reject) => {
      this.server?.once('error', reject);
      this.server?.listen(port, '127.0.0.1', () => {
        resolve();
      });
    });
    this.port = (this.server.address() as AddressInfo).port;
  }

  async close(): Promise<void> {
    await new Promise<void>((resolve) => {
      if (this.server === null) {
        resolve();
        return;
      }
      this.server.close(() => {
        resolve();
      });
    });
    this.server = null;
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const parts = url.pathname.split('/').filter((p) => p !== '');
    if (parts[0] !== this.token) {
      res.writeHead(404).end('not found');
      return;
    }
    const route = parts.slice(1).join('/');
    try {
      if (req.method === 'GET' && route === '') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }).end(renderPage(this.themeCss(), this.folderIcon()?.path ?? ''));
        return;
      }
      if (req.method === 'GET' && route === 'api/theme') {
        // `icon` names the current folder icon so an open page can tell when it changed.
        this.json(res, { css: this.themeCss(), icon: this.folderIcon()?.path ?? '' });
        return;
      }
      if (req.method === 'GET' && route === 'icon/folder') {
        const icon = this.folderIcon();
        if (icon === null) {
          res.writeHead(404).end('not found');
          return;
        }
        res.writeHead(200, { 'content-type': icon.type, 'cache-control': 'no-store' }).end(readFileSync(icon.path));
        return;
      }
      if (req.method === 'GET' && route === 'api/state') {
        this.json(res, {
          status: this.target.getStatus(),
          conflicts: this.target.listConflicts(),
          quarantine: this.target.listQuarantine(),
          recycle: this.target.listRecycle().filter((r) => r.kind === 'file'),
          roots: this.roots,
          locale: this.locale,
        });
        return;
      }
      if (req.method === 'POST' && route.startsWith('api/')) {
        const body = await readJson(req);
        await this.action(route.slice('api/'.length), body);
        this.json(res, { ok: true, status: this.target.getStatus() });
        return;
      }
      res.writeHead(404).end('not found');
    } catch (error) {
      this.json(res, { ok: false, error: error instanceof Error ? error.message : String(error) }, 400);
    }
  }

  private async action(name: string, body: Record<string, unknown>): Promise<void> {
    const num = (k: string): number => {
      const v = body[k];
      if (typeof v !== 'number') throw new Error(`${k} must be a number`);
      return v;
    };
    const str = (k: string): string => {
      const v = body[k];
      if (typeof v !== 'string') throw new Error(`${k} must be a string`);
      return v;
    };
    switch (name) {
      case 'pause':
        this.target.pause();
        return;
      case 'resume':
        this.target.resume();
        return;
      case 'sync':
        await this.target.syncNow();
        return;
      case 'confirm':
        await this.target.confirmHeldPlan(str('id'));
        return;
      case 'reject':
        this.target.rejectHeldPlan(str('id'));
        return;
      case 'resolve': {
        const choice = str('choice');
        if (choice !== 'keep_local' && choice !== 'keep_remote' && choice !== 'keep_both') throw new Error('invalid choice');
        await this.target.resolveConflict(num('id'), choice);
        return;
      }
      case 'release':
        this.target.releaseQuarantine(num('id'));
        return;
      default:
        throw new Error(`unknown action ${name}`);
    }
  }

  /** Read on every request so a theme switch shows up without restarting the engine. */
  private themeCss(): string {
    return omarchyThemeCss(readOmarchyTheme(this.themePath));
  }

  private folderIcon(): ThemeIcon | null {
    return resolveFolderIcon(dirname(this.themePath), this.iconRoots);
  }

  private json(res: ServerResponse, data: unknown, status = 200): void {
    res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify(data));
  }
}

function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let text = '';
    req.setEncoding('utf8');
    req.on('data', (c: string) => (text += c));
    req.on('end', () => {
      if (text.trim() === '') {
        resolve({});
        return;
      }
      try {
        const parsed: unknown = JSON.parse(text);
        resolve(typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {});
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
    req.on('error', reject);
  });
}

function renderPage(themeCss: string, icon: string): string {
  return `<!doctype html><html lang="en"${themeCss === '' ? '' : ' class="omarchy"'}><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Proton Drive Sync</title>
<style>
:root {
  --title-icon-h: 3.2rem;
  --title-icon-y: -0.53rem;
  --pds-mint: #cdfae4;
  --pds-lavender: #d0d8fc;
  --pds-ink: #2c3343;
  --pds-cyan: #2cd1ec;
  --pds-blue: #42aefc;
  --pds-line: #e4eaf3;
  --pds-muted: #5c6b80;
  --page-bg: linear-gradient(90deg, var(--pds-mint), var(--pds-lavender));
  --fg: var(--pds-ink);
  --muted: var(--pds-muted);
  --accent: var(--pds-blue);
  --heading: var(--pds-ink);
  --line: var(--pds-line);
  --divider: var(--pds-line);
  --state-fg: var(--pds-muted);
  --stat-label: var(--pds-muted);
  --ctl-bg: #fff;
  --btn-bg: var(--ctl-bg);
  --ctl-hover: #f3f7fc;
  --ctl-border: #c9d4e4;
  --ctl-off-border: #e1e7f0;
  --ctl-off-fg: #a9b4c4;
  --ctl-border-width: 1px;
  --ctl-hover-border: var(--ctl-border);
  --ctl-focus-bg: var(--ctl-hover);
  --ctl-focus-border: var(--accent);
  --ctl-pressed: #e8eef7;
  --ctl-normal-border-width: 1px;
  --ctl-selected-bg: var(--accent);
  --ctl-selected-border: var(--accent);
  --ctl-selected-border-width: 1px;
  --ctl-normal-border-left: 1px;
  --ctl-selected-border-right: 1px;
  --knob-on: #fff;
  --knob-off: #9aa8bb;
  --input-border: #d5deea;
  --primary-bg: var(--pds-cyan);
  --primary-fg: #07323a;
  --track: #e6eef8;
  --warn-bg: #fff8e8;
  --warn-border: transparent;
  --danger-bg: #ffe8ea;
  --danger-fg: #6d2430;
  --danger-border: transparent;
  --note-bg: #fff;
  --radius-box: 16px;
  --radius-pill: 999px;
  --font: ui-sans-serif, system-ui, sans-serif;
  --font-size: 15px;
}
/* Omarchy: the active theme's colors (--om-*, from colors.toml) in the shell's
   flat style: square corners, monospace, and the bar's control fills. */
html.omarchy {
  --page-bg: var(--om-background);
  --fg: var(--om-foreground);
  --muted: var(--om-light-foreground, color-mix(in srgb, var(--om-foreground) 65%, var(--om-background)));
  --accent: var(--om-accent);
  --heading: var(--om-accent);
  --line: color-mix(in srgb, var(--om-foreground) 12%, transparent);
  --divider: var(--om-muted, color-mix(in srgb, var(--om-foreground) 30%, var(--om-background)));
  /* The shell's dim text: Qt.darker(foreground, 1.4). */
  --state-fg: color-mix(in srgb, var(--om-foreground) 71%, black);
  /* The Wi-Fi panel's InfoLabel: foreground at 60% opacity. */
  --stat-label: color-mix(in srgb, var(--om-foreground) 60%, transparent);
  /* --ctl-* fills, borders and widths come from the theme's shell.toml [controls].
     Buttons are unfilled at rest, like the shell's bordered buttons. */
  --btn-bg: transparent;
  --knob-off: color-mix(in srgb, var(--om-foreground) 80%, black);
  --ctl-off-fg: color-mix(in srgb, var(--om-foreground) 35%, transparent);
  --input-border: var(--ctl-border);
  --primary-bg: var(--om-accent);
  --primary-fg: var(--om-background);
  --track: color-mix(in srgb, var(--om-foreground) 10%, transparent);
  --warn-bg: color-mix(in srgb, var(--om-yellow, var(--om-accent)) 10%, transparent);
  --warn-border: var(--om-yellow, var(--om-accent));
  --danger-bg: color-mix(in srgb, var(--om-red, var(--om-accent)) 14%, transparent);
  --danger-fg: var(--om-foreground);
  --danger-border: var(--om-red, var(--om-accent));
  --note-bg: color-mix(in srgb, var(--om-foreground) 8%, transparent);
  --radius-box: 0;
  --radius-pill: 0;
  --font: monospace;
  --font-size: 13px;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  min-height: 100vh;
  color: var(--fg);
  font: var(--font-size)/1.45 var(--font);
  background: var(--page-bg);
}
.wrap { max-width: 960px; margin: 0 auto; padding: 2rem 1.25rem 3rem; }
/* Header like a shell panel hero: folder icon, then the title with the engine
   state under it in the shell's caption style. text-box trims both lines to
   their capitals so the icon can be sized to span exactly from just above the
   title to the bottom of the state line. */
h1 { font-size: 1.6rem; margin: 0; letter-spacing: -0.02em; text-box: trim-both cap alphabetic; }
.title-block { display: flex; align-items: flex-start; gap: .55rem; min-width: 0; }
.title-icon { flex: none; height: var(--title-icon-h); width: auto; margin-top: var(--title-icon-y); }
.title-text { display: flex; flex-direction: column; gap: .65rem; }
.state { font-size: .833em; font-weight: 700; letter-spacing: 1.2px; text-transform: uppercase; color: var(--state-fg); line-height: 1; text-box: trim-both cap alphabetic; }
/* Sync on/off switch, drawn like the shell's ToggleSwitch: normal track when off,
   selected fill and knob when on, a hover ring around it, 120ms slide. */
.title-side { display: flex; align-items: center; gap: .9rem; }
.switch {
  position: relative; flex: none; width: 42px; height: 22px; padding: 0; cursor: pointer;
  border-style: solid; border-width: var(--ctl-normal-border-width); border-color: var(--ctl-border);
  background: var(--ctl-bg); border-radius: var(--radius-pill);
  transition: background-color 120ms, border-color 120ms;
}
.switch .knob {
  /* 3px from the track's outer edge, as in the shell; offsets are from inside the border. */
  position: absolute; top: 50%; left: calc(3px - var(--ctl-normal-border-left)); width: 16px; height: 16px; transform: translateY(-50%);
  background: var(--knob-off); border-radius: var(--radius-pill);
  transition: left 120ms cubic-bezier(.33, 1, .68, 1), background-color 120ms;
}
.switch[aria-checked="true"] { background: var(--ctl-selected-bg); border-color: var(--ctl-selected-border); border-width: var(--ctl-selected-border-width); }
.switch[aria-checked="true"] .knob { left: calc(100% - 19px + var(--ctl-selected-border-right)); background: var(--knob-on); }
.switch:hover { outline: 1px solid var(--ctl-hover-border); outline-offset: 5px; }
.switch:focus-visible { outline: 1px solid var(--accent); outline-offset: 5px; }
.title-row { display: flex; justify-content: space-between; align-items: center; gap: 1rem; margin: 0 0 .9rem; }
/* Section heading on the left, filter/pager on the right; the heading is trimmed to
   its cap height so the tops of its letters line up with the tops of the controls. */
.section-head { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: flex-start; gap: .6rem 1rem; margin: 0; }
h2 { font-size: 1.25rem; margin: 0; color: var(--heading); text-box: trim-both cap alphabetic; }
/* A section with nothing in it recedes so the ones with items stand out. */
section.empty h2 { opacity: .45; }
h2 { transition: opacity 120ms; }
/* No boxes: each section sits under a divider. */
main > section:not([hidden]) { margin-top: 1rem; padding-top: 1rem; border-top: 1px solid var(--divider); }
.status-row, .actions, .toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: .45rem .6rem; }
.btn, .note, .toolbar input { border-radius: var(--radius-pill); }
#glance { font-weight: 650; color: var(--accent); }
#reason, .pager, .empty, .muted, th { color: var(--muted); }
th { font-weight: 600; }
/* The progress/reason line and the flags take no room when they have nothing to say. */
.status-row:has(#glance:empty):has(#reason:empty), #flags:empty { display: none; }
#lines:not(:empty) { margin-top: .9rem; }
/* Stats laid out like the top of the shell's Wi-Fi panel: label/value pairs in
   two equal halves, labels dimmed, values right-aligned, small body size. */
.stats, .stats-wide { font-size: .917em; }
.stats { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); column-gap: 20px; }
.stats .half, .stats-wide { display: grid; grid-template-columns: auto minmax(0, 1fr); column-gap: 20px; row-gap: 4px; align-content: start; }
.stats-wide { margin-top: 4px; }
.stats .k, .stats-wide .k { color: var(--stat-label); white-space: nowrap; }
.stats .v, .stats-wide .v { text-align: right; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
/* A blank row: one line plus the row gap after it adds up to one full row. */
.stats .gap { grid-column: 1 / -1; height: calc(1lh - 4px); }
@media (max-width: 560px) { .stats { grid-template-columns: minmax(0, 1fr); row-gap: 4px; } }
.btn {
  /* Longhands: the reserved width can be a per-side list, which the border shorthand rejects. */
  border-style: solid;
  border-width: var(--ctl-border-width);
  border-color: var(--ctl-border);
  background: var(--btn-bg);
  color: var(--fg);
  font: inherit;
  padding: .4rem .9rem;
  cursor: pointer;
}
/* Control states in the shell's order: pressed, then focus, then hover, each fading over 120ms. */
.btn, .toolbar input { transition: background-color 120ms, border-color 120ms; }
.btn:hover:not(:disabled), .toolbar input:hover:not(:disabled) { background: var(--ctl-hover); border-color: var(--ctl-hover-border); }
.btn:focus-visible:not(:disabled), .toolbar input:focus:not(:disabled) { background: var(--ctl-focus-bg); border-color: var(--ctl-focus-border); }
.btn:active:not(:disabled) { background: var(--ctl-pressed); }
/* An accent outline on top of the theme's focus state keeps keyboard focus easy to see. */
.btn:focus-visible { outline: 1px solid var(--accent); outline-offset: 1px; }
.btn.primary { background: var(--primary-bg); border-color: var(--primary-bg); color: var(--primary-fg); font-weight: 650; }
.btn.primary:hover:not(:disabled), .btn.primary:active:not(:disabled), .btn.primary:focus-visible { background: var(--primary-bg); border-color: var(--primary-bg); filter: brightness(1.08); }
/* Disabled controls drop the fill and fade the border and text, so they read as off next to live ones. */
.btn:disabled, .toolbar input:disabled { background: transparent; border-color: var(--ctl-off-border); color: var(--ctl-off-fg); cursor: default; }
/* Spacing lives on what follows the heading row, so an empty section ends at its controls. */
.pager { margin: .7rem 0 0; text-align: right; }
.toolbar { margin: 0; }
.toolbar input { border-style: solid; border-width: var(--ctl-border-width); border-color: var(--input-border); padding: .4rem .9rem; min-width: 12rem; color: var(--fg); background: var(--ctl-bg); font: inherit; }
.scroll { overflow-x: auto; }
.scroll:not(:empty) { margin-top: .5rem; }
table { border-collapse: collapse; width: 100%; }
td, th { text-align: left; padding: .45rem .5rem; border-bottom: 1px solid var(--line); vertical-align: top; }
/* Outer cells sit flush so table text lines up with headings and inputs. */
td:first-child, th:first-child { padding-left: 0; }
td:last-child, th:last-child { padding-right: 0; }
.bar { height: 8px; background: var(--track); border-radius: var(--radius-pill); min-width: 6rem; }
.bar > div { height: 8px; background: var(--accent); border-radius: var(--radius-pill); }
.warn { background: var(--warn-bg); border: 1px solid var(--warn-border); border-radius: var(--radius-box); padding: .8rem 1rem; }
.banner { background: var(--danger-bg); color: var(--danger-fg); border: 1px solid var(--danger-border); border-radius: var(--radius-box); padding: .65rem 1rem; margin: 1rem 0 0; }
.note { display: inline-block; background: var(--note-bg); padding: .15rem .65rem; }
pre { white-space: pre-wrap; word-break: break-word; margin: .4rem 0 0; font-size: .85rem; }
[hidden] { display: none !important; }
</style>
<style id="omarchy-theme">${themeCss}</style></head><body>
<main class="wrap">
<header>
<div class="title-row"><div class="title-block"><img class="title-icon" id="title-icon" src="icon/folder" alt="" data-icon="${encodeURIComponent(icon)}"${icon === '' ? ' hidden' : ''}><div class="title-text"><h1>Proton Drive Sync</h1><span class="state" id="state"></span></div></div><div class="title-side"><button type="button" role="switch" class="switch" id="sync-toggle" aria-checked="true" aria-label="Sync"><span class="knob"></span></button></div></div>
<p class="status-row"><span id="glance"></span><span id="reason"></span></p>
<p id="flags"></p>
<p class="actions"><button type="button" class="btn" id="act-sync" onclick="act('sync')">Sync now</button></p>
<div id="lines"></div>
</header>
<p id="action-error" class="banner" hidden></p>
<section id="held" hidden></section>
<section id="conflicts"></section>
<section id="quarantine"></section>
<section id="transfers"></section>
<section id="proton-documents"></section>
<section id="recycle"></section>
</main>
<script>
${clientScript()}
</script></body></html>`;
}
