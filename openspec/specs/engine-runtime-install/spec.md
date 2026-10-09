# Engine Runtime Install

## Purpose

Run the Node sync engine from the committed plugin checkout so that `omarchy plugin add ... --enable` is the complete installation, with no build, package install, or systemd unit, and clean up what versions before 0.3.0 installed elsewhere.

## Requirements

### Requirement: The standard plugin command is the whole install
`omarchy plugin add`, enabling the plugin, and loading the shell SHALL be sufficient for a working plugin. Loading SHALL NOT run npm or any package manager, SHALL NOT build anything, SHALL NOT fetch from the network, SHALL NOT write a systemd unit, and SHALL NOT modify the plugin checkout.

#### Scenario: Plugin add alone
- **WHEN** the user runs `omarchy plugin add` with `--enable` on a stock Omarchy
- **THEN** the chip appears, Sign in and Setup work, and once both are done the engine runs, without any further command

### Requirement: The engine is a committed, reproducible bundle
The repository SHALL commit the engine as `dist/cli/main.js`, produced by `npm run build` from the lockfile with every dependency bundled and no native addon. The CI gate SHALL rebuild it and fail when the result differs from the committed file.

#### Scenario: Rebuild matches
- **WHEN** `scripts/ci.sh` runs on a clean checkout
- **THEN** the rebuilt `dist/cli/main.js` is byte-identical to the committed one

### Requirement: Node is found at fixed locations, never on PATH
`bin/proton-drive-sync` SHALL run the bundle with the first Node.js 24 or newer found among `$PROTON_DRIVE_SYNC_NODE`, `/usr/bin/node`, and the newest `~/.local/share/mise/installs/node/*/bin/node`. It SHALL NOT resolve `node` through `PATH`, SHALL drop `NODE_OPTIONS`, `NODE_PATH`, and `NODE_REPL_EXTERNAL_MODULE`, and SHALL NOT use sudo.

#### Scenario: Node is missing or too old
- **WHEN** no candidate is Node.js 24 or newer
- **THEN** the launcher exits non-zero, names Node.js 24, and runs nothing

### Requirement: The shell service owns the engine process
The service SHALL start `bin/proton-drive-sync run --no-tray` only after `doctor` reports the user signed in and configured and no engine running. A clean exit SHALL NOT be restarted: it means another engine already owns the control socket. Other exits SHALL be restarted at most five times within a minute of each other, after which the chip SHALL show the failure and offer a retry.

#### Scenario: An older engine is still running
- **WHEN** a pre-0.3.0 user unit or a terminal already runs the engine
- **THEN** the new `run` exits 0 with a message and the chip reads status from the running engine

### Requirement: Pre-0.3.0 installs are cleaned up once
`scripts/remove-engine` SHALL stop and delete `proton-drive-sync.service`, delete `~/.local/bin/proton-drive-sync`, and delete the runtime directory only when each carries this plugin's marker. The service SHALL run it on load. It SHALL NOT delete the sync folder, `~/.config/proton-drive-sync`, the state database, the audit log, the recycle directory, or the keyring session, and SHALL be a no-op when nothing marked remains.

#### Scenario: A foreign unit is installed
- **WHEN** the unit file exists and does not contain this plugin's marker
- **THEN** it is left in place
