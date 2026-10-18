# Design

## Context

See proposal.md. `RemoteMirror` currently replaces its map after each listing, replays own changes, and tracks every own-changed UID indefinitely. The feed and listing timer can update the mirror while cycles run. The mirror's `view()` already copies planning data.

## Goals / Non-Goals

**Goals:** Give every observation a comparable read-start order, keep incomplete reads unpublished, and bound state used to reject stale results.

**Non-Goals:** Change the reconciler, persist mirror state, serialize network I/O with the engine's exclusive turn, or infer server commit order from request timing.

## Decisions

1. Use one monotonic counter in the mirror. A read reserves a stamp before network I/O. Each node carries its last accepted stamp. Removals carry temporary tombstones. Applying a node or removal with an older stamp is ignored. An own change uses the stamp of its verifying read where available; a mutation response that returns the node itself is stamped when it arrives.
2. Collect a full listing before publishing it. Each folder's children carry the stamp reserved before that folder read; the root uses its own read stamp. An absent prior node is removed only if its stamp precedes the listing start. This prevents a complete old listing from removing a newer node, while failed listings change no nodes.
3. Track in-flight read starts. Retain a tombstone only while a read older than the tombstone can still finish. A folder removal marks known descendants too. Drop all tombstones when no reads remain.
4. Put refresh coalescing in `RemoteMirror.fullRefresh()` so startup, timer, feed, and cycle all share it without changing their public call sites. A request made during an active listing joins one queued follow-up; that follow-up starts after the active listing settles, including after failure.
5. Keep `asOf` as a time value for the existing stale-view guard, advancing it with `Math.max` after successful listings and polls. Read stamps are only for ordering, not time.

## Risks / Trade-offs

- [A later request can receive stale server data] → Read-start order is an approximation; subsequent events and listings correct it. Do not claim a stamp proves server freshness.
- [A listing may collect a mixed-time tree] → Stamp children by folder read and merge only after the complete listing succeeds. Preserve newer per-node observations and retain the existing completeness gate on failure.
- [Tombstones or queued refresh promises could linger] → Clean them in `finally`; test failures and overlapping requests.

## Migration Plan

No persistent state changes. Deploy with the mirror and tests together. Rollback is a source revert.
