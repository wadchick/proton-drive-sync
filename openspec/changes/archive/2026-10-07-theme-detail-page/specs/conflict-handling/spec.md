## MODIFIED Requirements

### Requirement: Conflict inbox and resolution
The system SHALL maintain a list of unresolved conflicts with both versions' metadata and SHALL let the user resolve each by keeping local, keeping remote, or keeping both. A delete-versus-edit conflict SHALL be the exception: its edit was already kept on both sides when it was recorded, so keeping local or keeping remote SHALL be refused with an error and the entry SHALL stay open, and keeping both SHALL close the entry without any file operation. A resolution's file changes SHALL be executed as normal journaled operations, and a version that a resolution replaces or discards SHALL be recycled or trashed, never permanently deleted.

#### Scenario: Keep remote
- **WHEN** the user chooses "keep remote" for a content or create-create conflict
- **THEN** the local conflict copy is moved to the recycle directory and its remote copy is trashed

#### Scenario: Keep both
- **WHEN** the user chooses "keep both" for a conflict other than delete-versus-edit
- **THEN** the conflict is marked resolved and both files remain synced as independent items

#### Scenario: Delete-versus-edit is acknowledged
- **WHEN** the user chooses "keep both" for a delete-versus-edit conflict
- **THEN** the conflict is marked resolved and no file is moved, recycled, or trashed

#### Scenario: Delete-versus-edit has no version to choose
- **WHEN** the user chooses "keep local" or "keep remote" for a delete-versus-edit conflict
- **THEN** the choice is refused with an error and the conflict stays open
