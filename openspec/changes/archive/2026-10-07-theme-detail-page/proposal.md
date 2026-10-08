## Why

On Omarchy, the details page is the one part of the plugin that does not look like the desktop. The bar chip and the panel follow the active theme, but the page keeps its own mint-to-lavender palette whatever theme is set. The page also still reads like a report: the human status sentences run down the header, conflicts show raw JSON, dates are ISO strings, and an empty section says "none". It should read like the shell's own panels when a theme is set, keep the preview-card look when none is, and show the same facts in a form people can scan.

## What Changes

- **Follow the Omarchy theme.** When `$XDG_STATE_HOME/omarchy/current/theme/colors.toml` exists, the page takes its colors from it and its control fills, borders and widths from `shell.toml` beside it, in the shell's flat style: square corners, monospace, and sections under dividers instead of cards. The folder icon in the header comes from the theme's icon set, as Nautilus shows it. A theme switch reaches an open page within a few seconds. Without a theme, the page keeps the preview-card look, including its white rounded cards.
- **A panel-style header.** The folder icon, the title, and the engine state under it (with the file run's progress, as in `SYNCING (3/10)`), with "Sync now" and an on/off switch for pause and resume, like the shell's other panels. The human status lines become label and value pairs in two columns, like the Wi-Fi panel: the local and Proton Drive paths and file counts, then last sync, files copied, last full sync, pending work, files and folders in sync, files skipped, and the plugin version.
- **A state line that alternates.** Like the caption of the shell's Wi-Fi panel, the state line under the title cycles between the state and its details: the reason as a short phrase without paths (`SYNC FOLDER IS MISSING`), dry run, and a degraded event stream. Errors show in the theme's red and things to look at in its yellow. Everything is on hover in the engine's own words.
- **Readable tables.** Each section explains what it holds. Rows truncate long paths at the start so the file name stays visible, with the full path on hover. Dates, counts, sizes and speeds follow the system's locale (`LC_ALL`, then `LC_TIME`, then `LANG`), with the exact instant on hover where it matters. Skipped Proton documents show when they last changed. Recycled files show their size.
- **Plain-word conflicts.** Each conflict says what happened ("Edited on both sides", "Deleted here, edited on Proton") and shows each side's size and modified time, with the details on hover. Keep local, Keep remote and Keep both become icon buttons. A delete-versus-edit conflict, where the edit is already on both sides, offers a single Dismiss instead. The raw JSON view is removed; `proton-drive-sync conflicts --json` still prints the complete records.
- **Plain-word quarantine.** Each quarantined item says what happened ("Failed its integrity check", "Unclear after a crash") under its path and when, with Release as an icon button, with the step, the error and Proton's node ID on hover. The Node column, an internal ID nobody can act on, and the raw reason codes go.
- **Quiet empty sections.** An empty section shows its heading with `(0)` and its explanation, and no list, filter or "none" line.
- **The version moves into the stats** as `Plugin vX.Y.Z`, sent with the live snapshot rather than written under the title.
- **A lost engine is visible.** When the page stops reaching its engine (each engine run serves the page at a new secret address), a notice says so and the stale details dim, instead of the page silently showing old data.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `tray-status-ui`: The details page follows the Omarchy theme, shows its stats as label and value pairs, formats dates and numbers in the system locale, explains each section, shows conflicts in plain words with icon actions, offers Dismiss for a delete-versus-edit conflict, leaves empty sections quiet, carries the version in the stats, and says when it loses the engine.
- `conflict-handling`: The conflict inbox requirement states the delete-versus-edit exception the engine already enforces: keep local and keep remote are refused, and keep both closes the entry without a file operation.

## Impact

- `src/tray/detailPage.ts` (the server, the document and its CSS), `src/tray/detailView.ts` (the renderer and the in-page script), and a new `src/tray/omarchyTheme.ts` (the theme and folder icon reader), plus their tests.
- `/api/state` gains `roots`, `locale` and `version`. Two new routes serve the theme (`api/theme`) and the folder icon (`icon/folder`), behind the same run token.
- The snapshot gains `protonDocumentModifiedAt`. Conflicts from the control target carry the remote file's current modified time. Recycle entries carry their size. `RemoteMirror` gains `modifiedAt()`.
- The POST actions, the engine's sync rules, the tray menu, the bar, and CLI wording do not change. A Dismiss still sends `keep_both`.
