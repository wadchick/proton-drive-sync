# Bar panel previews

A preview tool that screenshots the Proton Drive bar panel (`omarchy/Panel.qml`) in every state (syncing, conflicts, a held plan, signed out, and so on) without a running sync engine. Nothing appears on screen, and no files outside the output folder are touched.

The panel, the Omarchy shell's own `Commons` and `Ui` modules, the current theme and the font are the real ones. Two things are stand-ins:

- **The engine data.** It's made up, but built with the engine's own `initialStatus()` and `summarize()`, so the summary lines read exactly as the engine writes them.
- **The popup window.** The shell's `KeyboardPanel` is a full-screen layer-shell window, which can't be rendered offscreen. [`preview-panel/KeyboardPanel.qml`](preview-panel/KeyboardPanel.qml) draws the same card in its place, with the same colors, border, padding, corners and size limits.

## Run it

From the repository root:

```bash
npx vite-node scripts/preview-panel.ts                          # the working tree's panel, every scenario
npx vite-node scripts/preview-panel.ts held conflicts           # only the ones named
npx vite-node scripts/preview-panel.ts --ref origin/master      # the panel at any git ref
npx vite-node scripts/preview-panel.ts --compare origin/master  # side by side: the ref left, the working tree right
```

It prints where the screenshots went and exits. By default that's a new folder under `/tmp`.

| Option | Does |
| --- | --- |
| `--out <dir>` | Write the screenshots here instead of a new temp folder |
| `--ref <ref>` | Render `omarchy/Panel.qml` and `omarchy/Model.js` from a git ref instead of the working tree |
| `--compare <ref>` | Render the ref and the working tree, and put each pair side by side in `pairs/`. Needs ImageMagick |
| `--scale <n>` | Device pixel ratio, default `2` |
| `--screen <W>x<H>` | Screen size in logical pixels that the card is fitted to, default `1920x1080`. It matters for panels that cap their height |

- Files are numbered in the order below, e.g. `06-held.png`.
- A panel taller than its own height limit scrolls. It gets a second shot scrolled to the bottom, e.g. `06-held-scrolled.png`, and in `--compare` pairs the two are stacked.
- Warnings that the panel's QML prints while rendering are shown in the terminal.
- `vite-node` is one of the project's dev dependencies. If `node_modules` is missing, run `npm ci` first. Quickshell (`qs`) and the shell modules come with Omarchy. If Omarchy isn't in `/usr/share/omarchy`, set `OMARCHY_PATH`.

## Scenarios

| Name | Shows |
| --- | --- |
| `idle` | In sync |
| `syncing` | Syncing 3 of 10, with pending files and two transfers in progress |
| `paused` | Paused partway through a run |
| `conflicts` | Seven conflicts of every kind, more than a panel lists |
| `conflicts-few` | Three conflicts, including both delete-vs-edit directions |
| `held` | A 64-file held plan from the mass-change brake (the engine sends 50 rows and the total) |
| `quarantine` | Two quarantined items, one known only by its Proton node |
| `offline` | No connection to Proton |
| `error` | The sync folder is missing |
| `login` | The Proton session expired |
| `signed-out` | Not signed in yet: no engine running |
| `not-configured` | Signed in, folders not chosen yet |
| `engine-failed` | The engine keeps stopping |

## What the buttons do

Nothing: this takes screenshots and exits. The stand-in service only logs actions, which matters when a panel acts on its own while opening. For example, a panel that opens the details page when conflicts overflow logs `openExternal` and stays put.

## Troubleshooting

**"Quickshell did not produce any screenshots"**: the tool prints Quickshell's output after the message. The usual cause is a QML error in the panel under test, such as a missing import or a typo, which also stops the real shell from loading it.

**Text looks wrong or the colors are off**: the previews follow the current Omarchy theme and the system monospace font, like the real panel. Switch theme with `omarchy theme set <name>` and run it again.

**A panel built for a newer shell fails to load**: the harness uses the shell modules installed on this machine. Update Omarchy, or render an older ref with `--ref`.

## Changing or adding scenarios

The scenarios are defined in [`preview-panel.ts`](preview-panel.ts), in the `SCENARIOS` list. Each one sets what `doctor --json`, `status --json`, `conflicts --json` and `quarantine --json` would return. Copy an existing entry to add a new one. Its number comes from its place in the list.

If the panel starts reading a new property or action from the service, add it to the stand-in service in [`preview-panel/shell.qml`](preview-panel/shell.qml).
