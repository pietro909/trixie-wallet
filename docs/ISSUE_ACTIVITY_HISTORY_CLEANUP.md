# Activity History Cleanup

## Status
Planned

## Goal
Reduce avoidable work inside `getActivityHistory` and `buildActivityHistory` without changing Activity semantics.

This is the smaller 17a cleanup that should land before Activity Checkpoints. It should make the current full-history refresh path cheaper and make the future checkpoint live-tail path cheaper, while preserving the exact Activity rows the app emits today.

## Context
Milestone 13 already added two important optimizations:

- no-change off-chain send timestamps are cached in `arkade_tx_timestamps`;
- confirmed Arkade rows can be reused through `previousActivities`.

The remaining low-risk cleanup is inside `app/services/arkade/activity-history.ts`:

- `buildActivityHistory` repeatedly scans the sorted VTXO array with `filter`;
- `getActivityHistory` constructs `ExpoIndexerProvider` before knowing whether a timestamp cache miss exists;
- no-change send timestamp misses are resolved one row at a time;
- some confirmed-row reuse can be moved earlier once candidate Activity ids are known.

The value is modest but real: less CPU work on every refresh, fewer unnecessary indexer objects/calls, and a cleaner builder shape before Activity Checkpoints introduce a frozen-prefix/live-tail split.

## Non-Goals
- Do not add Activity checkpoint storage.
- Do not make frozen rows an emission source.
- Do not skip `wallet.getContractManager().getContractsWithVtxos()` or `wallet.getBoardingTxs()` for old history.
- Do not change Activity ids, titles, statuses, metadata, amounts, ordering, or dedupe behavior.
- Do not change backup, reset, or restore behavior.
- Do not add migrations or persisted state.

## Implementation Plan

### Phase 1: Baseline And Guardrails
- Run the focused Activity history suite before editing:
  - `pnpm test -- app/services/arkade/__tests__/activity-history.helpers.test.ts app/services/arkade/__tests__/activity-history.builder.test.ts app/services/arkade/__tests__/activity-history.cache.test.ts app/services/arkade/__tests__/activity-history.parity.test.ts app/services/arkade/__tests__/activity-history.divergences.test.ts app/services/arkade/__tests__/activity-history.trixie.test.ts --runInBand`
- Add or update a tiny test helper only if needed. Avoid broad fixture rewrites.
- Keep the current public exports stable unless a new pure helper makes tests meaningfully clearer.

### Phase 2: Pre-Index Builder Inputs
Introduce local indexes inside `buildActivityHistory` after `sorted` is created:

- `vtxosBySettledBy: Map<string, VirtualCoin[]>` for commitment inputs.
- `leafVtxosByFirstCommitment: Map<string, VirtualCoin[]>` for commitment outputs.
- `vtxosByArkTxId: Map<string, VirtualCoin[]>` for all spent VTXOs in the same off-chain send.
- `vtxosByTxid: Map<string, VirtualCoin[]>` for change/output lookup.

Do not add a `boardingTxsByAmount` index. `findBoardingMatch` intentionally scans `allBoardingTxs` in original order and claims the first unused matching amount; duplicate-amount boarding transactions must keep that ordering. The list is small enough that a linear scan is the safer choice.

Replace repeated `sorted.filter(...)` calls with indexed lookups. Preserve insertion/order semantics by building indexes from `sorted` in order and returning `[]` for misses.

Do not optimize by changing decomposition rules. The output must remain byte-for-byte equivalent for existing tests.

### Phase 3: Lazy Indexer Construction
Change `getActivityHistory` so `ExpoIndexerProvider` is created only when a no-change off-chain send has a timestamp cache miss.

Current shape:

- `getActivityHistory` imports/constructs `ExpoIndexerProvider` before `buildActivityHistory`.
- `getTxCreatedAt` checks `tx-cache`, then queries the indexer.

Target shape:

- Import `getTimestamp`/`saveTimestamp` eagerly enough for cache checks.
- Extract a small injectable timestamp resolver factory before implementing the lazy indexer path. The factory should accept cache functions and an indexer loader/constructor, then return `getTxCreatedAt(txid)`.
- Keep a local `indexerPromise`/`indexer` initialized lazily inside the resolver factory.
- Only import/construct `ExpoIndexerProvider` after `getTimestamp(txid)` returns `undefined`.
- Preserve best-effort behavior: indexer failure returns `undefined`, and the builder falls back to `v.createdAt.getTime() + 1`.

### Phase 4: Defer Batch Timestamp Fetching Pending Spike
Defer batching by default. The current SDK/indexer shape has two hazards that can erase the win or weaken correctness:

