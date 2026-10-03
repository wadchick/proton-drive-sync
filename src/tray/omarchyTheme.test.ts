import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { omarchyColorsPath, omarchyThemeCss, parseOmarchyColors, parseShellControls, readOmarchyTheme, resolveFolderIcon } from './omarchyTheme.js';

const NORD = `mode = "dark"

accent = "#81a1c1"
muted = "#4c566a"
background = "#2E3440"
foreground = "#d8dee9"
light_foreground = "#adb5c4"
red = "#bf616a"
`;

let dir: string | null = null;
afterEach(() => {
  if (dir !== null) rmSync(dir, { recursive: true, force: true });
  dir = null;
});

describe('omarchy theme', () => {
  it('finds colors.toml under XDG_STATE_HOME, else ~/.local/state', () => {
    expect(omarchyColorsPath({ XDG_STATE_HOME: '/s', HOME: '/h' })).toBe('/s/omarchy/current/theme/colors.toml');
    expect(omarchyColorsPath({ HOME: '/h' })).toBe('/h/.local/state/omarchy/current/theme/colors.toml');
  });

  it('parses the palette and mode into CSS variables', () => {
    const theme = parseOmarchyColors(NORD);
    expect(theme?.mode).toBe('dark');
    expect(theme?.colors['background']).toBe('#2e3440');
    const css = omarchyThemeCss(theme);
    expect(css).toContain('color-scheme: dark;');
    expect(css).toContain('--om-background: #2e3440;');
    expect(css).toContain('--om-light-foreground: #adb5c4;');
  });

  it('reads light themes', () => {
    expect(parseOmarchyColors(NORD.replace('"dark"', '"light"'))?.mode).toBe('light');
  });

  it('needs background, foreground and accent', () => {
    expect(parseOmarchyColors(NORD.replace(/^accent.*$/m, ''))).toBeNull();
    expect(omarchyThemeCss(null)).toBe('');
  });

  it('only lets plain hex colors into the stylesheet', () => {
    const theme = parseOmarchyColors(`${NORD}cyan = "#88c0d0; } body { display: none"\nblue = "red"\nyellow = "#ebcb8b"\n`);
    const css = omarchyThemeCss(theme);
    expect(css).not.toContain('display');
    expect(css).not.toContain('--om-blue');
    expect(css).not.toContain('--om-cyan');
    expect(css).toContain('--om-yellow: #ebcb8b;');
  });

  it('returns null for a missing file', () => {
    dir = mkdtempSync(join(tmpdir(), 'pds-theme-'));
    expect(readOmarchyTheme(join(dir, 'colors.toml'))).toBeNull();
    writeFileSync(join(dir, 'colors.toml'), NORD);
    expect(readOmarchyTheme(join(dir, 'colors.toml'))?.colors['accent']).toBe('#81a1c1');
  });

  it('reads the [controls] table of shell.toml and drops what it cannot use', () => {
    const controls = parseShellControls(`[bar]
normal-fill-alpha = 0.9

[controls]
normal-color        = "accent"
normal-fill-alpha   = 0.1
normal-border       = "#ABCDEF"
normal-border-width = 2
normal-border-alpha = 1.5
hover-cursor-border = "rgba(1,2,3,1) rgba(4,5,6,1) 45deg"
hover-cursor-border-width = "1 2"
focus-border = "hyprland.active-border"
selected-color = "red; } body { display: none"

[spacing]
scale = 1.0
`);
    expect(controls).toEqual({
      'normal-color': 'accent',
      'normal-fill-alpha': 0.1,
      'normal-border': '#abcdef',
      'normal-border-width': '2',
      'normal-border-alpha': 1,
      'hover-cursor-border-width': '1 2',
    });
  });

  it('turns control tokens into state variables, with the shell defaults for the rest', () => {
    const theme = parseOmarchyColors(NORD);
    if (theme === null) throw new Error('theme');
    const defaults = omarchyThemeCss(theme);
    expect(defaults).toContain('--ctl-bg: color-mix(in srgb, var(--om-foreground) 4%, transparent);');
    expect(defaults).toContain('--ctl-border: color-mix(in srgb, var(--om-foreground) 40%, transparent);');
    expect(defaults).toContain('--ctl-hover-border: color-mix(in srgb, var(--om-foreground) 25%, transparent);');
    expect(defaults).toContain('--ctl-pressed: color-mix(in srgb, var(--om-foreground) 22%, transparent);');
    // Switch on state: selected fill, no selected border by default, knob in the selected color.
    expect(defaults).toContain('--ctl-selected-bg: color-mix(in srgb, var(--om-foreground) 18%, transparent);');
    expect(defaults).toContain('--ctl-selected-border: transparent;');
    expect(defaults).toContain('--knob-on: var(--om-foreground);');
    theme.controls = { 'normal-color': 'accent', 'normal-fill-alpha': 0.1, 'normal-border': '#abcdef', 'normal-border-width': '2', 'normal-border-alpha': 0.6, 'hover-cursor-border-width': '1 2' };
    const css = omarchyThemeCss(theme);
    expect(css).toContain('--ctl-bg: color-mix(in srgb, var(--om-accent) 10%, transparent);');
    expect(css).toContain('--ctl-border: color-mix(in srgb, #abcdef 60%, transparent);');
    // Widest border of any state, per side: normal 2 everywhere, hover "1 2" (2 on the sides).
    expect(css).toContain('--ctl-border-width: 2px 2px 2px 2px;');
    expect(css).not.toContain('--ctl-hover-border-width');
    expect(css).toContain('--ctl-off-border: color-mix(in srgb, #abcdef 20%, transparent);');
  });

  it('reserves the widest state border and paints none for a borderless state', () => {
    const theme = parseOmarchyColors(NORD);
    if (theme === null) throw new Error('theme');
    theme.controls = { 'normal-border-width': '0', 'hover-cursor-border-width': '1 3' };
    const css = omarchyThemeCss(theme);
    expect(css).toContain('--ctl-border-width: 1px 3px 1px 3px;');
    expect(css).toContain('--ctl-border: transparent;');
    expect(css).toContain('--ctl-hover-border: color-mix(in srgb, var(--om-foreground) 25%, transparent);');
  });

  it('picks up shell.toml beside colors.toml', () => {
    dir = mkdtempSync(join(tmpdir(), 'pds-theme-'));
    writeFileSync(join(dir, 'colors.toml'), NORD);
    expect(readOmarchyTheme(join(dir, 'colors.toml'))?.controls).toEqual({});
    writeFileSync(join(dir, 'shell.toml'), '[controls]\nnormal-fill-alpha = 0.2\n');
    expect(readOmarchyTheme(join(dir, 'colors.toml'))?.controls).toEqual({ 'normal-fill-alpha': 0.2 });
  });

  it('finds the folder icon of the theme\'s icon set, following Inherits, then Adwaita', () => {
    dir = mkdtempSync(join(tmpdir(), 'pds-icons-'));
    const theme = join(dir, 'theme');
    const icons = join(dir, 'icons');
    const put = (rel: string, body = 'x'): void => {
      mkdirSync(join(icons, rel, '..'), { recursive: true });
      writeFileSync(join(icons, rel), body);
    };
    mkdirSync(theme);
    // No icons.theme and no Adwaita: nothing to show.
    expect(resolveFolderIcon(theme, [icons])).toBeNull();
    put('Adwaita/scalable/places/folder.svg');
    expect(resolveFolderIcon(theme, [icons])).toEqual({ path: join(icons, 'Adwaita/scalable/places/folder.svg'), type: 'image/svg+xml' });
    // The theme's set has no folder itself but inherits one.
    writeFileSync(join(theme, 'icons.theme'), 'Yaru-blue\n');
    put('Yaru-blue/index.theme', '[Icon Theme]\nInherits=Yaru,hicolor\n');
    put('Yaru/48x48/places/folder.png');
    put('Yaru/48x48@2x/places/folder.png');
    expect(resolveFolderIcon(theme, [icons])).toEqual({ path: join(icons, 'Yaru/48x48@2x/places/folder.png'), type: 'image/png' });
    put('Yaru-blue/48x48/places/folder.png');
    expect(resolveFolderIcon(theme, [icons])?.path).toBe(join(icons, 'Yaru-blue/48x48/places/folder.png'));
  });

  it('ignores an icon theme name that is not a plain name', () => {
    dir = mkdtempSync(join(tmpdir(), 'pds-icons-'));
    mkdirSync(join(dir, 'icons', 'evil', 'scalable', 'places'), { recursive: true });
    writeFileSync(join(dir, 'icons', 'evil', 'scalable', 'places', 'folder.svg'), 'x');
    mkdirSync(join(dir, 'theme'));
    writeFileSync(join(dir, 'theme', 'icons.theme'), '../icons/evil');
    expect(resolveFolderIcon(join(dir, 'theme'), [join(dir, 'icons')])).toBeNull();
  });
});
