# Proposal

## Why

The package version is only in `package.json` and `manifest.json`. Someone looking at the bar or the details page cannot tell which build is running, including after a plugin update that has not yet rebuilt the engine.

## What Changes

- Show the tool version on the bar panel and on the local details page, as `Version <package version>` (today, `Version 0.2.1`).
- The number is the package version shared by `package.json` and `manifest.json`. It is the engine that `doctor` and the details page are running, not the Proton API client identity in `APP_VERSION`.
- Put it on the panel you open from the chip, including when the engine process is stopped and before setup. Leave the chip label as the sync state. When the engine command is not installed, the panel does not invent a version.
- Put the same line under the title on the details page. That page already exists only while an engine is running, and it shows the version of the process that served it.
- Leave the tray menu, the chip wording, and the README as they are.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `omarchy-bar-status`: The panel shows the installed engine's package version. The chip label stays the engine state.
- `tray-status-ui`: The details page shows the package version of the engine that served the page.

## Impact

- `proton-drive-sync doctor`: the report gains the package version so the panel can show the installed engine rather than a copy baked into QML. The human doctor lines name it too.
- `omarchy/Panel.qml`: one quiet line when that field is present. `Service.qml` does not grow a new function.
- `src/tray/detailPage.ts`: the served document shows the same kind of line under the title.
- Tests that lock the doctor allowlist, the panel source, and the details page text.
