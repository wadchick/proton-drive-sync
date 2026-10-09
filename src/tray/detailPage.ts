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
import { packageVersion } from '../version.js';
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
          // The package version of the engine process serving this page, shown in the stats.
          version: packageVersion(),
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

/** Two arrows chasing round a circle: the Sync now icon, drawn like the conflict resolve icons. */
const SYNC_ICON = '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M13.5 6.5A5.5 5.5 0 0 0 3.4 4.3"/><path d="M2.5 9.5a5.5 5.5 0 0 0 10.1 2.2"/><path d="M3 1.6v2.9h2.9"/><path d="M13 14.4v-2.9h-2.9"/></svg>';

/** The details page document without the theme or folder icon. A null version omits the version line. */
export function detailDocument(): string {
  return renderPage('', '');
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
  --pds-card: #fcfdfe;
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
  /* The state line's warning and error tones: amber and red that read on white. */
  --status-warn: #9a5b00;
  --status-danger: #c0262d;
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
  /* The state line's warning and error tones: the theme's yellow and red. */
  --status-warn: var(--om-yellow, var(--om-accent));
  --status-danger: var(--om-red, var(--om-accent));
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
.title-text { display: flex; flex-direction: column; gap: .65rem; min-width: 0; }
.state { font-size: .833em; font-weight: 700; letter-spacing: 1.2px; text-transform: uppercase; color: var(--state-fg); line-height: 1; text-box: trim-both cap alphabetic; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
/* The state line alternates between the state and its details, fading out and back in like
   the Wi-Fi panel's caption; warnings and errors take their own colours. */
.state { transition: opacity 260ms ease-in; }
.state.fading { opacity: 0; transition: opacity 180ms ease-out; }
@media (prefers-reduced-motion: reduce) { .state, .state.fading { transition: none; } }
.state[data-tone="warn"] { color: var(--status-warn); }
.state[data-tone="danger"] { color: var(--status-danger); }
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
/* The section heading row; the heading is trimmed to its cap height so spacing is
   measured from the letters, not the line box. */
.section-head { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: flex-start; gap: .6rem 1rem; margin: 0; }
h2 { font-size: 1.05rem; margin: 0; color: var(--heading); text-transform: uppercase; text-box: trim-both cap alphabetic; }
/* Without a theme, the header and each section are white cards on the gradient. */
html:not(.omarchy) header, html:not(.omarchy) main > section:not([hidden]) {
  background: var(--pds-card); border-radius: 20px; padding: 1rem 1.15rem; box-shadow: 0 10px 30px rgba(44, 51, 67, 0.08);
}
html:not(.omarchy) main > section:not([hidden]) { margin-top: .9rem; }
/* The held plan's warning box is its card, rather than a box inside a white card. */
html:not(.omarchy) main > section#held { background: none; padding: 0; box-shadow: none; }
/* Proceed and Reject: flush right on the held plan's filter row. */
.held-actions { margin-left: auto; }
html:not(.omarchy) #held > .warn { border-radius: 20px; padding: 1rem 1.15rem; box-shadow: 0 10px 30px rgba(44, 51, 67, 0.08); }
/* Omarchy, like the shell's panels: no boxes, each section sits under a divider. */
html.omarchy main > section:not([hidden]) { margin-top: 1rem; padding-top: 1rem; border-top: 1px solid var(--divider); }
.actions, .toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: .45rem .6rem; }
.btn, .toolbar input { border-radius: var(--radius-pill); }
.empty, .muted { color: var(--muted); }
#lines:not(:empty) { margin-top: .9rem; }
/* Stats laid out like the top of the shell's Wi-Fi panel: label/value pairs in
   two equal halves, labels dimmed, values right-aligned, small body size. */
.stats { font-size: .917em; }
.stats { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); column-gap: 40px; }
.stats .half { display: grid; grid-template-columns: auto minmax(0, 1fr); column-gap: 20px; row-gap: 4px; align-content: start; }
.stats .k { color: var(--stat-label); white-space: nowrap; }
.stats .v { text-align: right; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
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
/* A section's body: a line saying what it holds, then the controls on the right
   with the range under them, then the list. */
.intro { margin: .7rem 0 0; font-size: .917em; color: var(--stat-label); }
.section-body .toolbar, .warn .toolbar { justify-content: flex-start; margin-top: .6rem; }
/* Under a table: the item range on the left, Previous/Next on the right as link text. */
.table-foot { display: flex; justify-content: space-between; align-items: baseline; gap: 1rem; margin-top: .5rem; }
.pager { margin: 0; white-space: nowrap; }
/* The range reads like the table's column headers: same dimmed colour and weight. */
.pager, th { font-weight: 600; color: var(--stat-label); }
.pages { display: flex; gap: 1.25rem; white-space: nowrap; }
.link { all: unset; cursor: pointer; color: var(--accent); }
.link:hover:not(:disabled) { text-decoration: underline; }
.link:focus-visible { outline: 1px solid var(--accent); outline-offset: 2px; }
.link:disabled { color: var(--ctl-off-fg); cursor: default; }
.toolbar { margin: 0; }
.toolbar input { border-style: solid; border-width: var(--ctl-border-width); border-color: var(--input-border); padding: .4rem .9rem .4rem 2.1rem; min-width: 12rem; color: var(--fg); background: var(--ctl-bg); font: inherit; }
/* The magnifier sits inside the filter box on the left; the placeholder is the foreground
   at 58%, like the shell's search fields. */
.search { position: relative; display: inline-flex; align-items: center; }
.search svg { position: absolute; left: .7rem; width: 14px; height: 14px; color: var(--fg); opacity: .58; pointer-events: none; }
.toolbar input::placeholder { color: var(--fg); opacity: .58; }
.scroll { overflow-x: auto; }
.scroll:not(:empty) { margin-top: .5rem; }
table { border-collapse: collapse; width: 100%; }
td, th { text-align: left; padding: .45rem .5rem; border-bottom: 1px solid var(--line); vertical-align: top; }
/* Table helpers: a cell that takes the leftover width (max-width: 0 lets it shrink), text
   truncated at the start so a path keeps its file name, cells that never wrap, and a
   smaller second line. */
td.fill { width: 100%; max-width: 0; }
.trunc-start { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; direction: rtl; text-align: left; }
.trunc-start bdi { direction: ltr; unicode-bidi: isolate; }
.nowrap { white-space: nowrap; }
.sub { font-size: .85em; color: var(--stat-label); }
/* Icon buttons follow the shell's plain Button (the Wi-Fi panel's QR code and speed test):
   no fill or border at rest, the theme's hover/pressed states, an 18px icon (the shell's
   subtitle size x 1.5). Padding is an even 5px so the hover box sits square around the icon.
   The border keeps its width so nothing shifts. */
.btn.icon { display: inline-flex; align-items: center; justify-content: center; padding: 5px; background: transparent; border-color: transparent; }
.btn.icon svg { width: 18px; height: 18px; }
.btn.icon:disabled { border-color: transparent; }
/* Sync now as the call to action: filled like the other primary buttons. Without the fill its
   icon, drawn in the primary text colour, would vanish against a dark theme's background. */
.btn.icon.primary { background: var(--primary-bg); border-color: var(--primary-bg); color: var(--primary-fg); }
/* Action buttons sit in the middle of their row rather than at the top. */
td.actions-cell { vertical-align: middle; }
.actions-cell .btn + .btn { margin-left: .35rem; }
/* A lone row action (Dismiss, Release) sits flush right in its column. */
td.actions-cell.end { text-align: right; }
/* Outer cells sit flush so table text lines up with headings and inputs. */
td:first-child, th:first-child { padding-left: 0; }
td:last-child, th:last-child { padding-right: 0; }
.bar { height: 8px; background: var(--track); border-radius: var(--radius-pill); min-width: 6rem; }
.bar > div { height: 8px; background: var(--accent); border-radius: var(--radius-pill); }
.warn { background: var(--warn-bg); border: 1px solid var(--warn-border); border-radius: var(--radius-box); padding: .8rem 1rem; }
.banner { background: var(--danger-bg); color: var(--danger-fg); border: 1px solid var(--danger-border); border-radius: var(--radius-box); padding: .65rem 1rem; margin: 1rem 0 0; }
/* Lost connection: the notice leads the page and the data that may be stale dims. */
#connection-lost { margin: 0 0 1.25rem; }
body.stale .title-row, body.stale .actions, body.stale #lines, body.stale main > section { opacity: .45; }
pre { white-space: pre-wrap; word-break: break-word; margin: .4rem 0 0; font-size: .85rem; }
[hidden] { display: none !important; }
</style>
<style id="omarchy-theme">${themeCss}</style></head><body>
<main class="wrap">
<p id="connection-lost" class="banner" role="alert" hidden>Lost connection to Proton Drive Sync, so the details below may be out of date. Reopen this page from the Proton Drive panel.</p>
<header>
<div class="title-row"><div class="title-block"><img class="title-icon" id="title-icon" src="icon/folder" alt="" data-icon="${encodeURIComponent(icon)}"${icon === '' ? ' hidden' : ''}><div class="title-text"><h1>Proton Drive Sync</h1><span class="state" id="state"></span></div></div><div class="title-side"><button type="button" class="btn icon" id="act-sync" onclick="act('sync')" title="Sync now" aria-label="Sync now">${SYNC_ICON}</button><button type="button" role="switch" class="switch" id="sync-toggle" aria-checked="true" aria-label="Sync"><span class="knob"></span></button></div></div>
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
