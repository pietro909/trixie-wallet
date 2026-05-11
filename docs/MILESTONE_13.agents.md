# Milestone 13: Activity Caching

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

## Technical Strategy: Builder-Loop Caching

Instead of filtering the *inputs* to the history builder (which risks missing updates to old VTXOs, such as spent-status transitions), we optimize the *builder loop* by reusing previously derived rows.

### Threshold Calculation ($T$)

We define a synchronization threshold $T$ (in milliseconds) to determine the point before which history is considered stable:

1.  If the cache has `pending` or `info` activities: $T = \text{earliest timestamp of those rows}$. We must re-evaluate from this point to observe status transitions (e.g., Pending -> Confirmed).
2.  If the cache is entirely `confirmed`: $T = \text{timestamp of the latest confirmed activity}$.
3.  If no cache exists: $T = 0$.

### Optimization Targets

1.  **Row Reuse:** For every candidate activity (Boarding, Commitment, Off-chain Send/Receive), we check the existing cache by ID. If a `confirmed` row exists with a timestamp $< T$, we reuse it immediately.
2.  **Timestamp Caching:** `getActivityHistory` currently performs a network lookup (`getTxCreatedAt`) for every off-chain send without a change output. By reusing cached rows, we eliminate these redundant calls for historical sends.
3.  **SDK Synchronization (Secondary):** While `ContractManager.getContractsWithVtxos()` does not currently take a time window, future optimizations can use `const cm = await wallet.getContractManager(); await cm.refreshVtxos({ after: T });` to reduce the indexer payload.

### Cache Source & Merging

The cache MUST operate on the raw Arkade-derived activities *before* they are merged with Lightning/Boltz swaps. Since `wallet.activities` in the store contains the fully merged feed where some Arkade rows are suppressed (by `mergeActivities`), the implementation MUST:
- **Maintain a stable Arkade-only activity list** (e.g., via a separate store field or by specifically preserving suppressed rows) to ensure historical Arkade data remains available for the builder cache even if currently shadowed by a Lightning row.
- Avoid using a simple filtered subset of the merged `wallet.activities` as the primary cache source, as this would cause permanent data loss of suppressed Arkade rows.

### Precision & Units

- **App Level:** `Activity.timestamp` values are milliseconds (Unix ms).
- **SDK Level:** Timestamps are handled as `Date` objects or milliseconds. Implementation must avoid "seconds vs milliseconds" bugs by using explicit `getTime()` conversions.

## Selected Direction

Introduce an append-friendly activity cache keyed by stable namespaced IDs (e.g., `arkade:offchain:<txid>`).
The cache should support:

- Reusing previously derived `confirmed` rows to skip expensive network calls.
- Re-evaluating `pending` and `info` rows on every refresh.
- Merging in newly discovered rows on refresh.
- Maintaining ID stability across app restarts and store hydration.

## Gaps to Address Before Implementation

**1. No mention of schema migration.**
The store persists as `app_state_v4`. Adding a new field (e.g., `arkadeActivities: Activity[]` on `ArkadeWalletMetadata`) to hold the pre-merge cache requires bumping to `v5` and a migration path. The migration is straightforward — missing field on hydration means empty cache, triggers a full rebuild — but it needs to be explicit. Without it, old state shapes will silently break or mishydrate.

**2. Cache storage is unspecified.**
The plan says "ID stability across app restarts" but never says where the cache lives. The two options with different trade-offs:
- New field on `ArkadeWalletMetadata` in AsyncStorage (persists across restarts, survives hydration, free ride on existing persistence path, but inflates the state blob)
- Separate AsyncStorage key per wallet ID (cleaner separation, easier to purge independently, slightly more code)

Either works but the choice should be explicit, because it affects the schema migration and the hydration logic.

**3. `buildActivities` has 8 callsites.**
`buildActivities` is called from wallet creation, `refreshWallet`, `resumeLightning`, and all send operations (`sendArkade`, `sendLightning`, `sendOnchain`, `sendChainSwap`). The cache needs to thread through all of them. The implementation should decide up-front: does `buildActivities` read/write the cache itself (store-aware), or is the cache a parameter? Currently `buildActivities` is a plain async function; making it store-aware requires a different signature.

**4. `"info"` status in T calculation is unnecessarily conservative.**
`settlement` rows always have status `"info"` and they never change — they're a snapshot of an ambiguous commitment state at creation time. Including them in T means T = earliest settlement timestamp, which could be very old and would force re-evaluation of many rows that are genuinely stable. Since settlement rows don't call `getTxCreatedAt` (they're commitment-based, no network overhead), they cost nothing to re-evaluate. The smarter rule is T = earliest `"pending"` row only, with `"info"` rows always re-evaluated (cheap) but not used to drag T backward.

**5. No invalidation rules specified.**
"Explicit and boring" is a good principle but the actual rules are not written down. At minimum the implementation should state: confirmed rows are never invalidated (only appended to or shadowed); the cache is wiped on `resetWallet()`; nothing else invalidates it.

## Minor Observations

- The `getTxCreatedAt` network call only fires when `changes.length === 0` (no change output on an off-chain send, see `activity-history.ts`). For any send with change, the timestamp comes from `changes[0].createdAt.getTime()` which is free. The cache benefit is specifically for no-change sends — worth keeping in mind when measuring impact.
- The secondary optimization (`cm.refreshVtxos({ after: T })`) is correctly deferred. The SDK does not support it yet and adding it now would couple this milestone to an upstream change.
