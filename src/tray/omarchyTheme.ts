/**
 * Omarchy theme for the detail page. Omarchy writes the active theme's palette
 * to $XDG_STATE_HOME/omarchy/current/theme/colors.toml on every theme switch,
 * and its shell control tokens ([controls] in shell.toml) beside it; the page
 * reads both so it matches the bar and the rest of the desktop. Off Omarchy
 * (no colors.toml) the page keeps its own palette.
 */
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export interface OmarchyTheme {
  mode: 'dark' | 'light';
  colors: Record<string, string>;
  /** Validated [controls] values from shell.toml, keyed as in the file. */
  controls: Record<string, string | number>;
}

const REQUIRED = ['background', 'foreground', 'accent'] as const;
// Only plain hex colors reach the stylesheet, so a theme file cannot inject CSS.
const ENTRY = /^\s*([a-z_]+)\s*=\s*"(#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8}))"\s*$/;
const MODE = /^\s*mode\s*=\s*"(dark|light)"\s*$/;

export function omarchyColorsPath(env: NodeJS.ProcessEnv = process.env): string {
  const xdg = env['XDG_STATE_HOME'];
  const state = xdg !== undefined && xdg !== '' ? xdg : join(env['HOME'] ?? homedir(), '.local', 'state');
  return join(state, 'omarchy', 'current', 'theme', 'colors.toml');
}

export function parseOmarchyColors(text: string): OmarchyTheme | null {
  const colors: Record<string, string> = {};
  let mode: OmarchyTheme['mode'] = 'dark';
  for (const line of text.split('\n')) {
    const entry = ENTRY.exec(line);
    if (entry !== null) {
      colors[entry[1] ?? ''] = (entry[2] ?? '').toLowerCase();
      continue;
    }
    const m = MODE.exec(line);
    if (m !== null) mode = m[1] === 'light' ? 'light' : 'dark';
  }
  return REQUIRED.every((key) => key in colors) ? { mode, colors, controls: {} } : null;
}

// Control colors are a role the shell resolves (as in its Style.qml) or a hex color.
const ROLES = ['foreground', 'text', 'accent', 'urgent', 'background', 'transparent'];
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/;
const WIDTHS = /^\d{1,2}(?: \d{1,2}){0,3}$/;
const CONTROL_LINE = /^\s*([a-z-]+)\s*=\s*(?:"([^"]*)"|([0-9.]+))\s*(?:#.*)?$/;

/**
 * The [controls] table of shell.toml, keeping only values the page can use
 * safely: role or hex colors, alphas in 0..1 and pixel widths. Anything else
 * (gradients, references to other tokens) is dropped and the default applies.
 */
export function parseShellControls(text: string): Record<string, string | number> {
  const controls: Record<string, string | number> = {};
  let inControls = false;
  for (const line of text.split('\n')) {
    const section = /^\s*\[([^\]]+)\]/.exec(line);
    if (section !== null) {
      inControls = section[1]?.trim() === 'controls';
      continue;
    }
    if (!inControls) continue;
    const entry = CONTROL_LINE.exec(line);
    if (entry === null) continue;
    const key = entry[1] ?? '';
    const raw = (entry[2] ?? entry[3] ?? '').trim().toLowerCase();
    if (key.endsWith('-alpha')) {
      const n = Number(raw);
      if (raw !== '' && Number.isFinite(n)) controls[key] = Math.min(1, Math.max(0, n));
    } else if (key.endsWith('-border-width')) {
      if (WIDTHS.test(raw)) controls[key] = raw;
    } else if (key.endsWith('-color') || key.endsWith('-border')) {
      if (ROLES.includes(raw) || HEX.test(raw)) controls[key] = raw;
    }
  }
  return controls;
}

