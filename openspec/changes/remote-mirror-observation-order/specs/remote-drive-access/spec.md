# Spec Delta

## ADDED Requirements

### Requirement: Publish remote observations in read order
The system SHALL retain the newest available observation of each remote node when full listings, event reads, and verified engine changes overlap. A completed full listing SHALL merge its nodes and absences without replacing observations made after the listing began. An incomplete listing SHALL publish no partial tree.

#### Scenario: Event handled during a listing
- **WHEN** a listing reads a node, an event then observes a newer version, and the listing completes last
- **THEN** the published node retains the event's version

#### Scenario: Older event completes after listing
- **WHEN** an event read begins before a listing and returns after the listing published a newer version
- **THEN** the older event result is ignored

#### Scenario: Removal while an older read is in flight
- **WHEN** a node or folder is removed while an older read of it or its descendants is in flight
- **THEN** the older read cannot restore the removed nodes

#### Scenario: Listing omits a node changed after it started
- **WHEN** a complete listing omits a node created or updated after the listing began
- **THEN** the newer node remains in the published view

#### Scenario: Listing fails
- **WHEN** a folder read fails during a full listing
- **THEN** no partial listing is published and the remote view is marked incomplete and unavailable

### Requirement: Bound remote observation history
The system SHALL retain deletion ordering information only while an older remote read is in flight, and SHALL release it when no such read remains.

#### Scenario: Reads settle
- **WHEN** all overlapping reads finish after removals
- **THEN** no deletion ordering records remain for those removals

### Requirement: Coalesce remote full listings
The system SHALL run at most one full remote listing at a time. A refresh request arriving after that listing starts SHALL receive the result of one subsequent listing; multiple such requests SHALL share that subsequent listing.

#### Scenario: Multiple requests during a listing
- **WHEN** the timer and event feed request refresh while another listing is in progress
- **THEN** they cause one follow-up listing and never overlap the active listing

### Requirement: Keep remote freshness monotonic
The system SHALL never move the remote view's freshness watermark backwards when a full listing or completed event poll publishes its start time.

#### Scenario: Poll completes during a listing
- **WHEN** a completed poll advances the freshness watermark while a listing remains in flight
- **THEN** completing the listing does not reduce that watermark
