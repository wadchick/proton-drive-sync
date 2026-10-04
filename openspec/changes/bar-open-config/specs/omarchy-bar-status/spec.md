## ADDED Requirements

### Requirement: Panel opens the sync config file
The panel SHALL offer **Open config** in the same row as Open folder and Open details. When Open details is shown, Open config SHALL sit immediately after it. Choosing Open config SHALL open the stored sync config file the same way the panel opens the sync folder, and SHALL open that file rather than its directory. The action SHALL be shown once a config file is stored, including while the engine is not running, and SHALL be absent when no config file is stored. Choosing it SHALL NOT write the config file, SHALL NOT start a login, and SHALL NOT restart the engine. Open details SHALL remain available only while the engine is running.

#### Scenario: Open config beside Open details
- **WHEN** a config file is stored and the engine is running
- **THEN** the panel shows Open config immediately after Open details, and choosing it opens the stored sync config file

#### Scenario: Engine is not running
- **WHEN** a config file is stored and the engine is not running
- **THEN** the panel shows Open config and does not show Open details

#### Scenario: Config is stored outside the default directory
- **WHEN** the stored config file is not in the default config directory
- **THEN** Open config opens that stored file

#### Scenario: Nothing is configured yet
- **WHEN** no config file is stored
- **THEN** the panel does not show Open config

#### Scenario: Choosing Open config leaves the engine alone
- **WHEN** the user chooses Open config
- **THEN** the config file is not written, no login starts, and the engine is not restarted
