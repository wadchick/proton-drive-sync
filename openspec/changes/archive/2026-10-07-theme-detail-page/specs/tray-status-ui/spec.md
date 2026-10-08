## MODIFIED Requirements

### Requirement: Detail page is a live view
The details page SHALL be served only on 127.0.0.1 behind a per-run secret in the URL, SHALL load the live snapshot into the visible page (not only into a JSON endpoint), SHALL refresh while open, and SHALL offer pause, resume, sync now, conflict resolution, quarantine release, and held-plan confirm/reject. A successful load of a running engine SHALL never render an empty shell with no state, counts, or lists when the engine has data. The visible page SHALL show the snapshot's last-sync, last-full-sync, and library facts as label and value pairs: `Local files`, `Proton Drive files`, `Last sync`, `Files copied last sync`, `Last full sync`, `Pending`, `Files in sync`, and `Folders in sync`, plus `Local path` and `Proton Drive path` when the sync pair is known, `Only on this computer` and `Only on Proton` when either count is non-zero, and `Files skipped` when Proton documents exist. A value that is not known yet SHALL read `--`. The page SHALL NOT show `N local · N remote · N synced`. When Proton documents exist, the page SHALL make every relative path reachable. A list of 25 or fewer paths SHALL be fully visible without changing pages. A longer list SHALL show 25 paths per page and SHALL let the user open the other pages. The tray, the bar panel, and human CLI status SHALL NOT list those paths. Pause and resume SHALL be one on/off switch that is on while syncing is allowed. Sync now SHALL be unavailable while the engine is paused. Pause, resume, sync now, conflict resolution, quarantine release, and held-plan confirm or reject SHALL keep their current effect on the engine.

#### Scenario: Open details with files already synced
- **WHEN** the user opens the details page after a successful sync of a non-empty tree with no Proton documents
- **THEN** the visible page shows the engine state, a `Last sync` time, the file counts, and is not blank, and it does not show a Proton document path

#### Scenario: Proton documents are listed
- **WHEN** the snapshot includes two Proton documents at `Notes/Agenda` and `Notes/Budget`
- **THEN** the details page shows both paths without requiring a page change, and human CLI status shows the Proton documents count without either path

#### Scenario: A long Proton document list is paged
- **WHEN** the snapshot includes 30 Proton document paths
- **THEN** the page shows 25 of them, shows that 30 exist, and the remaining 5 are visible after moving to the next page

#### Scenario: Pause from the page
- **WHEN** the user turns the sync switch off on the details page
- **THEN** the engine enters paused, the switch shows off, Sync now is unavailable, and subsequent local creates are not uploaded until the switch is turned back on

#### Scenario: Unknown token
- **WHEN** a client requests the page or its API with a token that is not the current run's token
- **THEN** the server responds not found and does not leak status

### Requirement: Detail page matches the preview card
When no Omarchy theme is available, the details page SHALL paint itself with the preview card's colors: mint `#cdfae4` into lavender `#d0d8fc` across the page, white cards `#fcfdfe`, navy text `#2c3343`, cyan `#2cd1ec`, and folder blue `#42aefc`. The header and each section SHALL be a white card, except a held plan, whose pale yellow warning box SHALL be its card, so it stands out and is not a box inside a card. Cards and controls SHALL be rounded. The page SHALL carry its presentation in the document it serves and SHALL NOT load a script or a stylesheet from another host. Each stat SHALL be its own label and value, so the facts do not run together. While a file run has a `done` and `total`, the state line under the title SHALL show that fraction after the state, as `SYNCING (done/total)` or `PAUSED (done/total)`, with no separate progress line, and the last-sync stats SHALL stay. When `dryRun` is true the state line SHALL say dry run. When `degraded` is true the state line SHALL say the event stream is degraded.

#### Scenario: The served page carries the card colors
- **WHEN** the browser loads the details page and no Omarchy theme is available
- **THEN** the document includes `#cdfae4`, `#d0d8fc`, `#fcfdfe`, `#2c3343`, `#2cd1ec`, and `#42aefc`, and its cards are rounded

#### Scenario: A held plan is its own card
- **WHEN** a plan is held and no Omarchy theme is available
- **THEN** the held plan shows as one rounded pale yellow card, with no white card around it

