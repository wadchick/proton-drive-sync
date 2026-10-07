## ADDED Requirements

### Requirement: Panel shows the tool version
The panel SHALL show the installed engine's package version as the word `Version` followed by that version whenever the version is known. The line SHALL be shown while the engine process is stopped and before a sync pair is saved. The chip label SHALL remain the engine state and SHALL NOT include the version. When the engine command is not installed, the panel SHALL NOT show a version.

#### Scenario: Installed engine is stopped
- **WHEN** the engine command is installed and the engine process is not running
- **THEN** the panel shows `Version` followed by that engine's package version, and the chip label does not include the version

#### Scenario: Before setup
- **WHEN** the engine command is installed and no sync pair is saved
- **THEN** the panel still shows `Version` followed by that engine's package version

#### Scenario: Engine command is missing
- **WHEN** the `proton-drive-sync` command is not available
- **THEN** the panel does not show a version

#### Scenario: Chip stays the sync state
- **WHEN** the engine is syncing with 34 files finished of 5685 and the installed engine's package version is known
- **THEN** the chip label is `Sync (34/5685)` and the version line is on the panel