export function readOmarchyTheme(path: string): OmarchyTheme | null {
  let theme: OmarchyTheme | null;
  try {
    theme = parseOmarchyColors(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
  if (theme === null) return null;
  try {
    theme.controls = parseShellControls(readFileSync(join(dirname(path), 'shell.toml'), 'utf8'));
  } catch {
    // No shell.toml: the shell's default control tokens apply.
  }
  return theme;
}

function roleColor(value: string): string {
  if (HEX.test(value)) return value;
  if (value === 'accent') return 'var(--om-accent)';
  if (value === 'urgent') return 'var(--om-red, var(--om-accent))';
  if (value === 'background') return 'var(--om-background)';
  if (value === 'transparent') return 'transparent';
  return 'var(--om-foreground)';
}

function tint(color: string, alpha: number): string {
  if (color === 'transparent' || alpha <= 0) return 'transparent';
  return `color-mix(in srgb, ${color} ${String(Math.round(alpha * 1000) / 10)}%, transparent)`;
}

/** CSS shorthand widths ("N", "Y X", "T X B", "T R B L") as [top, right, bottom, left]. */
function sides(widths: string): [number, number, number, number] {
  const n = widths.split(' ').map(Number);
  const [t = 0, r = t, b = t, l = r] = n;
  return [t, r, b, l];
}

/** CSS variables for the control states, with the shell's defaults for anything the theme leaves out. */
function controlVars(c: Record<string, string | number>): string {
  const str = (key: string, fallback: string): string => (typeof c[key] === 'string' ? c[key] : fallback);
  const num = (key: string, fallback: number): number => (typeof c[key] === 'number' ? c[key] : fallback);
  const normalColor = str('normal-color', 'foreground');
  const hoverColor = str('hover-cursor-color', 'foreground');
  const normalBorder = str('normal-border', normalColor);
  const hoverBorder = str('hover-cursor-border', hoverColor);
  const normalBorderAlpha = num('normal-border-alpha', 0.4);
  const hoverFill = num('hover-cursor-fill-alpha', 0.08);
  const hoverBorderAlpha = num('hover-cursor-border-alpha', 0.25);
  const widths = {
    normal: sides(str('normal-border-width', '1')),
    hover: sides(str('hover-cursor-border-width', '1')),
    focus: sides(str('focus-border-width', str('hover-cursor-border-width', '1'))),
    selected: sides(str('selected-border-width', '0')),
  };
  // Like the shell, reserve the widest border any state paints so a control
  // never shifts as it changes state; a state with no border paints none.
  const reserved = [0, 1, 2, 3].map((i) => Math.max(widths.normal[i] ?? 0, widths.hover[i] ?? 0, widths.focus[i] ?? 0));
  const border = (state: keyof typeof widths, color: string, alpha: number): string =>
    widths[state].every((w) => w === 0) ? 'transparent' : tint(roleColor(color), alpha);
  const pxList = (w: number[]): string => w.map((n) => `${String(n)}px`).join(' ');
  const selectedColor = str('selected-color', 'foreground');
  return [
    `--ctl-bg: ${tint(roleColor(normalColor), num('normal-fill-alpha', 0.04))};`,
    `--ctl-border: ${border('normal', normalBorder, normalBorderAlpha)};`,
    `--ctl-border-width: ${pxList(reserved)};`,
    `--ctl-normal-border-width: ${pxList(widths.normal)};`,
    // The switch knob is inset from the track's outer edge, so it needs the side widths.
    `--ctl-normal-border-left: ${String(widths.normal[3])}px;`,
    `--ctl-hover: ${tint(roleColor(hoverColor), hoverFill)};`,
    `--ctl-hover-border: ${border('hover', hoverBorder, hoverBorderAlpha)};`,
    // Focus mirrors hover unless the theme sets it, as in the shell.
    `--ctl-focus-bg: ${tint(roleColor(str('focus-color', hoverColor)), num('focus-fill-alpha', hoverFill))};`,
    `--ctl-focus-border: ${border('focus', str('focus-border', hoverBorder), num('focus-border-alpha', hoverBorderAlpha))};`,
    `--ctl-pressed: ${tint(roleColor(str('pressed-color', hoverColor)), num('pressed-fill-alpha', 0.22))};`,
    // Selected: the on state of a toggle switch (track fill and border, knob color).
    `--ctl-selected-bg: ${tint(roleColor(selectedColor), num('selected-fill-alpha', 0.18))};`,
    `--ctl-selected-border: ${border('selected', str('selected-border', selectedColor), num('selected-border-alpha', 1))};`,
    `--ctl-selected-border-width: ${pxList(widths.selected)};`,
    `--ctl-selected-border-right: ${String(widths.selected[1])}px;`,
    `--knob-on: ${roleColor(selectedColor)};`,
    // The shell has no disabled token: a third of the normal border marks a control as off.
    `--ctl-off-border: ${tint(roleColor(normalBorder), normalBorderAlpha / 3)};`,
  ].join(' ');
}

/** The stylesheet that switches the page to the theme; empty when there is none. */
export function omarchyThemeCss(theme: OmarchyTheme | null): string {
  if (theme === null) return '';
  const vars = Object.entries(theme.colors)
    .map(([key, value]) => `--om-${key.replace(/_/g, '-')}: ${value};`)
    .join(' ');
  return `:root { color-scheme: ${theme.mode}; ${vars} } html.omarchy { ${controlVars(theme.controls)} }`;
}

export interface ThemeIcon {
  path: string;
  type: 'image/svg+xml' | 'image/png';
}

// Sizes to try, best first: scalable, then PNGs that stay sharp at title size on hi-dpi.
const FOLDER_CANDIDATES = [
  'scalable/places/folder.svg',
  '48x48@2x/places/folder.png',
  '96x96/places/folder.png',
  '64x64@2x/places/folder.png',
  '256x256/places/folder.png',
  '64x64/places/folder.png',
  '48x48/places/folder.png',
];
const ICON_THEME_NAME = /^[A-Za-z0-9][A-Za-z0-9._+-]*$/;

export function defaultIconRoots(env: NodeJS.ProcessEnv = process.env): string[] {
  const data = env['XDG_DATA_HOME'];
  const home = env['HOME'] ?? homedir();
  return [data !== undefined && data !== '' ? join(data, 'icons') : join(home, '.local', 'share', 'icons'), join(home, '.icons'), '/usr/share/icons'];
}

/**
 * The folder icon Nautilus shows: `folder` from the icon theme Omarchy set
 * for the current theme (icons.theme beside colors.toml), following each
 * theme's Inherits= chain, then Adwaita and hicolor. Null when none is found.
 */
export function resolveFolderIcon(themeDir: string, roots: string[] = defaultIconRoots()): ThemeIcon | null {
  let first = '';
  try {
    first = readFileSync(join(themeDir, 'icons.theme'), 'utf8').trim();
  } catch {
    // No icons.theme: fall through to the defaults.
  }
  const queue = [first, 'Adwaita', 'hicolor'].filter((name) => ICON_THEME_NAME.test(name));
  const seen = new Set<string>();
  while (queue.length > 0) {
    const name = queue.shift() ?? '';
    if (seen.has(name)) continue;
    seen.add(name);
    for (const root of roots) {
      for (const rel of FOLDER_CANDIDATES) {
        const path = join(root, name, rel);
        if (existsSync(path)) return { path, type: rel.endsWith('.svg') ? 'image/svg+xml' : 'image/png' };
      }
    }
    for (const root of roots) {
      try {
        const inherits = /^Inherits\s*=\s*(.+)$/m.exec(readFileSync(join(root, name, 'index.theme'), 'utf8'));
        if (inherits?.[1] !== undefined) {
          const parents = inherits[1].split(',').map((p) => p.trim()).filter((p) => ICON_THEME_NAME.test(p));
          queue.splice(0, 0, ...parents);
          break;
        }
      } catch {
        // Theme not under this root.
      }
    }
  }
  return null;
}
