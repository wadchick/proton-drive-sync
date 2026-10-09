# Tasks

## 1. Omarchy theme

- [x] 1.1 Add `src/tray/omarchyTheme.ts`. `omarchyColorsPath()` finds `colors.toml` under `XDG_STATE_HOME`, else `~/.local/state`. `parseOmarchyColors()` keeps plain hex colors and `mode`, and returns null without `background`, `foreground`, and `accent`. `parseShellControls()` keeps only color roles, hex colors, numeric alphas (clamped to 0 to 1), and pixel widths from `[controls]`. `omarchyThemeCss()` turns them into `--om-*` and `--ctl-*` variables. Verify `src/tray/omarchyTheme.test.ts`: the path, dark and light palettes, the required keys, rejection of non-hex values, a missing file, the dropped control values and the clamped alpha, the shell defaults, and `shell.toml` beside `colors.toml`.
- [x] 1.2 `resolveFolderIcon()` reads `icons.theme` and finds `places/folder` in that set, its `Inherits=` chain, Adwaita, then hicolor, SVG first. It ignores a set name that is not a plain name. Verify the folder icon and plain-name tests in `src/tray/omarchyTheme.test.ts`.
- [x] 1.3 Serve the theme. `renderPage()` embeds the theme CSS and sets `class="omarchy"` when there is one. `GET api/theme` returns the CSS and the icon's path. `GET icon/folder` serves the icon, or 404 when there is none. The client polls `api/theme` every 2 seconds and swaps the style, the class, and the icon. Verify `src/tray/detailPage.e2e.test.ts` "follows the Omarchy theme on disk, live" and `src/tray/detailView.test.ts` "follows a theme switch and drops the theme when it goes away".

## 2. Page layout

- [x] 2.1 A panel-style header: the folder icon, the title, the state under it, Sync now, and the on/off switch. While a file run is moving or paused, its fraction follows the state (`SYNCING (3/10)`, `PAUSED (3/10)`), with no separate progress line. Sync now is disabled while paused. Verify the switch test and "shows file-run progress on the state line and a dry-run note only when asked" in `src/tray/detailView.test.ts`.
- [x] 2.2 The stats as label and value pairs in two columns, with the sync pair's paths from `roots`. Verify `src/tray/detailView.test.ts` "shows state, non-empty file counts and last sync, and fills the lists" and the e2e "the visible page shows the engine state and non-zero file counts".
- [x] 2.3 Without a theme, the header and each section are white rounded cards. With a theme, sections sit under dividers. Verify the e2e "serves the page behind the run token and 404s an unknown token": the card colors including `#fcfdfe`, the `html:not(.omarchy)` card rule with `var(--pds-card)` and a 20px radius, the `html.omarchy` divider rule, no unscoped divider rule, and no outside script or stylesheet.
- [x] 2.4 Each list section has a one-line explanation. An empty section shows its heading with `(0)` and its explanation, and hides its filter, list, and page range. Verify "never leaves the page a blank shell" in `src/tray/detailView.test.ts` for the hidden filter, list and range, and "shows state, non-empty file counts and last sync, and fills the lists" for the explanation lines.

- [x] 2.5 The held plan's items are a table like the other sections: a `Name` header, each item cut at its start with the full item on hover. Proceed and Reject sit flush right on the filter's row, above the list, so they are in view without scrolling. Without a theme, the held plan's warning box is its card rather than a box inside a white card. An empty progress or reason line in the header takes no room. Verify "lists a held plan in a table like the other sections, with the full item on hover" in `src/tray/detailView.test.ts`, including the buttons' place on the filter row, and the held-card, button and empty-line CSS rules in the e2e "serves the page behind the run token and 404s an unknown token".

