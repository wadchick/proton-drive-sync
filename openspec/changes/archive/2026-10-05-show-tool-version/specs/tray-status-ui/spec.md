## ADDED Requirements

### Requirement: Detail page shows the tool version
The details page SHALL show the word `Version` followed by the package version of the engine process that served the page, under the page title. The line SHALL remain when the live snapshot refreshes. The page SHALL NOT use a Proton API client identity as that version. When that process cannot read its package version, the page SHALL omit the line.

#### Scenario: Open details
- **WHEN** the user opens the details page of a running engine whose package version can be read
- **THEN** the page shows `Version` followed by that version under the title

#### Scenario: Refresh keeps the version
- **WHEN** the live snapshot refreshes while the details page is open
- **THEN** the version line is still the package version of the process that served the page

#### Scenario: Version cannot be read
- **WHEN** the serving process cannot read its package version
- **THEN** the details page omits the version line and still shows the title and the engine state
