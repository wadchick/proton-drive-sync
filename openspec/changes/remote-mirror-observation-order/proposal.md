# Proposal

## Why

Concurrent full listings, event re-reads, and verified engine changes can publish remote nodes out of order. An older observation can overwrite a newer one, causing reconciliation to plan from stale Proton state; overlapping listings and a backwards `asOf` make the problem worse.

## What Changes

- Order all remote mirror observations with per-node read stamps and retain temporary deletion tombstones while older reads are in flight.
- Merge completed listings instead of replacing the mirror, including safe handling of nodes absent from a complete listing.
- Coalesce overlapping full refresh requests into one active listing and at most one follow-up listing.
- Keep the remote freshness watermark monotonic and add deterministic concurrency regressions.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `remote-drive-access`: the engine's published remote view must preserve the newest observed node state across concurrent reads and removals, and refresh requests must be coalesced.

## Impact

`src/engine/remoteMirror.ts`, `src/engine/views.ts`, engine refresh callers, and mirror/engine tests. No database migration, dependency, or remote API change.
