# Tasks

## 1. Observation ordering

- [x] 1.1 Add stamped node and removal merge rules to the mirror, including bounded tombstones; verify deterministic event, own-change, and folder-removal interleaving tests.
- [x] 1.2 Collect per-folder stamped listings and merge only complete results; verify older listings and event reads cannot overwrite newer data or erase newer nodes, and failed listings publish nothing.
- [x] 1.3 Stamp verified executor changes at the start of their verifying read; verify an older own-change result cannot overwrite a newer event or listing.

## 2. Refresh scheduling and freshness

- [x] 2.1 Coalesce full refresh calls across all engine callers; verify one listing runs at a time and concurrent requests share one follow-up even after failure.
- [x] 2.2 Make the remote `asOf` watermark monotonic; verify a poll completing during a listing cannot be reversed.

## 3. Integration check

- [x] 3.1 Run OpenSpec strict validation, typecheck, lint, focused mirror and engine tests, and the repository CI test stages; verify they pass, regenerate the tracked bundle, and review the diff. The CI script's final clean-bundle check is expected to fail until these changes are committed.