- Pagination: `IndexerProvider.getVtxos` returns `{ vtxos: VirtualCoin[], page?: PageResponse }`, so a large outpoint batch may require multiple round-trips. That defeats the intended single-call win.
- Per-outpoint mapping: the response does not include an explicit per-input correlation record. Mapping a result back to a requested timestamp relies on returned `VirtualCoin` outpoint fields such as `txid`/`vout`. The current 1-by-1 lookup requests `{ txid, vout: 0 }`, which already assumes the recipient VTXO sits at vout 0; mixing many such assumptions into one response makes mis-association harder to reason about.

Only implement batching if a quick spike confirms all of the following:

- normal wallet-size missing timestamp batches fit in a single response page with the adapter defaults, or pagination still saves meaningful calls;
- returned VTXOs can be matched back to requested outpoints by exact outpoint, independent of response order;
- missing or mismatched outpoints degrade to the existing per-row fallback without attaching the wrong timestamp;
- successful timestamps are saved individually, and partial failures do not fail the whole refresh.

If the spike is not clearly positive, skip batching. Lazy construction plus pre-indexing is enough for this issue.

Spike result on 2026-05-22: positive for the current SDK shape. `RestIndexerProvider.getVtxos` serializes multiple `outpoints` in one request, returned `VirtualCoin`s include `txid` and `vout`, and the SDK service-worker history path already batches uncached timestamp lookups in chunks of 100. The app implementation therefore batches no-change send timestamp misses in chunks of 100, follows pagination when present, attaches timestamps only after exact `{ txid, vout: 0 }` matching, saves found timestamps individually, and lets missing, mismatched, or failed chunks retry through the per-row resolver before using the existing `v.createdAt + 1` fallback.

### Phase 5: Confirmed-Row Reuse Regression Checks
Keep the existing rule: only rows from `previousActivities` with `status === "confirmed"` may be reused.

Preserve the existing early reuse checks where the candidate id is known before expensive work:

- no-change BTC sends: check `arkade:offchain:<arkTxId>` before timestamp lookup;
- asset sends: verify the existing `arkade:asset:<arkTxId>` short-circuit stays before timestamp, amount, and `buildAssetActivity` work. Selecting the id still requires the asset-delta check;
- simple off-chain receives: after `collectAssets` identifies the row as BTC-only, check `arkade:offchain:<txid>` before constructing metadata;
- asset receives: after `collectAssets` identifies the row as asset-bearing, check `arkade:asset:<txid>` before `buildAssetActivity`;
- commitment groups: only if the id is unambiguous and the branch is already known. Do not reuse a prior row to decide the branch.

The receive-side wins are marginal CPU only: the row kind cannot be known until after `collectAssets`, but reuse can still skip metadata construction or asset row construction.

Never reuse pending, info, failed, or refunded rows in `buildActivityHistory`. This issue is about Arkade builder reuse, not Lightning terminal-row checkpointing.

## Test Plan

The current Activity history tests are intentionally split by facet. Keep that split:

- pure helper/index tests in `activity-history.helpers.test.ts` or a new `activity-history.indexes.test.ts`;
- row-shape and branch behavior in `activity-history.builder.test.ts`;
- reuse and timestamp short-circuit behavior in `activity-history.cache.test.ts`;
- fixture parity in `activity-history.parity.test.ts`;
- intentional behavior differences in `activity-history.divergences.test.ts`;
- Trixie-specific edge cases in `activity-history.trixie.test.ts`.

### A. Output Parity Regression Coverage
These tests prove the cleanup is behavior-preserving:

- Run the full existing Activity history suite.
- Add a helper assertion that compares pre/post outputs only if a local fixture harness makes that practical. Prefer explicit assertions over snapshot churn.
- Preserve ordering assertions in parity tests, especially payment-row order after deterministic sort.
- Preserve duplicate-id checks in `activity-history.trixie.test.ts`.
- Preserve wallet-event invariants: wallet events must not carry `amountSats`, and `source.eventId === id`.

Required command before this issue is considered complete:

```bash
pnpm test -- app/services/arkade/__tests__/activity-history.helpers.test.ts app/services/arkade/__tests__/activity-history.builder.test.ts app/services/arkade/__tests__/activity-history.cache.test.ts app/services/arkade/__tests__/activity-history.parity.test.ts app/services/arkade/__tests__/activity-history.divergences.test.ts app/services/arkade/__tests__/activity-history.trixie.test.ts app/services/arkade/__tests__/activity-history.resolver.test.ts app/services/arkade/__tests__/tx-cache.test.ts --runInBand
```

### B. Index Helper Tests
If indexes are extracted into pure helpers, cover them directly:

- Empty VTXO list returns empty maps.
- VTXOs without `settledBy`, `arkTxId`, `txid`, or `commitmentTxIds` are skipped by the relevant index only.
- Multiple VTXOs with the same `settledBy` preserve sorted input order.
- Multiple leaf VTXOs with the same first commitment preserve sorted input order.
- A VTXO with multiple commitment ids is indexed only by `commitmentTxIds[0]`, matching current builder semantics.
- `arkTxId` grouping includes all spent VTXOs for that send.
- `txid` grouping supports change lookup without dropping duplicate txids.