- [x] 2.6 The state line alternates between the state, the reason as a short phrase, dry run and a degraded stream, every 2.8 seconds with the Wi-Fi panel's fade (none with reduced motion), keeping its place across a refresh, with every message on hover. Errors and sign-in take the error tone; offline, throttled, attention, awaiting confirmation, dry run and a degraded stream the warning tone. The reason line and the dry-run and degraded notes are removed. Remote errors are matched by their ending, and an unmatched offline reason reads `can't reach proton`. The preview's offline, error and sign-in states use the engine's real reason strings. Verify "alternates the state line between the state and its details, like the Wi-Fi panel" and "turns each engine reason it knows into a short phrase" and "fades the state line to its next message on a timer, and just swaps it with reduced motion" in `src/tray/detailView.test.ts`, and the fade, reduced-motion and tone CSS rules in the e2e "serves the page behind the run token and 404s an unknown token".

## 3. Dates and new facts

- [x] 3.1 `systemLocale()` resolves `LC_ALL`, `LC_TIME`, then `LANG`, and `/api/state` sends it as `locale`. The renderer formats dates, counts, section counts, page ranges, sizes and speeds with it, and leaves the file-run fraction unformatted, as the bar shows it. Verify `src/tray/detailPage.e2e.test.ts` (the `systemLocale` tests), "formats dates in the locale it is given, not the browser's", and "formats section counts and page ranges in that locale too".
- [x] 3.2 Publish each Proton document's modified time as `protonDocumentModifiedAt`, add `RemoteMirror.modifiedAt()`, add the remote modified time to listed conflicts, and add each recycled file's size. Verify `src/engine/remoteMirror.test.ts`, `src/engine/status.test.ts`, `src/safety/safety.test.ts`, and in `src/engine/engine.test.ts` the Proton document times and, in "surfaces conflicts as attention, resolves them through the engine, and returns to idle", the remote `mtimeMs` on a listed conflict.
- [x] 3.3 A recycle row shows the size, or `--` when it cannot be read, and a readable time, with the ISO instant as the tooltip. Verify "shows a readable recycle time with the ISO instant as its tooltip" for the tooltip, and "shows state, non-empty file counts and last sync, and fills the lists" for the readable time, the `datetime`, `2 KB`, and `--`.

## 4. Conflicts

- [x] 4.1 Each conflict says what happened in plain words, shows each side's size and modified time with details on hover, and offers icon buttons. The raw JSON view is removed. Verify the conflict rows in "shows state, non-empty file counts and last sync, and fills the lists".
- [x] 4.2 A delete-versus-edit conflict offers only Dismiss, which sends `keep_both`. Verify "offers only dismiss for a delete-versus-edit conflict, sent as keep both".
- [x] 4.3 State the delete-versus-edit exception in the `conflict-handling` spec. The engine already refuses keep local and keep remote there and closes the entry on keep both. Verify `src/conflict/conflict.test.ts` "refuses keep local or keep remote, which would do nothing: the edit is already kept".

- [x] 4.4 Each quarantined item says what happened in plain words, under its path as in Conflicts, and when it was quarantined, with the step, error or note, node ID and raw reason on hover. Release is an open-padlock icon button named in its tooltip. The Node column is removed. Verify "says in plain words why an item is quarantined and when, with the details on hover".

## 5. Version and connection

- [x] 5.1 `/api/state` sends `version`. The stats show `Plugin` with `v<version>`, and omit it when the version is unknown. The served document no longer contains the version. Verify "shows the plugin version below Folders in sync, like the other stats, and leaves it out when unknown" and `src/tray/tray.test.ts` "leaves the version out of the served document: the live snapshot carries it".
- [x] 5.2 After two failed state refreshes in a row, show the lost-connection notice and dim the details. Clear it on the next success. Verify "says when the engine stops answering, and recovers when it answers again".

## 6. Preview tool

- [x] 6.1 Add `scripts/preview-detail.ts` and `scripts/preview-detail.md`: the real page and server with made-up data, one port per state (47800–47812). Include `scripts/` in `tsconfig.json` so the tool is type-checked, and add `vite-node` (which runs it) as a dev dependency rather than relying on Vitest to bring it in.

## 7. Check

- [x] 7.1 Run `scripts/ci.sh` and confirm it passes.
