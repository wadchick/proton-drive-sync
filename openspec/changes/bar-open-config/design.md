## Context

See proposal.md for why the bar should open the config. The panel row in `omarchy/Panel.qml` already shows Open folder when `doctor.localRoot` is set and Open details when `doctor.detailUrl` is set. Both call `Service.openExternal`, which runs `xdg-open` detached. `doctor --json` is stored whole on `service.doctor`. Its report is an allowlist in `doctorReport`: `nodeOk`, `configured`, `loggedIn`, `running`, `localRoot`, `remoteRoot`, `detailUrl`. The config file path already lives on `deps.ctx.paths.configFile`, and the tray Settings action opens that same path. `resolveAppPaths` honors `PROTON_DRIVE_SYNC_DIR` and `XDG_CONFIG_HOME`, so the path is not always `~/.config/proton-drive-sync/config.json`.

## Goals / Non-Goals

**Goals:**

- One panel link, labeled Open config, placed immediately after Open details in the existing row.
- The link opens the file `doctor` names, through the opener the folder and the details page already use.
- The link is present whenever that path is known, and absent when `doctor` reports no config file.

**Non-Goals:**

- A config form in the panel, or opening the config directory.
- Reloading a running engine after the file changes. A hand edit still applies the way it does today.
- Changing the tray menu. Settings already opens this file.
- Opening the recycle folder or the audit log from the bar.

## Decisions

1. **`doctor` reports `configFile`.** Add `configFile: string | null` to `DoctorReport` and copy it in `doctorReport`. When `deps.ctx.config` is set, the value is `deps.ctx.paths.configFile`. Otherwise it is null, including when the default path has no file yet. The human doctor line is `Config file: <path>` or `Config file: -`, beside the existing folder lines.

   Alternative: hardcode `~/.config/proton-drive-sync/config.json` in QML. Rejected because an override directory would make the panel open a different file from the one the engine loaded.

   Alternative: a new `config-path` command. Rejected because the panel already polls `doctor --json` for `localRoot` and `detailUrl`.

2. **The panel reads that field and does not grow `Service.qml`.** Add a third underlined `Text` in the open row: label `Open config`, visible when `doctor.configFile` is a non-empty string, click calls `openExternal(doctor.configFile)`. Include `configFile` in the row's visibility check so the row can show on that field alone. Open details stays visible only when `detailUrl` is set. `Service.qml` already keeps the parsed doctor object, so it does not need a new function.

3. **The README names the new link in the existing Day to day sentence.** Replace "Open folder and Open details show up while the engine is running." with "Open folder and Open config show up once a sync pair is saved. Open details shows up while the engine is running." Leave the rest of that section as it is.

4. **Tests lock the path and the click target, and do not spawn `xdg-open`.** Extend the doctor test in `src/cli/cli.test.ts`: with no config, `configFile` is null; after `setup`, it equals `deps.ctx.paths.configFile` (that harness already uses `PROTON_DRIVE_SYNC_DIR`, so this is the non-default path). The `doctorReport` fixture gains `configFile` and still drops `session`. `src/cli/omarchyShell.test.ts` asserts the panel source contains `Open config` and `openExternal(root.service.doctor.configFile)`, and that this call appears after the Open details click.

## Risks / Trade-offs

- [A new panel against an older engine hides Open config, because `configFile` is missing] → The link stays hidden rather than opening a guessed path. Plugin update and `scripts/install-engine` ship the QML and the doctor field together.
- [The user edits `config.json` and expects the running engine to notice] → This action does not restart the engine. The file opens in whatever app `xdg-open` chooses. Identity and path edits keep the existing setup rules.
- [`xdg-open` fails when no handler exists] → Same as Open folder and Open details. The click stays detached and does not block the panel.

## Migration Plan

No stored data changes. Older panels ignore the extra doctor field. Rollback is removing the link; a newer panel reading an older doctor treats a missing `configFile` as no link.
