# Design

## Context

See proposal.md for why. The details page is one HTML document from `renderPage()` in `src/tray/detailPage.ts`, served by `DetailPageServer` on 127.0.0.1 behind the run token. The in-page script is `clientScript()` in `src/tray/detailView.ts`: the tested `applySnapshot()` renderer plus a loop that fetches `/api/state` every 2 seconds. Before this change the page had one palette (the preview card's), wrote the human status lines into the header, showed conflict records as JSON, printed `none` in an empty section, and wrote `Version <x>` under the title from the server.

Omarchy writes the active theme to `$XDG_STATE_HOME/omarchy/current/theme/` on every switch: `colors.toml` (the palette and `mode`), `shell.toml` (the shell's `[controls]` tokens), and `icons.theme` (the icon set's name). The shell's panels draw from those files. The engine process that serves the page runs as the user, so it can read them.

## Goals / Non-Goals

**Goals:**

- On Omarchy, the page looks like the shell's panels and follows theme switches live.
- Off Omarchy, the page keeps the preview-card look.
- The same facts as before, in a form that can be scanned: stats as label and value pairs, dates in the system format, conflicts in plain words.
- No change to the POST actions, the engine's sync rules, the tray menu, the bar, or CLI wording.

**Non-Goals:**

- Theming the tray menu or the bar panel (the panel already follows the shell).
- Supporting desktop themes other than Omarchy's.
- Changing what a conflict resolution does. Dismiss is a new label for `keep_both`, not a new action.
- Loading fonts, scripts, or stylesheets from anywhere but the page itself.

## Decisions

1. **Read the theme on every request, and let an open page poll for it.** `readOmarchyTheme()` in `src/tray/omarchyTheme.ts` reads `colors.toml` and `shell.toml` when the page or `GET api/theme` is requested. `omarchyThemeCss()` turns them into CSS variables (`--om-*` for the palette, `--ctl-*` for control states). The page carries that CSS in `<style id="omarchy-theme">` and puts `class="omarchy"` on `<html>` when the CSS is non-empty. The client polls `api/theme` every 2 seconds, alongside `api/state`, and swaps the style and the class when they change.

   Alternative: watch the theme directory and push changes. Rejected because the page has no push channel, and the poll is the same request pattern the state refresh already uses.

2. **Only validated values reach the stylesheet.** `colors.toml` entries must be plain hex colors, and the file must define `background`, `foreground`, and `accent`, or there is no theme. `[controls]` values must be a shell color role, a hex color, an alpha from 0 to 1, or one to four pixel widths. Anything else (a gradient, a reference to another token) is dropped and the shell's default applies. A numeric alpha outside 0 to 1 is clamped to that range rather than dropped, so `1.5` paints at full strength. A theme file cannot inject CSS.

3. **One stylesheet, two looks, switched by the class.** The base `:root` variables are the preview-card palette. `html.omarchy` redefines them from the theme's variables, with square corners and a monospace font. Card styles apply under `html:not(.omarchy)` and dividers under `html.omarchy`, so a theme switch flips the layout with the class and no re-render.

   Alternative: two stylesheets served separately. Rejected because a live switch would then have to swap whole stylesheets, and the rules the looks share would be duplicated.

4. **The folder icon is served by the page.** `resolveFolderIcon()` reads `icons.theme`, then looks for `places/folder` (SVG first, then sharp PNG sizes) in that set, its `Inherits=` chain, Adwaita, and hicolor, under `$XDG_DATA_HOME/icons`, `~/.icons`, and `/usr/share/icons`. Icon set names must be plain names. `GET icon/folder` serves the file behind the run token, so the page loads nothing from another origin. `api/theme` also reports the icon's path, so an open page reloads the icon only when it changes.

5. **Stats are label and value pairs in two columns.** The renderer builds rows of `[left, right]` pairs, each half its own grid, so the two halves stay the same width whatever their labels. The local and Proton Drive paths come from the configured pair, passed to `DetailPageServer` as `roots` and sent in `/api/state`. Proton documents are counted as `Files skipped`, and the section listing them is titled `Skipped`.

6. **The locale comes from the engine process.** `systemLocale()` resolves `LC_ALL`, then `LC_TIME`, then `LANG`, turns `en_GB.UTF-8` into `en-GB`, and keeps it only if `Intl` supports it. `/api/state` sends it as `locale`, and the renderer formats dates, counts (including section counts and page ranges), sizes and speeds with it. The file-run fraction stays unformatted (`SYNCING (34/5685)`), as the bar shows it. A browser's language often differs from the system locale the rest of the desktop uses.

7. **More facts in the snapshot, from data the engine already holds.** `RemoteMirror.library()` returns each Proton document's modified time (the content's own time when the saving app recorded one, else Proton's), published as `protonDocumentModifiedAt`, with no prototype so a document named `__proto__` stays an own entry. The control target's `listConflicts()` adds the remote file's current modified time as `remote.mtimeMs`, using `RemoteMirror.modifiedAt()`. `RecycleBin.list()` stats each file for its size. No stored data changes.

8. **Conflicts in plain words, with icon actions.** The renderer maps each kind to a phrase, using the `deleted` flags to say which side a delete-versus-edit happened on. The raw kind stays in the tooltip. Each side shows its size and modified time, with the path, the exact size and the SHA-1 on hover. Keep local, Keep remote and Keep both are icon buttons named in their tooltips. A delete-versus-edit conflict has already kept the edit on both sides, so its only button is a checkmark named Dismiss that sends `keep_both`. The raw JSON is gone. The row and its tooltips show what a person needs to choose; internal fields such as node and revision IDs and file-system identities are no longer on the page, and `proton-drive-sync conflicts --json` still prints the complete records.

9. **Quarantine reads like the conflicts.** The two reasons the engine records (`verification_failed`, `unknown_outcome`) become phrases, and any other reason shows as sent. The phrase sits under the path, as a conflict's does, and the row adds the quarantine time from `createdAt`. Release becomes an icon button like the conflict actions: an open padlock, named in its tooltip. The step (from `details.op`, in the page's words), the error or note, the node ID and the raw reason move into the phrase's tooltip. The node ID is Proton's internal ID: no Proton app shows it and nobody can search for it, so it does not earn a column. `quarantine --json` still prints the complete entries.