If indexes remain local inside `buildActivityHistory`, cover the same cases through builder tests instead of exporting helpers solely for tests.

### C. Builder Branch Regression Tests
Add synthetic cases only where pre-indexing could change behavior:

- Multi-input off-chain send aggregates all spent VTXOs with the same `arkTxId`.
- Off-chain send with change still subtracts change outputs found by `txid === arkTxId`.
- No-change send still uses `getTxCreatedAt` fallback order: fetched timestamp, then `v.createdAt + 1`.
- Commitment group with multiple spent and created VTXOs still emits the same renewal/receive/exit rows.
- Boarding settlement fallback still claims each boarding tx at most once for duplicate amounts.
- Boarding-mixed renewal still emits renewal plus `boarding_settled` exactly as before.
- Asset send/receive paths still emit `arkade:asset:<txid>` ids and preserve `assets` deltas as strings.
- Empty commitment groups and `empty_group` settlement still emit nothing.

### D. Previous-Activity Reuse Tests
Extend `activity-history.cache.test.ts`:

- Confirmed no-change BTC send is reused and `getTxCreatedAt` is not called.
- With `previousActivities` populated for a representative all-confirmed history, current confirmed rows are reused broadly and `getTxCreatedAt` is never called.
- Confirmed asset send reuse remains before timestamp, amount, and `buildAssetActivity` work; selecting the row id still requires the asset-delta check.
- Confirmed simple receive is reused verbatim.
- Confirmed asset receive is reused verbatim.
- Pending/info/failed/refunded prior rows are not reused and current rows are recomputed.
- A stale prior row with no matching current source data is not emitted.
- A prior confirmed row with the same id but wrong source type is not reused if the current branch would not emit that id. If current behavior does not validate source type, document that and add a follow-up rather than silently changing behavior.

### E. Lazy Indexer Tests
Test the injectable timestamp resolver factory directly. Do not rely on Jest mocking dynamic imports for the primary coverage; that path is brittle under `jest-expo`.

Cases to pin:

- No no-change sends: `ExpoIndexerProvider` is not imported/constructed.
- No-change sends with cached timestamps: provider is not constructed.
- One no-change send with a cache miss: provider is constructed once.
- Multiple no-change sends with misses: provider is constructed once and reused.
- Indexer lookup failure returns `undefined` and the emitted timestamp falls back to `v.createdAt + 1`.
- `saveTimestamp` is called only when an indexer timestamp is found.
- Cache lookup errors are treated as misses, preserving current best-effort behavior.

Keep any `getActivityHistory` dynamic-import test as optional smoke coverage only if it stays straightforward. The durable contract belongs on the resolver factory.

### F. Optional Batch Fetch Tests
Only add these if Phase 4 batching is implemented after the spike:

- Duplicate missing txids are fetched once.
- Mixed cache hits/misses fetch only misses.
- Single-page and paginated responses are handled intentionally, or batching is disabled when pagination would be required.
- Batch response order does not matter; timestamps attach only after exact requested-outpoint matching.
- Missing or mismatched outpoints fall back without saving or attaching the wrong timestamp.
- Partial batch results save found timestamps and fall back for missing ones.
- Batch failure falls back without throwing.
- Batching does not change Activity ordering.

### G. Performance/Complexity Guard Tests
Avoid brittle wall-clock tests. Prefer call-count or operation-count proxies:

- For a synthetic large wallet fixture, instrument the timestamp resolver and assert timestamp calls equal the number of uncached no-change sends, not total VTXOs.
- If index helpers are exported in test-only form, assert each index is built with one pass over `sorted`.
- Avoid asserting exact internal loop counts unless the helper API naturally exposes them. The main regression signal is unchanged output plus fewer external timestamp/indexer calls.

## Acceptance Criteria
- Existing Activity history helper/builder/cache/parity/divergence/trixie tests pass.
- New tests cover the index/pre-index behavior or the equivalent builder-visible branches.
- New tests pin lazy indexer construction.
- With `previousActivities` populated and all rows confirmed, `getTxCreatedAt` is never invoked and `ExpoIndexerProvider` is not constructed.
- New tests pin that pending/info rows are never reused.
- No Activity row shape changes are required in fixtures or UI code.
- No backup, reset, restore, or schema-version changes.

## Relationship To Milestone 17
This issue is **not** Activity Checkpoints. It does not freeze history, emit checkpoint rows, or skip old SDK source calls.

Milestone 17 remains responsible for the larger behavior change: local checkpoint rows become an emission source and refresh derives only the live tail after a safe frontier.
