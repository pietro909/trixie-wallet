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

## Selected Direction

Introduce an append-friendly activity cache keyed by wallet id plus source ids.
The cache should support:

- reusing previously derived rows;
- merging in newly discovered rows on refresh;
- rebuilding from scratch when the schema changes;
- keeping the feed consistent even when the app restarts mid-refresh.

