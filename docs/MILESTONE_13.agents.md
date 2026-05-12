# Milestone 13: Activity Caching

Goal: Make the activity feed nearly instantaneous by caching expensive network-resolved data (timestamps) and reusing stable, confirmed activity rows from the store.

This milestone should prove:
- The activity feed loads and refreshes without a sequential network "crawl" for historical timestamps.
- Confirmed activity rows are stable across app restarts and refreshes.
- No-change off-chain sends (the most expensive rows to build) are specifically optimized.
- The cache invalidation is simple and transparent (e.g., wipe on wallet reset).

## Current State

### Performance Bottleneck
- `app/services/arkade/activity-history.ts` fetches timestamps for every off-chain send without a change output.
- These fetches are performed via `indexer.getVtxos()` (one network call per row).
- As history grows, `getActivityHistory` slows down linearly with the number of "no-change" sends.

### Stability
- Activity IDs are already deterministic (e.g., `arkade:offchain:<txid>`).
- Activities are currently stored in `wallet.activities` in the app store, but they are fully recomputed and replaced on every refresh, losing the benefit of the persistent store.

## Implementation Plan (Minimum Effort, Highest Impact)

### Phase 1: Durable Timestamp Cache
- [ ] **SQLite Table**: Create a simple `arkade_tx_timestamps` table in the shared database mapping `arkTxid (string)` to `timestamp (number)`.
- [ ] **Service**: Implement `app/services/arkade/tx-cache.ts` with `getTimestamp(txid)` and `saveTimestamp(txid, ts)` helpers.
- [ ] **Integration**: Update `getActivityHistory` to check the local cache before calling the indexer. If found, skip the network call.

### Phase 2: Confirmed Row Reuse
- [ ] **Builder Input**: Update `buildActivityHistory` to accept an optional `previousActivities: Activity[]` array (sourced from the store).
- [ ] **Logic**: If an activity being built (e.g., an off-chain send or boarding settlement) matches an ID in `previousActivities` AND that previous row is `confirmed`, reuse it verbatim.
- [ ] **Benefit**: This skips not just the timestamp fetch, but the entire metadata derivation logic for history. Since `confirmed` Arkade rows are terminal, this is safe.

### Phase 3: Invalidation & Schema
- [ ] **Status Transition**: Ensure `pending` rows are ALWAYS recomputed (never reused from cache) so they can transition to `confirmed`.
- [ ] **Reset**: Ensure `clearAllWalletData` also wipes the `arkade_tx_timestamps` table.
- [ ] **Schema**: No schema bump required—we are reusing the existing `activities` field in the store more effectively.

## Why this is "Minimum Effort"
1. **No Complex Thresholds**: We don't need a "Threshold $T$" if we just check status. If it's `confirmed`, it's stable.
2. **Immutable Focus**: Timestamps never change. Caching them is "zero-risk".
3. **Store Leverage**: We use the data we already have (the hydrated store) as a reference for the builder.

## Why this is "Highest Impact"
1. **Network Bound**: Performance is 99% network-bound by the indexer calls. This eliminates them.
2. **Linear to Constant**: A wallet with 500 historical sends will refresh as fast as a wallet with 5.
3. **Stability**: Reusing objects directly from the store ensures the UI doesn't "flicker" or re-sort if timestamps were slightly different due to indexer lag.
