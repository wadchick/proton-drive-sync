## Why

The bar panel can open the sync folder and the details page, but the sync config file is only reachable from the tray menu's Settings action. On the Omarchy bar, that file should be one click away from Open details.

## What Changes

- Add **Open config** in the same panel row as Open folder and Open details, immediately after Open details.
- Choosing it opens the sync config file (`config.json`) with the system file opener. That is the same file the tray Settings action already opens. It does not open the config directory, and it does not edit the file inside the panel.
- Show the action once a config file is stored, including while the engine is not running. Hide it before setup. Open details stays limited to a running engine.
- Choosing the action does not write the file, start a login, or restart the engine. An edit takes effect the way a hand-edited config already does.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `omarchy-bar-status`: The panel offers Open config beside Open details and opens the stored sync config file without writing it.

## Impact

- `omarchy/Panel.qml`: one more link in the existing open row, using the opener already used for the folder and the details page.
- `proton-drive-sync doctor`: the JSON report gains the config file path when a config is stored, and null otherwise, so the shell does not guess `XDG_CONFIG_HOME` or `PROTON_DRIVE_SYNC_DIR`. The human doctor lines name that path too.
- `README.md`: the Day to day sentence that names Open folder and Open details also names Open config.
- The tray menu is unchanged. It already opens this file from Settings.
