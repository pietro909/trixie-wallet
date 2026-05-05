# Milestone 10: Activity Caching

Goal: cache immutable wallet history so the activity feed is fast, stable, and
available across refreshes without recomputing the entire history every time.

This milestone should prove:

- Activity ids remain stable across refreshes and restarts.
- Immutable history is cached once and reused.
- The app only recomputes what changed, not the full history surface.
- Live balances and volatile state stay out of the cache.

## Current State

- `app/store/types.ts` already models Activity as persisted app state.
- `app/screens/ActivityScreen.tsx` renders the current `wallet.activities`
  array directly.
- `app/services/arkade/activity-history.ts` is already the history-builder
  layer for deriving user-visible rows.

## Product Rules

- Cache immutable rows and deterministic enrichment only.
- Do not cache current balance, server status, or transient claim/refund state
  as if it were historical truth.
- Preserve chronological ordering and stable ids.
- Make cache invalidation explicit and boring.

## Research Findings: Synchronization Threshold

The "blockchain is immutable" principle allows us to avoid re-fetching and re-processing the entire wallet history. We can define a synchronization threshold $T$ to separate cached immutable history from volatile or new state.

### Threshold Calculation

The threshold $T$ is the point in time before which history is considered stable:

- If the cache has `pending` activities: $T = \text{timestamp of the earliest pending activity}$. We must re-sync from this point to observe status transitions (e.g., Pending -> Confirmed).
- If the cache is entirely `confirmed`: $T = \text{timestamp of the latest confirmed activity}$.
- If no cache exists: $T = 0$.

### Optimization Targets

1.  **Indexer Filtering:** The SDK's `IndexerProvider.getVtxos` supports an `after` parameter (Unix timestamp). By passing $T$, we reduce the payload from the Arkade indexer to only include new or potentially updated VTXOs.
2.  **Boarding Filtering:** Filter `wallet.getBoardingTxs()` results against the cache threshold to avoid re-processing old on-chain deposits.
3.  **Timestamp Caching:** `getActivityHistory` currently performs a network lookup for every off-chain send without a change output to find its `createdAt` time. Caching these timestamps in the activity row eliminates these redundant calls.

## Selected Direction

Introduce an append-friendly activity cache keyed by wallet id plus source ids.
The cache should support:

- reusing previously derived rows;
- merging in newly discovered rows on refresh;
- rebuilding from scratch when the schema changes;
- keeping the feed consistent even when the app restarts mid-refresh.