#### Scenario: Stats stay separate
- **WHEN** the snapshot has a last sync time and file counts
- **THEN** each fact is its own label and value and all of them are visible

#### Scenario: A file run shows its progress and the previous sync
- **WHEN** the engine is syncing with `done` 34 and `total` 5685, and the previous finished check copied 2 files
- **THEN** the state line reads `SYNCING (34/5685)` and `Files copied last sync` still shows 2

### Requirement: Detail page keeps long lists compact
Proton documents, conflicts, quarantine, the recycle bin, in-flight transfers, and the affected paths of a held plan SHALL each show at most 25 rows at a time. The section heading SHALL show the full count. Proton documents, conflicts, quarantine, the recycle bin, and transfers SHALL each say in one line what the section holds. The user SHALL be able to filter a section by a case-insensitive path substring and SHALL be able to move between pages of the filtered rows. A filter that matches nothing SHALL say that nothing matches and SHALL still show the unfiltered count. Clearing the filter SHALL show the full list again, from its first page. A refresh of the live snapshot SHALL keep the current page and the current filter, and SHALL move back only when the current page no longer exists. An empty section SHALL show its heading with a count of 0 and its explanation, and SHALL NOT show a list, a filter, a page range, or a `none` line. Conflicts, quarantine, and a held plan SHALL appear above Proton documents and the recycle bin. In those tables, a long path SHALL be cut at its start so the file name stays visible, and the full path SHALL be available on hover. A conflict SHALL say in plain words what happened on each side and SHALL show a short summary of the local and remote sides, with each side's details available on hover. A conflict SHALL offer Keep local, Keep remote, and Keep both, except a delete-versus-edit conflict, whose edit is already kept on both sides: it SHALL offer only Dismiss, which sends `keep_both`. The page SHALL NOT show a conflict's raw JSON. A quarantined item SHALL say in plain words what happened (`Failed its integrity check` for a failed verification, `Unclear after a crash` for an unknown outcome, and the engine's reason as sent for any other) and when it was quarantined, and SHALL offer Release. Its step, error or note, Proton node ID, and raw reason SHALL be available on hover rather than in their own columns. A recycle row SHALL show the file's size when it can be read and a readable local time, with the ISO instant as that time's tooltip. A Proton document row SHALL show when the document last changed, when Proton reports it. A failed page action SHALL show the error text returned for that action.

#### Scenario: Filter a long document list
- **WHEN** 30 Proton document paths are listed and the user filters for `agenda`
- **THEN** only paths that contain that substring are shown, the heading still shows 30, and clearing the filter returns the full list at its first page

#### Scenario: Refresh keeps the user's place
- **WHEN** the user is on page 2 of Proton documents with a filter applied and the live snapshot refreshes
- **THEN** the page stays on page 2 and the filter text is unchanged

#### Scenario: Empty quarantine stays quiet
- **WHEN** the snapshot has no quarantined items
- **THEN** the quarantine section shows its heading with `(0)` and its explanation, and no list, filter, or `none` line

#### Scenario: Decisions sit above the library lists
- **WHEN** there is an open conflict and at least one Proton document
- **THEN** the conflict, including its path and its resolve actions, is above the Proton documents section

#### Scenario: A conflict reads in plain words
- **WHEN** a file was edited on both sides
- **THEN** its row says `Edited on both sides`, shows each side's size and, when known, its modified time, and offers Keep local, Keep remote, and Keep both

#### Scenario: A delete-versus-edit conflict is dismissed
- **WHEN** a file was deleted on this computer and edited on Proton
- **THEN** its row says `Deleted here, edited on Proton`, offers only Dismiss, and Dismiss sends `keep_both`

#### Scenario: A quarantined item reads in plain words
- **WHEN** a downloaded file failed its integrity check
- **THEN** its row says `Failed its integrity check`, shows when it was quarantined, and offers Release, and the step, the error, and the node ID are on hover and not in a column

#### Scenario: A recycle time keeps its instant
- **WHEN** a recycled file is listed
- **THEN** the row shows its size, or `--` when the size cannot be read, and a readable local time, and the ISO instant is that time's tooltip

#### Scenario: A rejected action is visible
- **WHEN** a page action returns an error message
- **THEN** that message is shown on the page and the engine state is left as the action left it

### Requirement: Detail page shows the tool version
The details page SHALL show the package version of the engine process that served the page in its stats, as the label `Plugin` with the value `v` followed by that version. The version SHALL come with the live snapshot from that process, so it SHALL remain when the snapshot refreshes. The page SHALL NOT use a Proton API client identity as that version. When that process cannot read its package version, the page SHALL omit the `Plugin` stat.

#### Scenario: Open details
- **WHEN** the user opens the details page of a running engine whose package version is 0.2.6
- **THEN** the stats show `Plugin` with `v0.2.6`

#### Scenario: Refresh keeps the version
- **WHEN** the live snapshot refreshes while the details page is open
- **THEN** the `Plugin` stat still shows the package version of the process that served the page

#### Scenario: Version cannot be read
- **WHEN** the serving process cannot read its package version
- **THEN** the details page omits the `Plugin` stat and still shows the title and the engine state

## ADDED Requirements

### Requirement: Detail page follows the Omarchy theme
When the active Omarchy theme's `colors.toml` (under `$XDG_STATE_HOME/omarchy/current/theme`, or `~/.local/state/omarchy/current/theme` when that variable is unset) has a background, a foreground, and an accent, the details page SHALL take its colors and light or dark mode from that file, and SHALL take its control colors, borders, and widths from the `[controls]` table of `shell.toml` beside it, with the shell's defaults for anything that file leaves out. Only plain hex colors, the shell's color roles, numeric alphas, and pixel widths SHALL reach the page's styles, and an alpha outside 0 to 1 SHALL be clamped to that range. In that theme the page SHALL use square corners and a monospace font, and SHALL separate its sections with dividers instead of cards. The header SHALL show the `folder` icon of the theme's icon set (named in `icons.theme`), following that set's inherited themes and then Adwaita and hicolor, served from the page's own address. When no icon is found, the header SHALL show no icon. An open page SHALL pick up a theme switch, including a theme being removed, within a few seconds without a reload. Without a usable theme, the page SHALL keep the preview-card look.

#### Scenario: A theme is set
- **WHEN** the browser loads the details page and the active theme's `colors.toml` has a background, a foreground, and an accent
- **THEN** the page uses that theme's colors and mode, its sections sit under dividers, and the header shows the theme's folder icon when one is found

#### Scenario: The theme changes while the page is open
- **WHEN** the user switches the Omarchy theme while the details page is open
- **THEN** within a few seconds the page shows the new theme's colors, and its folder icon when one is found, without being reloaded

#### Scenario: A theme file carries something other than a color
- **WHEN** a theme file sets a value that is not a plain hex color, a color role, a number for an alpha, or a pixel width
- **THEN** that value does not reach the page, and the page's own default applies

#### Scenario: An alpha out of range is clamped
- **WHEN** `shell.toml` sets a control alpha of 1.5
- **THEN** the page uses an alpha of 1 for that control

#### Scenario: No theme
- **WHEN** there is no usable `colors.toml`
- **THEN** the page shows the preview-card look with white rounded cards

### Requirement: Detail page state line alternates its messages
The state line under the details page's title SHALL hold one or more messages and SHALL show one at a time, like the caption of the shell's Wi-Fi panel: the state (with the file-run fraction when there is one), then the engine's reason when there is one, then `dry run` when `dryRun` is true, then `event stream degraded` when `degraded` is true. A paused engine SHALL show no reason. With more than one message, the line SHALL move to the next message every 2.8 seconds, after the last one back to the first, fading out over 180 ms and back in over 260 ms, and SHALL change without the fade when the system asks for reduced motion. A refresh of the live snapshot SHALL keep the message showing while the messages are the same, and SHALL start from the state when they change. Hovering the line SHALL show every message at once, with the reason in the engine's own words.

The page SHALL show these engine reasons as short phrases without paths or IDs, matching the whole reason, then its leading code, then how a remote error ends (leaving out the operation and IDs in front). While the engine is offline, any other reason SHALL show as `can't reach proton`; in other states, any other reason SHALL show as the engine sent it:

- `sync root unavailable` and `sync_root_missing`: `sync folder is missing`
- `sync_root_changed`: `sync folder was replaced`
- `remote_root_missing`: `proton drive folder is missing`
- `remote_root_changed`: `proton drive folder was trashed or replaced`
- `disk_space_low` and `disk full`: `not enough disk space`
- `store_corrupt`: `sync database is damaged`
- `session rejected` and `no stored session`: `sign in to proton again`
- `server asked us to slow down`: `proton asked us to slow down`
- ending in `connection failed` or `timed out`: `can't reach proton`
- ending in `server error` and a 5xx status: `proton is having trouble`
- ending in `rate limited`: `proton asked us to slow down`
- ending in `response exceeded the size limit`: `unexpected response from proton`

Each message SHALL have a tone that sets its colour: an error tone (the theme's red, or a red that reads on white without a theme) for `error` and `needs_login` and their reasons; a warning tone (the theme's yellow, or an amber that reads on white) for `offline`, `throttled`, `attention`, and `awaiting_confirmation` and their reasons, and for `dry run` and `event stream degraded`; and the usual caption colour otherwise.

#### Scenario: An error alternates with its reason
- **WHEN** the engine is in `error` with the reason `sync_root_missing: Sync root is unavailable: /home/you/Drive`
- **THEN** the state line shows `ERROR`, then `SYNC FOLDER IS MISSING`, then `ERROR` again, both in the error tone, and hovering it shows the reason with its path

#### Scenario: Dry run joins the rotation
- **WHEN** the engine is idle in dry run with a degraded event stream
- **THEN** the state line shows `IDLE` in the usual colour, then `DRY RUN` and `EVENT STREAM DEGRADED` in the warning tone

#### Scenario: Offline without the engine's IDs
- **WHEN** the engine is offline with the reason `events for scope Y2xr: connection failed`
- **THEN** the state line alternates between `OFFLINE` and `CAN'T REACH PROTON`, both in the warning tone, and hovering it shows the engine's reason

#### Scenario: A reason the page does not know
- **WHEN** the engine is in `error` with the reason `something unexpected`
- **THEN** the state line alternates between `ERROR` and `SOMETHING UNEXPECTED`, both in the error tone

#### Scenario: One message stays still
- **WHEN** the engine is syncing with `done` 3 and `total` 10 and nothing else to say
- **THEN** the state line shows `SYNCING (3/10)` and does not change

#### Scenario: A refresh keeps the message showing
- **WHEN** the state line shows the second message and the live snapshot refreshes with the same messages
- **THEN** the second message is still showing

### Requirement: Detail page dates follow the system locale
The details page SHALL format dates, times, counts, sizes, and speeds, including section counts and page ranges, in the system locale of the engine process: `LC_ALL`, then `LC_TIME`, then `LANG`, as POSIX resolves it. The file-run fraction on the state line SHALL stay unformatted, as the bar shows it. When that locale is `C`, `POSIX`, unset, or not one the runtime knows, the browser SHALL choose the format.

#### Scenario: A British locale
- **WHEN** the engine runs with `LANG=en_GB.UTF-8` and no `LC_ALL` or `LC_TIME`
- **THEN** the page formats its dates in the `en-GB` style

#### Scenario: Counts follow the locale
- **WHEN** the engine runs with `LANG=de_DE.UTF-8` and 1234 Proton documents are listed
- **THEN** the Skipped heading shows `(1.234)` and the page range reads `1–25 of 1.234`

#### Scenario: The C locale
- **WHEN** the engine runs with `LC_ALL=C`
- **THEN** the page leaves the date format to the browser

### Requirement: Detail page says when it loses the engine
When the details page fails to load the live snapshot on two refreshes in a row, it SHALL say that it lost its connection to Proton Drive Sync and that the details may be out of date, and SHALL dim the details it can no longer refresh. When a later refresh succeeds, the notice SHALL go away and the details SHALL show the new snapshot.

#### Scenario: The engine stops
- **WHEN** the engine that served the page stops while the page is open
- **THEN** within a few seconds the page shows the lost-connection notice and dims its details

#### Scenario: The engine answers again
- **WHEN** a refresh succeeds after the notice was shown
- **THEN** the notice goes away and the page shows the new snapshot