10. **The state line alternates, like the Wi-Fi panel's caption.** The shell's Wi-Fi panel cycles the caption under its title every 2.8 seconds, fading it out over 180 ms and in over 260 ms. The page does the same with the state line: `applySnapshot()` builds the messages (the state with any file-run fraction, the reason, dry run, a degraded stream), each with a tone, and keeps the one showing when a refresh brings the same messages. `advanceStatus()`, a second self-contained function inlined into the page like `applySnapshot()`, moves to the next message; the page's script calls it on a 2.8-second timer, adding a `fading` class for the fade unless reduced motion is asked for. The reason line and the dry-run and degraded notes that used to sit under the header go: their text is in the rotation, and all of it is on hover.

    Known engine reasons become short phrases, because the engine's reasons are written for the log (`sync_root_missing: Sync root is unavailable: /home/chad/Drive`, a remote root's node ID, byte counts) and the paths are already in the stats. Remote errors are matched by how they end (`…: connection failed`, `…: server error 503`), since the engine puts the operation and Proton IDs in front. Offline never shows a reason as sent, because those reasons carry IDs: an unmatched one reads `can't reach proton`. Other unknown reasons show as sent. Tones reuse the theme's yellow and red (`--om-yellow`, `--om-red`), with amber `#9a5b00` and red `#c0262d` off Omarchy so they read on white.

11. **The version travels with the snapshot.** `/api/state` includes `version: packageVersion()`, and the renderer shows it as `Plugin` with `v<version>` at the end of the stats' right column. The served document no longer contains the version.

   Alternative: keep writing it under the title. Rejected because the stats are where the other facts about the running engine now live.

12. **Two missed refreshes mean the engine is gone.** Each engine run serves the page at a new secret address, so a page left open across a restart can never reach it again. After two failed state fetches in a row (about 4 seconds), the page shows a notice and dims the details. One failed fetch does not show it, so a hiccup does not flash the notice. A later success clears it.

## Risks / Trade-offs

- [Omarchy changes its theme file layout] → `readOmarchyTheme()` returns null and the page falls back to the preview-card look. Nothing breaks.
- [A theme uses a `[controls]` value the page drops] → That control state uses the shell's default, so it can differ slightly from the shell.
- [The page polls the theme every 2 seconds] → Each poll reads two small files. Without a theme, `colors.toml` is missing and the read fails fast.
- [Dismiss and Keep both send the same action] → The engine treats them identically, which is right for a delete-versus-edit conflict: there is only one file left to keep.
- [Removing the JSON view hides a field someone relied on] → `proton-drive-sync conflicts --json` prints the complete records.

## Migration Plan

No stored data changes. `/api/state` only gains fields, so an older page against a newer engine ignores them. Rollback is reverting `src/tray/` and the snapshot fields.
