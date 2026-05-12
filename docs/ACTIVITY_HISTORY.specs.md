# ACTIVITY_HISTORY — Specification

Reference implementation: `app/services/arkade/activity-history.ts`.
Source milestone: [docs/MILESTONE_3.agents.md](./MILESTONE_3.agents.md).

This document is the testable contract for the app-owned Activity builder. Each
numbered subsection is intended to map 1:1 to a future unit test case.

---

## 0. Scope

The Activity builder converts wallet VTXO/boarding state into a chronological
list of user-facing `Activity` rows (`app/store/types.ts`). It is the app-owned
replacement for `Wallet.getTransactionHistory()` from the SDK and the input to
`mergeActivities` (which folds in Lightning-swap rows).

Inputs (all derived from a synced `Wallet`):

- `wallet.getContractManager().getContractsWithVtxos()` — all VTXOs.
- `wallet.getBoardingTxs()` — boarding transactions + `commitmentsToIgnore`
  set (commitments that consumed boarding outputs).
- `ExpoIndexerProvider(arkServerUrl).getVtxos({ outpoints })` — used solely as
  a fallback for offchain-send timestamps with no change VTXO.

Outputs:

- An array of `Activity` rows sorted by `timestamp` descending (newest first).

Out of scope (must not be touched by this module):

- Lightning rows (added by `swap-mappers.ts`).
- Persistence, hydration, store mutation.
- Asset metadata enrichment, balances, icons.
- Anything React Native or store-aware.

---

## 1. Public API

### 1.1 `getActivityHistory(wallet, arkServerUrl, options?)`

```ts
function getActivityHistory(
  wallet: Wallet,
  arkServerUrl: string,
  options?: GetActivityHistoryOptions,
): Promise<Activity[]>;

type GetActivityHistoryOptions = {
  network: string | null;          // stamped onto every row's metadata.network
  boardingAddress?: string | null; // stamped onto boarding rows
  arkadeAddress?: string | null;   // stamped onto inbound rows
};
```

- **MUST** default `options` to `{ network: null }` when not provided.
- **MUST NOT** throw when `arkServerUrl` is reachable but returns no
  outpoints for a given txid (the indexer call has a `.catch(() => undefined)`
  guard). Indexer failures degrade to the `vtxo.createdAt + 1` timestamp
  fallback, not to a rejected promise.
- **MUST** be the only async surface. All pure helpers (§3) are synchronous.

### 1.2 Exported pure helpers

The following are exported for testability and must remain pure (no I/O, no
clock, no globals):

- `activityId(kind, idValue) → string`
- `sumValue(vtxos) → bigint`
- `collectAssets(vtxos) → Asset[]`
- `subtractAssets(spent, received) → Asset[]`
- `assetDeltas(spent, received) → Asset[]` (alias of `subtractAssets`)
- `decomposeCommitmentGroup({ spent, created, isBoardingMixed }) → CommitmentDecomposition`
- `isRenewalGroup({ spent, created, isBoardingMixed }) → boolean`
- `classifyAssetActivity({ direction, anchorSats, assetDelta }) → AssetClassification`

Identifier kinds (`ActivityIdKind`):
`"boarding" | "boarding_settled" | "offchain" | "batch" | "exit" | "renewal" | "settlement" | "asset"`.

---

## 2. ID Convention

All IDs are namespaced strings of the form `arkade:<kind>:<idValue>`.

### 2.1 Determinism

- `activityId(kind, id)` **MUST** produce byte-identical output for the same
  arguments across calls, restarts, and processes.
- IDs **MUST** be derived only from protocol identifiers (boarding txid,
  Arkade txid, commitment txid). Never timestamps, indices, or array order.

### 2.2 Per-row ID source

| Activity                | Kind                  | `idValue`         |
| ----------------------- | --------------------- | ----------------- |
| Boarding deposit        | `boarding`            | boarding txid     |
| Boarding settled        | `boarding_settled`    | commitment txid   |
| Arkade received (batch) | `batch`               | commitment txid   |
| Collaborative exit      | `exit`                | commitment txid   |
| VTXO renewed            | `renewal`             | commitment txid   |
| Arkade settlement       | `settlement`          | commitment txid   |
| Offchain receive / send | `offchain`            | arkTxid           |
| Asset activity          | `asset`               | arkTxid           |

### 2.3 Collision safety

- Renewal/settlement/asset IDs (wallet-event rows) **MUST NOT** collide with
  payment IDs, even if the same string appears as both a commitment txid and
  an Arkade txid (the namespace prefix differs).
- Merge-side filtering against Lightning swaps **MUST** rely on namespaced
  IDs, not on raw txid sets (consumer responsibility — documented here so the
  invariant is testable).

---

## 3. Pure Helpers

### 3.1 `activityId(kind, idValue)`

- Returns the literal `` `arkade:${kind}:${idValue}` ``.
- Does not validate `idValue`. Empty string is allowed (caller's contract).

### 3.2 `sumValue(vtxos)`

- Returns `0n` for an empty array.
- Returns `BigInt(v.value)` summed across all entries.
- Accepts numeric `v.value` from the SDK without overflow (bigint
  promotion).

### 3.3 `collectAssets(vtxos)`

- Returns `[]` when no vtxo has a non-empty `assets` array.
- Sums per-`assetId` amounts across all input vtxos.
- **MUST** skip vtxos with `undefined` / missing `assets`.
- **MUST** drop entries whose summed amount is exactly `0n`.
- Output order is iteration order of the underlying `Map`; tests that compare
  order should sort by `assetId` first.

### 3.4 `subtractAssets(spent, received)` / `assetDeltas`

- Computes `received − spent` per asset id.
- **Sign convention**: positive = received by wallet, negative = sent.
- Mirrors the SDK's `subtractAssets(spent, change)` semantics.
- **MUST** drop zero-net entries.
- **MUST** handle assets present on only one side (returns the lone value
  with the correct sign).

### 3.5 `decomposeCommitmentGroup({ spent, created, isBoardingMixed })`

Returns a tagged union. Branches **MUST** be evaluated in this order — the
test cases below match the ordering:

| Step | Condition                                                                                                        | Result                                                                              |
| ---- | ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| 1    | `spent.length === 0 && created.length === 0`                                                                     | `settlement { reason: "empty_group" }`                                              |
| 2    | `isBoardingMixed && spent>0 && created>0 && createdAmount ≥ spentAmount && no asset delta`                       | `renewal { spentAmount, createdAmount }`                                            |
| 3    | `isBoardingMixed` (otherwise)                                                                                    | `settlement { reason: "boarding_mixed_unresolved" }`                                |
| 4    | Non-boarding, asset delta present                                                                                | `settlement { reason: "asset_bearing_settlement" }`                                 |
| 5    | Non-boarding, `spentAmount === 0n && createdAmount > 0n`                                                         | `batch_receive { createdAmount }`                                                   |
| 6    | Non-boarding, `spentAmount > 0n && createdAmount === 0n`                                                         | `exit { spentAmount }`                                                              |
| 7    | Non-boarding, `delta === 0n`                                                                                     | `renewal { spentAmount, createdAmount }`                                            |
| 8    | Non-boarding, `delta > 0n`                                                                                       | `renewal_plus_receive { renewalAmount: spentAmount, receiveAmount: delta }`         |
| 9    | Non-boarding, `delta < 0n`                                                                                       | `renewal_plus_exit { renewalAmount: createdAmount, exitAmount: -delta }`            |

Notes for tests:

- Branches 2 and 3 cover all `isBoardingMixed=true` inputs. Branch 2 is the
  *only* case where a boarding-mixed commitment may emit a renewal row;
  leftover `createdAmount - spentAmount` in that branch is **attributed to
  boarding** and must not surface as a separate receive at the builder level.
- Branch 4 is conservative: any asset delta on a non-boarding commitment
  routes to `settlement` (not renewal/exit), even if BTC is balanced.

### 3.6 `isRenewalGroup`

- Returns `true` iff `decomposeCommitmentGroup(args).kind === "renewal"`.
- Equivalent to branches 2 and 7 above.

### 3.7 `classifyAssetActivity({ direction, anchorSats, assetDelta })`

Returns one of:
`"asset_issued" | "asset_burned" | "asset_sent" | "asset_received" | "asset_activity"`.

Rules:

| direction | anchorSats | assetDelta signs       | Result            |
| --------- | ---------- | ---------------------- | ----------------- |
| any       | any        | empty (`[].length===0`) | `asset_activity`  |
| `"send"`  | `0n`       | all positive            | `asset_issued`    |
| `"send"`  | `0n`       | all negative            | `asset_burned`    |
| `"send"`  | any        | all negative            | `asset_sent`      |
| `"send"`  | any        | mixed signs             | `asset_activity`  |
| `"receive"` | any      | all positive            | `asset_received`  |
| `"receive"` | any      | mixed / negative        | `asset_activity`  |

Notes:

- "All positive" requires `every(a => a.amount > 0n)`. `0n` entries cannot
  occur (filtered by §3.4).
- `anchorSats` is the *signed BTC anchor* (`txAmount` for sends, `value` for
  receives), in sats. The function does not care about its sign for
  classification beyond the `=== 0n` check.

---

## 4. Activity Row Shape

All emitted rows conform to the `Activity` type in `app/store/types.ts`.
Builder-specific invariants on top of that schema:

### 4.1 Common fields

- `rail` is **always** `"arkade"` for rows produced by this builder.
- `source.type` is `"arkade_tx"` for payment rows and `"wallet_event"` for
  wallet-event rows. For wallet events, `source.eventId === id`.
- `metadata.network` is set iff `options.network` is non-null. The injection
  goes through `withNetwork` which **MUST** preserve all existing metadata
  keys and only add `network`.
- `metadata` values are JSON-safe (`string | number | boolean | null`). Bigint
  conversion via `Number(...)` is acceptable for sats but **MUST NOT** be
  applied to asset amounts (those go into `assets[].amount` as strings).

### 4.2 Asset rows (`buildAssetActivity`)

- `id` = `arkade:asset:<arkTxid>`.
- `kind` = `"wallet_event"`.
- `status`: derived from the `settled` parameter passed into
  `buildAssetActivity` — `"confirmed"` when settled, else `"pending"`.
  Callers must compute `settled` per §10 Phase B.5 (offchain receive:
  `isLeaf || isSpent`; offchain send: `true`; commitment-derived asset row:
  `true`). Intentionally asymmetric with the BTC offchain receive policy
  (§7 D-3).
- `direction`:
  - `"in"` if classification is `asset_received`.
  - `"out"` if classification is `asset_sent`.
  - `"self"` otherwise (issued / burned / generic activity).
- `assets[]` contains every entry from `assetDelta`, with `amount` as a
  signed decimal string (e.g. `"-25000"`).
- `metadata`:
  - `arkTxid`, `classification` (the enum string).
  - `assetId` and `assetAmount` (legacy single-asset pointers — first entry
    of `assets`, `assetAmount` via `Number(...)`. Set to `null`/`0` when no
    primary asset is present).
  - `anchorAmountSats = Number(anchorSats)`.
- `title` from `assetTitle(classification)`:
  - `asset_issued` → `"Asset issued"`
  - `asset_burned` → `"Asset burned"`
  - `asset_sent`   → `"Asset sent"`
  - `asset_received` → `"Asset received"`
  - `asset_activity` → `"Asset activity"`

### 4.3 Boarding deposit

- `id` = `arkade:boarding:<boardingTxid>`.
- `kind: "payment"`, `direction: "in"`, `amountSats: tx.amount`.
- `status`: `"confirmed"` if `tx.settled`, else `"pending"`.
- `title` = `"Boarding deposit"`.
- `source.walletTxId` = `boardingTxid`.
- `timestamp` = `tx.createdAt`.
- `metadata.boardingTxid` mandatory; `metadata.boardingAddress` present iff
  `options.boardingAddress` provided.
- **MUST** skip when `tx.key.boardingTxid` is falsy.

### 4.4 Boarding settled

- `id` = `arkade:boarding_settled:<commitmentTxid>`.
- `kind: "wallet_event"`, `direction: "self"`, `status: "confirmed"`.
- `title` = `"Boarding settled"`.
- `source.eventId` = `id`.
- `timestamp` = `tsCreated` (earliest created leaf) or `tsAnchor` fallback.
- `metadata`:
  - `commitmentTxid` (required).
  - `settledAmountSats` = `Number(settledAmount)`.
  - `boardingTxid` (optional — present iff an amount match was found).

Emission rules (§5.4):

- A boarding settlement row **replaces** what would otherwise be a
  `batch_receive` row for the same commitment.
- A boarding settlement row is also emitted in place of a
  `boarding_mixed_unresolved` settlement when `spent.length === 0 &&
  created.length > 0` (typical newly-settled boarding deposit).
- **MUST** claim each boarding tx at most once via `usedBoardingTxids` to
  avoid double-attribution in multi-deposit wallets.

### 4.5 Arkade received (batch)

- `id` = `arkade:batch:<commitmentTxid>`.
- `kind: "payment"`, `direction: "in"`, `status: "confirmed"`.
- `amountSats` = `Number(createdAmount)` (or `Number(receiveAmount)` in the
  `renewal_plus_receive` branch).
- `title` = `"Arkade received"`.
- `timestamp` = `tsCreated` (earliest created leaf).
- `metadata.commitmentTxid` mandatory; `metadata.arkadeAddress` iff option
  provided; `metadata.mixedWithRenewal === true` and
  `metadata.netDeltaSats` present in the `renewal_plus_receive` branch.

### 4.6 Collaborative exit

- `id` = `arkade:exit:<commitmentTxid>`.
- `kind: "payment"`, `direction: "out"`, `status: "confirmed"`.
- `amountSats` = `Number(spentAmount)` (pure exit) or `Number(exitAmount)`
  (renewal+exit).
- `title` = `"Collaborative exit"`.
- `timestamp` = `tsAnchor` (created if any, else `tsSpent + 1`).
- `metadata.commitmentTxid` mandatory; for `renewal_plus_exit`:
  `mixedWithRenewal === true`, `netDeltaSats = -Number(exitAmount)`.

### 4.7 VTXO renewed

- `id` = `arkade:renewal:<commitmentTxid>`.
- `kind: "wallet_event"`, `direction: "self"`, `status: "confirmed"`.
- `title` = `"VTXO renewed"`.
- **MUST NOT** set `amountSats` (renewals carry value in metadata only).
- `timestamp`:
  - Pure renewal: `tsCreated > 0 ? tsCreated : tsSpent`.
  - Mixed branches: `tsCreated`.
- `metadata`:
  - `commitmentTxid`, `inputCount = spent.length`, `outputCount = created.length`.
  - `renewedAmountSats`:
    - pure: `Number(spentAmount)`.
    - `renewal_plus_receive`: `Number(renewalAmount)` (which equals `spentAmount`).
    - `renewal_plus_exit`: `Number(renewalAmount)` (which equals `createdAmount`).
  - `netDeltaSats`:
    - omitted on pure renewal.
    - `+Number(receiveAmount)` on `renewal_plus_receive`.
    - `-Number(exitAmount)` on `renewal_plus_exit`.

### 4.8 Arkade settlement (fallback)

- `id` = `arkade:settlement:<commitmentTxid>`.
- `kind: "wallet_event"`, `direction: "self"`, `status: "info"`.
- `title` = `"Arkade settlement"`.
- `timestamp` = `tsAnchor`.
- `metadata`:
  - `commitmentTxid`, `spentAmount`, `createdAmount`,
    `unresolvedAmountSats = |createdAmount - spentAmount|`,
    `inputCount`, `outputCount`,
    `settlementReason`: `"boarding_mixed_unresolved"` |
    `"asset_bearing_settlement"` | `"empty_group"`.
- **MUST NOT** emit a row when `reason === "empty_group"` (defensive: nothing
  user-visible happened).

### 4.9 Offchain receive

- Trigger: VTXO with `!status.isLeaf && txid` that is *not* the change of
  one of our own sends (no other vtxo has `arkTxId === v.txid`).
- BTC-only path:
  - `id` = `arkade:offchain:<txid>`.
  - `kind: "payment"`, `direction: "in"`, `status: "confirmed"`.
  - `amountSats` = `v.value`.
  - `title` = `"Arkade received"`.
  - `timestamp` = `v.createdAt.getTime()`.
  - `metadata.arkTxid` mandatory; `metadata.arkadeAddress` iff option.
- Asset-bearing path: emits an asset row (§4.2) with `direction = "receive"`
  and `anchorSats = BigInt(v.value)` instead.
- **MUST** dedupe by `txid` via `offchainReceivesEmitted` (one row per
  inbound Arkade tx even if it produced multiple vtxos for us).

### 4.10 Offchain send

- Trigger: any VTXO with `isSpent === true && arkTxId` not yet emitted.
- Aggregation: for the same `arkTxId`:
  - `allSpent` = all vtxos sharing this `arkTxId` (inputs).
  - `changes` = all vtxos with `txid === arkTxId` (own change outputs).
  - `txAmount = changes.length > 0 ? spentBtc - changeBtc : spentBtc`.
  - `assets = subtractAssets(allSpent, changes)`.
- Timestamp:
  - `changes[0].createdAt` when change exists.
  - Else `getTxCreatedAt(arkTxId)` via indexer.
  - Else `v.createdAt.getTime() + 1` (SDK-compatible fallback).
- BTC-only path:
  - `id` = `arkade:offchain:<arkTxId>`.
  - `kind: "payment"`, `direction: "out"`, `status: "confirmed"`.
  - `amountSats` = `Number(txAmount)`.
  - `title` = `"Arkade sent"`.
- Asset-bearing path: emits asset row (§4.2) with `direction = "send"` and
  `anchorSats = txAmount`.
- **MUST** dedupe by `arkTxId` via `offchainSendsEmitted`.

---

## 5. Builder Pipeline

### 5.1 Data fetch

1. `cm = await wallet.getContractManager()`.
2. `contracts = await cm.getContractsWithVtxos()`.
3. `allVtxos = contracts.flatMap(c => c.vtxos)`.
4. `sorted = [...allVtxos].sort((a, b) => a.createdAt - b.createdAt)` (oldest
   first, deterministic).
5. `{ boardingTxs, commitmentsToIgnore } = await wallet.getBoardingTxs()`.
6. Construct `ExpoIndexerProvider(arkServerUrl)` for `getTxCreatedAt`.

### 5.2 Boarding emission

Iterate `boardingTxs`; emit §4.3 boarding rows (skipping rows with no
`boardingTxid`).

### 5.3 Commitment ID collection

Build `commitmentIds: Set<string>`:

- For each vtxo `v`: if `v.status.isLeaf` add `commitmentTxIds[0]`.
- For each vtxo `v`: if `v.settledBy` truthy add `v.settledBy`.

### 5.4 Per-commitment emission

For each `commitmentTxid`:

1. `spent` = sorted vtxos where `settledBy === commitmentTxid`.
2. `created` = sorted vtxos where `status.isLeaf` and
   `virtualStatus.commitmentTxIds?.[0] === commitmentTxid` (first-commitment
   attribution — matches SDK behavior; see §10 Phase B.5).
3. `isBoardingMixed = commitmentsToIgnore.has(commitmentTxid)`.
4. `decomp = decomposeCommitmentGroup({ spent, created, isBoardingMixed })`.
5. Compute timestamps:
   - `tsCreated` = min `createdAt` over `created`, or `0` if empty.
   - `tsSpent`   = min `createdAt` over `spent`,   or `0` if empty.
   - `tsAnchor`  = `tsCreated > 0 ? tsCreated : tsSpent + 1`.
6. **Boarding-settlement preempt**: before the main switch,
   - if `decomp.kind === "batch_receive"`, attempt `findBoardingMatch(createdAmount, requireUnsettled=true)`; on match → emit §4.4 row and `continue`.
   - else if `decomp.kind === "settlement" && reason === "boarding_mixed_unresolved" && spent.length === 0 && created.length > 0`, attempt `findBoardingMatch(createdAmount, requireUnsettled=false)` and emit §4.4 row (with or without boarding match for the explorer link), then `continue`.
7. Main switch on `decomp.kind` (§4.5–§4.8).

### 5.5 Offchain emission

Single pass over `sorted`:

- Receive emission (§4.9) when `!isLeaf && txid && !isChangeOfOwnTx`.
- Send emission (§4.10) when `isSpent && arkTxId`.

Both branches may run for the same VTXO if conditions hold (receive then
send), but the dedupe sets keep each Arkade txid to a single row per
direction.

### 5.6 Final sort

`activities.sort((a, b) => b.timestamp - a.timestamp)` — newest first.

Tie-break behaviour (equal timestamp): not specified by the implementation;
tests **MUST NOT** assume stable order across equal timestamps and should
sort by `(timestamp desc, id asc)` before comparing fixture output.

---

## 6. Invariants (cross-cutting test targets)

- **I-1 Determinism**: For the same input set (same wallet state, same
  options), two invocations produce arrays that are byte-identical after a
  stable secondary sort. Timestamps and IDs only depend on protocol data.
- **I-2 Stable IDs across restarts**: Recomputing from the same persisted
  VTXO state yields identical `Activity.id` values.
- **I-3 No duplicates**: Across the whole returned array, no `(id)` appears
  twice.
- **I-4 No phantom rows**: An empty-group commitment never emits a row.
- **I-5 Boarding never doubles**:
  - For every boarding deposit settled by a commitment, **at most one** of
    `arkade:batch:<c>` or `arkade:boarding_settled:<c>` is emitted (never
    both).
  - The `findBoardingMatch` claim ensures multi-deposit wallets do not steal
    the same boarding tx for two commitments.
- **I-6 Renewal never carries a payment amount**: `kind === "wallet_event"`
  rows **MUST NOT** populate `amountSats`. (`renewal`, `boarding_settled`,
  `settlement`, asset rows.)
- **I-7 Asset rows preserve raw amounts**: `assets[].amount` is the exact
  signed decimal of the bigint delta — no rounding, no truncation.
- **I-8 Network propagation**: `withNetwork(meta, null)` returns the meta
  unchanged; `withNetwork(meta, "X")` returns a new object with
  `network === "X"` and every original key intact.
- **I-9 Source/event symmetry**: For every wallet-event row,
  `source.eventId === id`.
- **I-10 No suppressed wallet events**: A linked Lightning swap cannot
  collide with `arkade:renewal:`, `arkade:settlement:`, `arkade:asset:`, or
  `arkade:boarding_settled:` IDs because the merge filter only expands
  payment-kind namespaces (`offchain`, `batch`, `boarding`, `exit`). This is
  the merge-side contract referenced by tests in `swap-mappers.ts`.

---

## 7. Drift vs MILESTONE_3

A high-fidelity diff between the milestone spec and the current
implementation. Each row is a fact a test should pin.

| #    | Topic                          | MILESTONE_3 says                                              | Implementation does                                                                                                  | Status                                     |
| ---- | ------------------------------ | ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| A-1  | Public signature               | `getActivityHistory(wallet): Promise<Activity[]>`             | `getActivityHistory(wallet, arkServerUrl, options)`                                                                  | **Drift, accepted** — Phase 1 step 5 anticipated server-URL plumbing; address option is additive |
| A-2  | Pure helpers exported          | `sumValue`, `collectAssets`, `subtractAssets`, `assetDeltas`, `decomposeCommitmentGroup`, `isRenewalGroup`, `classifyAssetActivity`, `activityId` | All exported                                                                                                         | Adherent                                   |
| A-3  | Boarding from `boardingTxs`    | Yes; never from leaf VTXOs                                    | Yes                                                                                                                  | Adherent                                   |
| A-4  | `commitmentsToIgnore` handling | Emit renewal when created ≥ spent and no asset delta; else `"Arkade settlement"` fallback | Same (decomp branches 2/3)                                                                                           | Adherent                                   |
| A-5  | Mixed renewal+receive          | Two rows: renewal + Arkade received for `delta`               | Two rows with `mixedWithRenewal: true` and `netDeltaSats` metadata                                                   | Adherent (+ extra metadata)                |
| A-6  | Mixed renewal+exit             | Two rows: renewal + collaborative exit for `\|delta\|`        | Two rows                                                                                                              | Adherent                                   |
| A-7  | Renewal row UI                 | No `+`/`-` sign, omit `amountSats`                            | `amountSats` not set; `direction: "self"`                                                                            | Adherent                                   |
| A-8  | Asset issuance/burn anchor     | zero-sat sent + signed asset delta                            | `anchorSats === 0n && allPositive/allNegative` on `direction: "send"`                                                | Adherent                                   |
| A-9  | Stable namespaced IDs          | List of 7 kinds                                               | 8 kinds (adds `boarding_settled`)                                                                                    | **Drift, extension** — see D-1            |
| A-10 | Final sort                     | Newest first                                                  | `b.timestamp - a.timestamp`                                                                                          | Adherent                                   |
| A-11 | Offchain send timestamp        | `changes[0].createdAt` ∨ `getTxCreatedAt` ∨ `v.createdAt+1`   | Exactly this                                                                                                          | Adherent                                   |
| A-12 | Empty-commitment fallback      | Not specified                                                 | Skips emission (`"empty_group"` reason short-circuits in §4.8)                                                       | Defensive extension                        |

### Drift items

- **D-1 New `"Boarding settled"` wallet event (`arkade:boarding_settled:<c>`).**
  Not in MILESTONE_3's row inventory (UI Rules §UI of milestone). Added by
  commits `94b4a34` and `9f75cbc` to fix duplicate "Arkade received" rows
  next to "Boarding deposit" for the same funds. Behaviour: replaces the
  `batch_receive` for that commitment **and** the `boarding_mixed_unresolved`
  settlement when `spent === [] && created.length > 0`. Match-by-amount via
  `findBoardingMatch` is a fallback for the SDK outspend-cache lag described
  in source comments.
  *Test implication*: when wiring `mergeActivities` and any title/icon
  registries, ensure `boarding_settled` is registered.

- **D-2 Asset row `status` is hardcoded `"confirmed"` (TO BE FIXED in Phase B.5).**
  MILESTONE_3 §Asset Activity suggests `status: settled ? "confirmed" : "pending"`.
  The current implementation does not propagate a settled flag from the
  underlying tx; all asset rows are emitted as confirmed.
  **Decision (2026-05-12)**: this is a data-integrity bug — a preconfirmed
  asset receive must not display as final. Fix during Phase B.5 before
  writing tests, so the test suite pins the *correct* behavior.
  Resolution rule:
  - Asset receive (offchain): `settled = v.status.isLeaf || v.isSpent`
    (SDK parity).
  - Asset send (offchain): `settled = true` (user-initiated).
  - Asset row from a commitment settlement (after Phase G): `settled = true`
    (commitment is final).

- **D-3 Offchain receive `status` is `"confirmed"` unconditionally.**
  Per commit `94b4a34` ("Treat off-chain Arkade receives as confirmed, not
  pending"). MILESTONE_3 does not pin a status for offchain receives but the
  earlier app behavior used `"pending"`.
  *Test implication*: pin to `"confirmed"`.
  *Note*: this is **intentionally asymmetric** with D-2 (assets). Arkade's
  preconfirmed BTC state is the wallet's "received" UX promise — funds are
  spendable; calling it confirmed matches user mental model. Assets carry
  no such fast-finality promise, so they propagate the real settled flag.

- **D-4 `created` filter (FIXED in Phase B.5).** Originally used
  `commitmentTxIds?.every(id => id === commitmentTxid)`, which silently
  dropped multi-commitment leaves. Resolution: switch to first-commitment
  attribution (`commitmentTxIds?.[0] === commitmentTxid`) to match SDK and
  guarantee no leaf vanishes. See §9.3 DIV-1.

- **D-5 `metadata.mixedWithRenewal` and `netDeltaSats` on mixed rows.**
  Not specified in MILESTONE_3. Useful for detail views; tests should assert
  presence in mixed branches and absence in pure branches.

- **D-6 `commitmentIds` includes commitments referenced by `settledBy`
  alone**, not only those with a created leaf. This is needed to detect
  pure-exit commitments (no created leaves of ours). Tests for pure-exit
  fixtures **MUST** include a vtxo whose `settledBy === commitmentTxid` and
  no created leaf.

- **D-7 `metadata.boardingTxid` on `boarding_settled` is optional.**
  Implementation tolerates an unmatched fallback (see §5.4 step 6 second
  branch). Tests **MUST NOT** assert presence universally.

---

## 8. Test Fixture Plan

Mapping from MILESTONE_3 §Testing Notes (plus drift items) to unit test
cases. Each bullet is one fixture / one test.

### 8.1 Pure helpers (§3)

- `sumValue`: empty array → `0n`; single vtxo; mixed-value vtxos; bigint
  promotion from numeric input.
- `collectAssets`: empty; vtxo with no `assets`; multi-asset aggregation;
  zero-net entry dropped.
- `subtractAssets`: only-received asset; only-spent asset (negative output);
  symmetric receive+spend cancellation drops the entry.
- `decomposeCommitmentGroup`: one fixture per branch listed in §3.5 (9
  branches).
- `isRenewalGroup`: true for branches 2 and 7, false for all others.
- `classifyAssetActivity`: one fixture per row of the §3.7 table.
- `activityId`: kind+id concatenation; empty `idValue` does not throw.

### 8.2 Boarding (§4.3, §4.4)

- Boarding deposit, settled false → `status: "pending"`.
- Boarding deposit, settled true → `status: "confirmed"`.
- Boarding row carries `boardingAddress` iff option provided.
- Skipped row when `tx.key.boardingTxid` is falsy.
- **Boarding settled via batch_receive match**: one boarding tx amount-N, a
  commitment with `created.amount === N`, `spent === []` → exactly one
  `boarding_settled` row, no `batch` row.
- **Boarding settled via boarding-mixed unresolved**: commitment in
  `commitmentsToIgnore`, `spent === []`, `created > 0` → `boarding_settled`
  row (with or without amount match for the explorer link).
- **Multi-deposit determinism**: two boarding txs of equal amount, two
  commitments → each claimed at most once (no double-attribution).
- **Coexistence**: when a boarding deposit settles, both the boarding row
  (deposit) and the `boarding_settled` row (settlement) appear; they have
  different IDs and remain distinct.

### 8.3 Commitments — pure cases (§4.5–§4.8)

- Pure batch receive (non-boarding).
- Pure collaborative exit (no change).
- Pure renewal: equal spent/created, no asset delta.
- Renewal with multiple inputs and outputs (`inputCount`, `outputCount`
  correct).
- Pure exit timestamp uses `tsSpent + 1` when `tsCreated === 0`.
- Pure renewal timestamp uses `tsCreated` when present, else `tsSpent`.

### 8.4 Commitments — mixed cases

- `renewal_plus_receive`: emit two rows; renewal row has `renewedAmountSats
  = spentAmount`, `netDeltaSats = +receiveAmount`; receive row has
  `mixedWithRenewal: true`.
- `renewal_plus_exit`: two rows; renewal carries `renewedAmountSats =
  createdAmount`, `netDeltaSats = -exitAmount`; exit row has
  `mixedWithRenewal: true`.

### 8.5 Boarding-mixed commitments

- `isBoardingMixed=true`, created ≥ spent, no asset delta, `created>0`,
  `spent>0`: renewal row emitted; **no** receive row for the leftover.
- `isBoardingMixed=true`, created < spent: `Arkade settlement` row with
  `reason: "boarding_mixed_unresolved"`.
- `isBoardingMixed=true`, asset delta non-empty: `Arkade settlement` with
  `reason: "boarding_mixed_unresolved"` (asset path on boarding-mixed
  always routes to settlement).

### 8.6 Asset activity (§4.2)

- Issuance: `direction:"send"`, `anchorSats=0n`, all-positive delta →
  `asset_issued`, title "Asset issued", `direction:"self"`.
- Burn: `direction:"send"`, `anchorSats=0n`, all-negative delta →
  `asset_burned`.
- Dust-anchor send: `direction:"send"`, `anchorSats=330n`, all-negative →
  `asset_sent`, row direction `"out"`.
- Dust-anchor receive: `direction:"receive"`, all-positive → `asset_received`,
  row direction `"in"`.
- Mixed-sign asset delta → `asset_activity` (`direction:"self"`).
- Asset row never sets `amountSats` (anchor stays in
  `metadata.anchorAmountSats`).
- `assets[]` round-trips signed bigint via decimal string (positive and
  negative both serialize correctly).

### 8.7 Offchain (§4.9, §4.10)

- Offchain receive with no spent inputs and no own send → single
  `arkade:offchain:<txid>` row, `direction: "in"`, `status: "confirmed"`.
- Multiple received vtxos sharing the same `txid` → single row (dedupe).
- Offchain send with change: `txAmount = spent - change`.
- Offchain send without change: timestamp falls back to indexer; further
  falls back to `v.createdAt + 1` when indexer returns undefined.
- Offchain send aggregated across multiple input vtxos (single row per
  `arkTxId`).
- Asset-bearing offchain receive yields an asset row, not a plain payment
  row.
- Asset-bearing offchain send yields an asset row keyed by `arkTxid`.
- A vtxo that is both received and spent (`!isLeaf && txid && isSpent`) is
  represented by at most one receive row and at most one send row, each
  deduped.

### 8.8 Invariants (§6)

- I-1: snapshot output is stable after a `(timestamp desc, id asc)` sort.
- I-3: assert `new Set(activities.map(a => a.id)).size === activities.length`.
- I-5: for every commitment that has a matching boarding tx, exactly one of
  `arkade:batch:` / `arkade:boarding_settled:` IDs is present.
- I-6: every `wallet_event` row has `amountSats === undefined`.
- I-8: `withNetwork({foo:1}, null)` returns `{foo:1}` (reference may differ
  but content equal); `withNetwork({foo:1}, "regtest")` returns
  `{foo:1, network:"regtest"}`.
- I-9: every `wallet_event` row satisfies `source.eventId === id`.

### 8.9 Merge contract (§I-10) — covered by `swap-mappers.ts` tests

Spec-level pre-condition: namespaces emitted by this builder are
`{boarding, boarding_settled, batch, exit, renewal, settlement, offchain,
asset}`. Merge filter on the Lightning side **MUST** include `boarding_settled`
to the payment-kind set if/when product wants Lightning to suppress a
boarding settlement row (currently it does not — `boarding_settled` is a
wallet event and should remain visible).

---

## 9. SDK Parity (`ts-sdk/src/utils/transactionHistory.ts`)

The SDK's `buildTransactionHistory(vtxos, allBoardingTxs, commitmentsToIgnore,
getTxCreatedAt?)` is the upstream reference. Trixie's `getActivityHistory`
**MUST** behave as a strict superset of it: every SDK row maps 1-1 to an
Activity row (renamed, never dropped), plus we add wallet-event rows that the
SDK suppresses by design.

The SDK test suite (`ts-sdk/test/transactionHistory.test.ts` plus
`test/fixtures/transaction_history.json` — 4 real-world cases) is the bar
this spec adopts.

### 10.1 Row schema mapping

SDK row (`ExtendedArkTransaction`):

```ts
{
  key: { arkTxid: string; boardingTxid: string; commitmentTxid: string }, // exactly one non-empty
  tag: "offchain" | "boarding" | "exit" | "batch",
  type: TxType.TxReceived | TxType.TxSent,
  amount: number,
  settled: boolean,
  createdAt: number, // ms epoch
  assets?: Asset[],
}
```

| SDK `(type, tag)`                | Activity row produced by us                            | ID                                   | Notes                                                          |
| -------------------------------- | ------------------------------------------------------ | ------------------------------------ | -------------------------------------------------------------- |
| `(RECEIVED, boarding)`           | `payment` / `in` / `"Boarding deposit"`                | `arkade:boarding:<boardingTxid>`     | `amount → amountSats`, `createdAt → timestamp`                 |
| `(RECEIVED, batch)`              | `payment` / `in` / `"Arkade received"`                 | `arkade:batch:<commitmentTxid>`      | Pure batch receive (no boarding-mixed, no renewal)             |
| `(RECEIVED, offchain)`           | `payment` / `in` / `"Arkade received"`                 | `arkade:offchain:<arkTxid>`          |                                                                |
| `(SENT, offchain)`               | `payment` / `out` / `"Arkade sent"`                    | `arkade:offchain:<arkTxid>`          |                                                                |
| `(SENT, exit)`                   | `payment` / `out` / `"Collaborative exit"`             | `arkade:exit:<commitmentTxid>`       |                                                                |
| `(SENT or RECEIVED) + assets≠[]` | `wallet_event` `asset_*` row (§4.2)                    | `arkade:asset:<arkTxid>`             | Replaces the BTC row; routed by `classifyAssetActivity` (§3.7) |
| `(SENT, amount=0, assets≠[])`    | `wallet_event` `asset_issued` / `asset_burned`         | `arkade:asset:<arkTxid>`             | Issuance / burn / reissuance / mixed-ops                       |

### 10.2 Rows we add that SDK does not

The SDK is intentionally a payment-only history; these are Activity-only:

- **`arkade:renewal:<c>`** — Pure VTXO refresh. SDK emits *nothing* in this
  case: the new leaf is filtered by the
  `fromOldestVtxo.filter(v => v.settledBy === leaf.commitmentTxIds[0]).length === 0`
  check, and the spent side is filtered by `forfeitAmount > settledAmount`
  being false. Our renewal row is additive.
- **`arkade:boarding_settled:<c>`** — Boarding settlement. SDK suppresses
  the would-be batch receive via `commitmentsToIgnore`. Our row is additive
  and replaces the SDK's silent suppression with a user-visible "Boarding
  settled" wallet event.
- **`arkade:settlement:<c>`** — Fallback for ambiguous boarding-mixed
  cases. SDK has no equivalent (it either emits exit, suppresses, or
  ignores).
- **Mixed-commitment two-row branches** (`renewal_plus_receive`,
  `renewal_plus_exit`) — SDK emits the value-delta row only (the exit or
  the batch receive) when applicable. We additionally emit the `renewal`
  row alongside.

### 10.3 Known divergences (test pin list)

These are real differences worth pinning in tests so future SDK-bump work
doesn't silently break parity.

- **DIV-1 Multi-commitment leaves (TO BE FIXED in Phase B.5).** SDK uses
  `vtxo.virtualStatus.commitmentTxIds![0]` (attribute to first commitment).
  Our `created` filter uses
  `commitmentTxIds?.every(id => id === commitmentTxid)`, so any leaf with
  `length > 1` is invisible to our commitment grouping and produces no
  `batch`/`renewal`/`boarding_settled` row.
  **Decision (2026-05-12)**: data loss is unacceptable even when the case
  is rare. Mirror the SDK exactly — attribute by `commitmentTxIds[0]` so
  the row surfaces. The first-commitment attribution may slightly
  over-credit a single group's `outputCount`/`createdAmount`, but no
  user-visible event vanishes. Tests will pin this corrected behavior.
- **DIV-2 Multi-leaf per commitment.** SDK emits one `(RECEIVED, batch)` row
  *per leaf*. We collapse them into one `arkade:batch:<commitmentTxid>` row
  with `amountSats = sum(values)`. Total value is preserved; row count and
  per-leaf `arkTxid`/`vout` granularity is lost. The fixture suite never
  emits a `batch` tag (all batches are renewed or boarding-settled), so
  this divergence is currently unexercised on real data.
- **DIV-3 `settled` flag.** SDK emits `settled: vtxo.status.isLeaf || vtxo.isSpent`
  for vtxo-derived rows. We always emit `status: "confirmed"` for offchain
  receive/send (intentional, commit `94b4a34`). Asset rows likewise are
  always `"confirmed"` (D-2). Boarding rows do honour `tx.settled`.
- **DIV-4 Receive timestamp under multi-leaf.** SDK uses the per-leaf
  `vtxo.createdAt`. Our batch row uses `min(created.createdAt)`. Equivalent
  when a commitment yields one leaf to us.
- **DIV-5 Sort tie-break.** SDK does not guarantee stable order across
  rows with equal `createdAt`. Neither do we. Tests **MUST** normalize to
  `(timestamp desc, id asc)` before structural compare.
- **DIV-6 `amount` for renewal+exit.** SDK exit row carries
  `forfeitAmount - settledAmount` (the net delta). We emit
  `Number(exitAmount)` from `renewal_plus_exit`, which is exactly
  `forfeitAmount - settledAmount`. ✓ matches. Documented to prevent
  regression.
- **DIV-7 Asset row vs SDK-style assets-on-payment.** SDK keeps a single
  row with `assets: [...]` attached. We emit a separate `arkade:asset:<x>`
  wallet-event row and **omit** the corresponding payment row. Tests that
  assert "one row per SDK row" must apply the mapping in §9.1 (asset
  branch wins).

### 10.4 Parity fixture cases (from `transaction_history.json`)

| Case | vtxos | boarding | cti | SDK rows | Expected our rows                                 | Notes                                                                              |
| ---- | ----- | -------- | --- | -------- | ------------------------------------------------- | ---------------------------------------------------------------------------------- |
| 0    | 27    | 8        | 7   | 25       | 25 + 7 `boarding_settled` + 13 `renewal`          | Most realistic. Tags in expected: boarding, exit, offchain. No `batch` rows.       |
| 1    | 35    | 1        | 1   | 34       | 34 + 1 `boarding_settled` + ≥1 `renewal`          | Long offchain history with one settlement.                                         |
| 2    | 2     | 0        | 0   | 2        | 2 (no extras)                                     | Pure collaborative-exit-with-change. Tests `exit` + `offchain` pair.               |
| 3    | 3     | 1        | 1   | 4        | 4 + 1 `boarding_settled`                          | Exercises `sendAllTxTime` indexer fallback for offchain-send-without-change.       |

For each case, the test **MUST** assert:

- **P-1 SDK row presence**: For every entry in `expected`, there is exactly
  one Activity row with:
  - matching ID per §9.1,
  - `timestamp === expected.createdAt`,
  - `amountSats === expected.amount` (for asset-bearing rows the amount
    moves to `assets[]` per §9.1 last row).
  - `direction === "in" | "out"` per `expected.type`.
- **P-2 Balance equality**:
  ```
  balance = sum(in payment amountSats) - sum(out payment amountSats)
          (excluding wallet_event rows)
        === expectedBalance
  ```
  The SDK's balance computation in the test sums `+amount` for `TxReceived`
  and `-amount` for `TxSent`. Our equivalent must ignore all wallet-event
  rows (asset, renewal, settlement, boarding_settled).
- **P-3 No SDK-row drop**: `expected.length` rows from §9.1 mapping table
  **MUST** all be present (parity floor).
- **P-4 Allowed extras**: Activity rows with kinds {`renewal`, `settlement`,
  `boarding_settled`, `asset`} may appear in any count. They **MUST NOT**
  collide by ID with any SDK row.
- **P-5 Ordering**: After normalization to `(timestamp desc, id asc)`, the
  subsequence of payment rows equals the SDK's `expected` order.

### 10.5 Unit-test cases from `transactionHistory.test.ts` (synthetic)

Each of these is a single-input synthetic fixture our builder must satisfy.
They are independent of the wallet I/O surface; they require a way to
invoke the *pure* builder with `(vtxos, allBoardingTxs, commitmentsToIgnore,
getTxCreatedAt)` directly. See §9.6.

- **`split-vtxo bug`**: 1000-sat vtxo → split to 2x 500, only one (change)
  returned. Expect: 1 `offchain` send of `500` + 1 `offchain` receive
  (change as received per SDK current behavior). Mirror the
  `expect(receivedTxs).toHaveLength(1); expect(sentTxs).toHaveLength(1)`
  assertion verbatim (modulo asset rows).
- **`self-transfer/split` (skipped in SDK)**: documented as a known
  divergence — out of scope until both wallets agree.
- **`receive new vtxo`**: 1 `offchain` receive, amount = vtxo value.
- **Asset on offchain receive**: emits one `asset_received` row, no
  `offchain` row. `assets[].amount === "50"` (positive, string-encoded
  bigint).
- **Asset on batch receive**: emits one `asset_received` row with
  `metadata.commitmentTxid` (we use it as the asset row's `arkTxid`?
  Actually no — our asset row is keyed by `arkTxid`, the per-vtxo `txid`).
  Pin current behavior: leaf-vtxo asset receives route through the
  commitment-group branches and currently land in `asset_bearing_settlement`
  → `settlement` row, **not** an asset row. **This is a real gap vs the
  SDK behavior** of attaching `assets` to a `(RECEIVED, batch)` row. Flag
  as DIV-8 below.
- **No-asset offchain receive**: `assets` property omitted on the row.
- **Subtract assets, offchain send with change**: assets `-70n` end up on
  the asset row. Anchor sats = 600.
- **All assets to change**: emit `offchain` send with no asset row (no net
  asset delta).
- **Send without change, with assets**: emit asset row, anchor sats = 1000.
- **Exit with change, with assets**: emit asset row + exit row?
  Pin behavior: SDK emits one row (`exit` with assets). Our
  `decomposeCommitmentGroup` routes asset-bearing settlements to
  `asset_bearing_settlement`, so we emit `settlement (info)` instead of
  `exit`. DIV-8 again.
- **Exit without change, with assets**: same DIV-8.
- **Issuance (self-send with new assets in change)**: SDK emits one `(SENT,
  offchain, amount=0)` with `assets: [{...+100n}]`. We emit one
  `arkade:asset:<arkTxid>` with classification `asset_issued`,
  `direction: "self"`, no `amountSats`.
- **Reissuance**: SDK same shape, `+100n` on existing asset. We emit
  `asset_issued` (positive delta on zero-anchor send).
- **Burn**: SDK `(SENT, amount=0, assets=-100n)`. We emit
  `asset_burned`.
- **Mixed burn+issuance+transfer**: SDK one row with three asset entries
  (mixed signs). We emit one `asset_activity` row with all three entries
  (mixed signs → `classifyAssetActivity` falls through to
  `asset_activity`).
- **Multi-spent assets aggregation**: SDK aggregates `-50, -10`. We
  aggregate the same via `subtractAssets` and emit `asset_sent` with both
  entries.

### 10.6 New divergence surfaced by parity work

- **DIV-8 Asset-bearing commitment settlement** (batch or exit) does not
  route to an asset row in our impl. `decomposeCommitmentGroup` branch 4
  (`asset_bearing_settlement`) sends them to the `settlement` fallback
  row, not to `buildAssetActivity`. SDK behavior is to keep the
  underlying payment row (`batch` / `exit`) and attach `assets` to it.
  - *Test*: pin current behaviour with a fixture and a TODO flag.
  - *Likely fix*: in the commitment-group switch, when
    `reason === "asset_bearing_settlement"` and the underlying value
    classification (pure batch_receive / pure exit) is unambiguous, emit
    the corresponding payment row *plus* an asset row keyed by
    `commitmentTxid`, instead of the catch-all settlement row.

### 10.7 Refactor required to make parity testable

`getActivityHistory(wallet, arkServerUrl, options)` currently couples the
pure builder to:

- `wallet.getContractManager().getContractsWithVtxos()` (live VTXO fetch)
- `wallet.getBoardingTxs()` (live boarding fetch)
- `new ExpoIndexerProvider(arkServerUrl).getVtxos(...)` (network)

To run the SDK fixture suite against our code, extract a pure inner builder
mirroring the SDK signature:

```ts
export async function buildActivityHistory(
  vtxos: VirtualCoin[],
  allBoardingTxs: ArkTransaction[],
  commitmentsToIgnore: Set<string>,
  getTxCreatedAt?: (txid: string) => Promise<number | undefined>,
  options?: GetActivityHistoryOptions,
): Promise<Activity[]>;
```

`getActivityHistory` becomes a thin wrapper that:

1. fetches `(vtxos, allBoardingTxs, commitmentsToIgnore)` from the wallet,
2. constructs `getTxCreatedAt` from `ExpoIndexerProvider`,
3. delegates to `buildActivityHistory`.

This:

- aligns parameter shapes with the SDK 1-1, enabling the SDK fixture suite
  to be re-run against `buildActivityHistory` with no code path changes;
- removes the need to mock React-Native / Expo / network in unit tests;
- keeps the existing public surface (`getActivityHistory`) for runtime.

Mark this as a P0 prerequisite for unit-test implementation. Until it lands,
tests must either reach inside `getActivityHistory` and mock
`wallet.getContractManager`, `wallet.getBoardingTxs`, and the indexer (more
fragile), or skip the SDK-fixture parity cases.

---

## 10. Action Plan

Sequenced, file-level steps to take this spec from document to passing test
suite. Each phase ends in a green `pnpm check && pnpm test` and a small,
reviewable diff. Phases A–C are prerequisites; D–F are the actual test
work; G addresses the divergence the parity tests will expose.

Estimated effort in parentheses is a rough order-of-magnitude, not a
commitment.

### Phase A — Test harness setup (≈0.5d)

No test framework is currently wired. Pick **Jest + `jest-expo`** —
Expo's officially supported path, with first-party RN/Expo module mocks
keyed to SDK 55. This is the decision-driver because **React Native
screen/hook tests are an imminent requirement**; running two harnesses
(Vitest for logic, Jest for components) is a smell.

1. Add dev deps (versions pinned to SDK 55 baseline):

   ```
   pnpm add -D jest jest-expo @types/jest \
               @testing-library/react-native @testing-library/jest-native
   ```

   - `jest-expo` ships the `babel-jest` transform and the RN/Expo module
     mocks; no separate `ts-jest` needed (Babel strips TS, type checking
     stays with `pnpm check`).
   - `@testing-library/react-native` and `@testing-library/jest-native`
     are pre-installed for Phase J component work; not used by this
     iteration but cheaper to add once.

2. Create `jest.config.ts` at the repo root:

   ```ts
   import type { Config } from "jest";

   const config: Config = {
     preset: "jest-expo",
     testMatch: ["**/__tests__/**/*.test.ts?(x)"],
     moduleNameMapper: {
       "^@/(.*)$": "<rootDir>/$1",
     },
     transformIgnorePatterns: [
       "node_modules/(?!((jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-clone-referenced-element|@react-navigation/.*|@unimodules/.*|sentry-expo|native-base|react-native-svg|@arkade-os/.*))",
     ],
     setupFilesAfterEach: ["@testing-library/jest-native/extend-expect"],
     collectCoverageFrom: [
       "app/services/arkade/activity-history.ts",
       "app/services/arkade/swap-mappers.ts",
     ],
   };

   export default config;
   ```

   `@arkade-os/.*` is appended to `transformIgnorePatterns`' allow-list
   so the SDK's ESM build is transformed by Babel rather than failing on
   import.

3. Add scripts to `package.json`:

   ```json
   "test": "jest",
   "test:watch": "jest --watch",
   "test:coverage": "jest --coverage"
   ```

4. Add a smoke test `app/__tests__/smoke.test.ts`:

   ```ts
   describe("jest", () => {
     it("runs", () => {
       expect(1).toBe(1);
     });
   });
   ```

5. Confirm Biome ignores tests for formatting rules that don't apply
   (it should out of the box — no config change expected).

**Acceptance**: `pnpm test` runs the smoke test green.

**Risk and mitigation**:

- *Risk*: `jest-expo@55` may not yet officially declare React 19.2
  compatibility at the time of this work. Mitigation: pin
  `jest-expo` to the version Expo SDK 55 publishes; if a peer-dep
  warning surfaces, add an `overrides` entry in `package.json` and
  document the patch.
- *Risk*: `@arkade-os/sdk/adapters/expo` re-export currently imports
  Expo-only deps at import time. Phase B removes that import from the
  pure `buildActivityHistory`, so pure-logic tests don't touch it.
  Tests **MUST** import from `./activity-history` (named exports of
  the pure function and helpers); the wrapper (`getActivityHistory`)
  is exercised only by integration paths or by mocking
  `ExpoIndexerProvider` if/when needed.

**Why not Vitest** (decision log, 2026-05-12):

- Anticipated component-testing requirement makes `jest-expo`'s
  preconfigured RN module mocks decisive.
- SDK fixture portability (Vitest's edge) is neutralized — Phase E
  copies the fixture into Trixie.
- Speed gap real but small at this suite size; ergonomics favor a
  single runner.

### Phase B — Refactor for testability (≈0.5d)

Goal: separate the **pure builder** from wallet I/O so tests can drive it
with synthetic inputs identical in shape to the SDK's test inputs.

In `app/services/arkade/activity-history.ts`:

1. Extract a new exported function:

   ```ts
   export async function buildActivityHistory(
     vtxos: VirtualCoin[],
     allBoardingTxs: ArkTransaction[],
     commitmentsToIgnore: Set<string>,
     getTxCreatedAt?: (txid: string) => Promise<number | undefined>,
     options: GetActivityHistoryOptions = { network: null },
   ): Promise<Activity[]>;
   ```

   Move *all* current builder logic into it (the body of the existing loop
   over commitments + offchain pass + final sort).

2. Reduce `getActivityHistory` to a thin wrapper:

   ```ts
   export async function getActivityHistory(
     wallet: Wallet,
     arkServerUrl: string,
     options: GetActivityHistoryOptions = { network: null },
   ): Promise<Activity[]> {
     const cm = await wallet.getContractManager();
     const contracts = await cm.getContractsWithVtxos();
     const vtxos = contracts.flatMap((c) => c.vtxos);
     const { boardingTxs, commitmentsToIgnore } = await wallet.getBoardingTxs();
     const indexer = new ExpoIndexerProvider(arkServerUrl);
     const getTxCreatedAt = (txid: string) =>
       indexer
         .getVtxos({ outpoints: [{ txid, vout: 0 }] })
         .then((res) => res.vtxos[0]?.createdAt.getTime())
         .catch(() => undefined);
     return buildActivityHistory(
       vtxos,
       boardingTxs,
       commitmentsToIgnore,
       getTxCreatedAt,
       options,
     );
   }
   ```

3. Move the `ExpoIndexerProvider` import to be only used inside the wrapper
   (it already is — just confirm the pure function references no Expo
   imports).

4. **No call-site changes**: `runtime.ts` still calls `getActivityHistory`
   with the same arguments.

**Acceptance**:

- `pnpm check` green, `pnpm test` (smoke) still green.
- Grep confirms `buildActivityHistory` is exported.
- Manual smoke: app starts, Activity list still populates.

### Phase B.5 — Data-integrity fixes (≈0.5d)

Two correctness bugs **MUST** be resolved before tests are written, so
the test suite pins the correct behavior instead of the divergent one. Both
follow the project rule "do not lose user data; prefer the wrong label over
hidden information."

In `app/services/arkade/activity-history.ts`:

**Fix 1 — DIV-1: multi-commitment leaves (line ~376–380)**

Change the `created` filter in the per-commitment loop from
`every(=== commitmentTxid)` to first-commitment attribution (SDK parity):

```ts
// before
const created = sorted.filter(
  (v) =>
    v.status.isLeaf &&
    v.virtualStatus.commitmentTxIds?.every((id) => id === commitmentTxid),
);

// after
const created = sorted.filter(
  (v) =>
    v.status.isLeaf &&
    v.virtualStatus.commitmentTxIds?.[0] === commitmentTxid,
);
```

This matches `transactionHistory.ts:82-87` in the SDK. The
`commitmentIds` collection in §5.3 also needs to switch from "add
`commitmentTxIds?.[0]` for leaves" (which it already does) — no change
there.

**Fix 2 — D-2: asset row status reflects real settled state**

1. Extend `buildAssetActivity` to accept `settled: boolean`:

   ```ts
   function buildAssetActivity(args: {
     arkTxid: string;
     timestamp: number;
     direction: "send" | "receive";
     anchorSats: bigint;
     assetDelta: Asset[];
     network: string | null;
     settled: boolean;
   }): Activity {
     ...
     status: args.settled ? "confirmed" : "pending",
     ...
   }
   ```

2. At call sites:

   - Offchain receive (line ~648):
     ```ts
     settled: v.status.isLeaf || v.isSpent,
     ```
   - Offchain send (line ~694):
     ```ts
     settled: true,
     ```
   - Commitment-settlement asset rows (added in Phase G): `settled: true`
     (a commitment is always final once it appears).

3. Update §4.2 of this document to read
   `status: settled ? "confirmed" : "pending"` instead of always
   `"confirmed"`.

**Acceptance for Phase B.5**:

- `pnpm check` green.
- A manual regtest pass: receive an asset-bearing Arkade tx, confirm the
  row reads "pending" until the next batch settles it; then reads
  "confirmed".
- Snapshot a multi-commitment leaf (synthetic VTXO with
  `commitmentTxIds: [a, b]`) and confirm `getActivityHistory` produces a
  row attributed to commitment `a`.

**Pinning in tests**: §10.C and §10.D test files **MUST** assert:

- Asset receive on preconfirmed VTXO → `status: "pending"`.
- Asset receive on leaf VTXO → `status: "confirmed"`.
- Asset send → `status: "confirmed"` regardless of source VTXO state.
- Multi-commitment leaf attributes to `commitmentTxIds[0]`.

### Phase C — Pure-helper unit tests (≈0.5d)

File: `app/services/arkade/__tests__/activity-history.helpers.test.ts`.

One `describe` block per helper from §3, one `it` per row of the tables
there. Use literal `bigint` constants (`50n`, `-70n`) and minimal
`VirtualCoin` shapes (most fields can be `undefined`/dummy — the helpers
only read `value`/`assets`).

Pattern:

```ts
// jest globals (describe, it, expect) are auto-injected by jest-expo
import {
  activityId,
  sumValue,
  collectAssets,
  subtractAssets,
  decomposeCommitmentGroup,
  isRenewalGroup,
  classifyAssetActivity,
} from "../activity-history";
import type { VirtualCoin } from "@arkade-os/sdk";

const vtxo = (over: Partial<VirtualCoin> = {}): VirtualCoin =>
  ({
    txid: "x", vout: 0, value: 0,
    status: { confirmed: false },
    virtualStatus: { state: "preconfirmed" },
    createdAt: new Date(0),
    isUnrolled: false, isSpent: false,
    ...over,
  }) as VirtualCoin;
```

**Acceptance**: ≥30 tests covering §3.1–§3.7 enumerations; all green.

### Phase D — Synthetic builder tests (≈1d)

File: `app/services/arkade/__tests__/activity-history.builder.test.ts`.

Mirror every non-skipped `it()` in `ts-sdk/test/transactionHistory.test.ts`,
adjusted to assert the renamed Activity rows from §9.1 (the mapping table)
instead of the SDK's `(type, tag)` shape.

Pattern for the `split-vtxo bug` case (§9.5 first bullet):

```ts
const result = await buildActivityHistory(
  [resultVtxo0, spentVtxo], [], new Set<string>(),
);
const offchain = result.filter((a) => a.id.startsWith("arkade:offchain:"));
const sends = offchain.filter((a) => a.direction === "out");
const receives = offchain.filter((a) => a.direction === "in");
expect(sends).toHaveLength(1);
expect(receives).toHaveLength(1);
expect(sends[0].amountSats).toBe(500);
expect(sends[0].id).toBe(`arkade:offchain:${arkTxId}`);
```

Coverage required (one test each):

- D-1 split vtxo (sent + received) — `split-vtxo bug`.
- D-2 simple receive — `receive new vtxo`.
- D-3 offchain receive with assets — emits **`arkade:asset:`** row, no
  `arkade:offchain:` row.
- D-4 no-asset receive — `assets` property absent on row.
- D-5 offchain send with change + assets → asset row, anchor 600.
- D-6 send where all assets go to change → plain offchain send, no asset
  row.
- D-7 send without change with assets → asset row, anchor 1000.
- D-8 exit with change with assets → **currently fails** (DIV-8). Mark
  `.fails` until Phase G; assert *current* behavior (settlement row) and
  add a `// TODO(DIV-8): should be exit + asset row`.
- D-9 exit without change with assets → same DIV-8 situation.
- D-10 issuance (self-send, +assets in change, 0 anchor) → `asset_issued`,
  `direction: "self"`.
- D-11 reissuance (+50 → +150 → +100 net) → `asset_issued`.
- D-12 burn (assets in spent, none in change, 0 anchor) → `asset_burned`.
- D-13 mixed burn+issuance+transfer → single `asset_activity` row with all
  three entries (mixed signs).
- D-14 multi-spent asset aggregation → `asset_sent` with `-50/-10`.

**Acceptance**: 14 tests; D-1, D-2, D-3, D-4, D-5, D-6, D-7, D-10..D-14
pass; D-8 and D-9 marked `.fails` or `.todo` with explanatory comments
referencing DIV-8.

### Phase E — Real-world fixture parity (≈1d)

File: `app/services/arkade/__tests__/activity-history.parity.test.ts`.

**Fixture provisioning** (one-time, part of Phase E):

1. Copy
   `~/workspace/ark/ts-sdk/test/fixtures/transaction_history.json` to
   `app/services/arkade/__tests__/fixtures/transaction_history.json`.
2. Add a short header file
   `app/services/arkade/__tests__/fixtures/README.md` recording:
   - The source commit hash from `ts-sdk` at copy time.
   - A note that this fixture is the SDK parity bar (§9) and **MUST**
     be re-synced when the SDK's fixture changes.
3. Add a tiny refresh helper script (optional, not required for Phase E
   to land):

   ```bash
   # scripts/sync-sdk-fixture.sh
   cp ../ts-sdk/test/fixtures/transaction_history.json \
      app/services/arkade/__tests__/fixtures/transaction_history.json
   ```

Import in the test:

```ts
import transactionHistory from "./fixtures/transaction_history.json";
```

No skip-guard needed — the file is in-tree, CI sees it unconditionally.

Per fixture case, the test:

1. Reconstructs `VirtualCoin[]` with `createdAt` as `Date` (mirrors the
   SDK test's `vtxos.map(_ => ({..._, createdAt: new Date(_.createdAt)}))`).
2. Builds `getTxCreatedAt` from `sendAllTxTime` when present.
3. Calls `buildActivityHistory(vtxos, allBoardingTxs, new Set(cti),
   getTxCreatedAt)`.
4. Asserts P-1..P-5 from §9.4:

   **P-1 SDK row presence**

   ```ts
   for (const sdkRow of expected) {
     const expectedId = sdkRowToActivityId(sdkRow); // helper from §9.1 table
     const match = activities.find((a) => a.id === expectedId);
     expect(match, `missing ${expectedId}`).toBeDefined();
     expect(match!.timestamp).toBe(sdkRow.createdAt);
     if (!sdkRow.assets) {
       expect(match!.amountSats).toBe(sdkRow.amount);
       expect(match!.direction).toBe(sdkRow.type === "RECEIVED" ? "in" : "out");
     }
   }
   ```

   **P-2 Balance equality**

   ```ts
   const balance = activities
     .filter((a) => a.kind === "payment" && typeof a.amountSats === "number")
     .reduce((acc, a) => acc + (a.direction === "in" ? a.amountSats! : -a.amountSats!), 0);
   expect(balance).toBe(expectedBalance);
   ```

   **P-3 No SDK-row drop**: `expected.length` matched IDs found.

   **P-4 Allowed extras**: every Activity ID not matched by an SDK row
   **MUST** be in `{renewal, settlement, boarding_settled, asset}`
   namespace.

   **P-5 Ordering**: subsequence of payment rows from
   `[...activities].sort((a,b) => b.timestamp - a.timestamp || a.id.localeCompare(b.id))`,
   filtered to payment IDs, equals `expected` order.

**Observed per-case outcomes** (measured against the current builder
after Phase B.5; pin these counts in tests):

| Case | SDK rows | Our rows | Breakdown                                                                     |
| ---- | -------- | -------- | ----------------------------------------------------------------------------- |
| 0    | 25       | 37       | 8 boarding + 7 boarding_settled + 5 renewal + 2 exit + 15 offchain            |
| 1    | 34       | 37       | 1 boarding + 1 boarding_settled + 2 renewal + 33 offchain                     |
| 2    | 2        | 3        | 1 exit + 1 renewal + 1 offchain (case is renewal_plus_exit, two rows)         |
| 3    | 4        | 5        | 1 boarding + 1 boarding_settled + 3 offchain                                  |

Renewal counts are lower than a naive prediction because many spent
vtxos in the fixtures share commitments — the renewal row is per
commitment, not per vtxo. Case 2 emits a `renewal` alongside the SDK's
`exit` because the commitment is `renewal_plus_exit` (forfeit >
settled by some delta) rather than a pure exit.

**Acceptance**: all four cases pass P-1..P-5, or are documented as
expected-failures with a specific DIV reference.

### Phase F — Trixie-specific coverage (≈0.5d)

File: `app/services/arkade/__tests__/activity-history.trixie.test.ts`.

Cases that the SDK suite does not exercise, but our spec requires:

- F-1 Boarding deposit unsettled → row `status: "pending"`.
- F-2 Boarding deposit settled + matching commitment → exactly one
  `boarding` row and one `boarding_settled` row, no `batch` row.
- F-3 Multi-deposit determinism: two boarding txs same amount, two
  commitments → `usedBoardingTxids` claims each at most once.
- F-4 Pure renewal (equal spent/created, no asset delta) → `renewal` row
  only, no debit/credit `amountSats`.
- F-5 `renewal_plus_receive` → 2 rows (`renewal`, `batch`), `batch` row
  carries `mixedWithRenewal: true`, `netDeltaSats > 0`.
- F-6 `renewal_plus_exit` → 2 rows (`renewal`, `exit`), `exit` row carries
  `mixedWithRenewal: true`, `netDeltaSats < 0`.
- F-7 Boarding-mixed renewal: `commitmentsToIgnore` contains commitment,
  `created ≥ spent`, no asset delta → `renewal` row, no extra `batch`.
- F-8 Boarding-mixed asset path → `settlement` (info) row, asset delta
  preserved in metadata.
- F-9 Empty commitment group → no row emitted.
- F-10 `withNetwork({foo:1}, null) === {foo:1}` and
  `withNetwork({foo:1}, "regtest") === {foo:1, network:"regtest"}`.
- F-11 Invariants I-3, I-6, I-9 (run as cross-cutting assertions over the
  Case 0 fixture output).

**Acceptance**: 11 tests green.

### Phase G — Fix DIV-8 (asset on commitment settlements) (≈0.5d)

DIV-8 is the only divergence Phase D/E will surface as actual failures.
Resolve before unmarking D-8/D-9.

Plan:

1. In the commitment-group switch (`activity-history.ts`, currently
   `case "settlement":` arm), branch on `decomp.reason ===
   "asset_bearing_settlement"`:
   - If `spent.length === 0 && created.length > 0`: emit `batch` payment
     row (BTC anchor) **and** asset row keyed by `commitmentTxid`.
   - If `spent.length > 0 && created.length === 0`: emit `exit` payment
     row **and** asset row.
   - Else: keep emitting `settlement` (genuinely mixed value+asset case).
2. Asset row's `arkTxid` becomes `commitmentTxid` for this branch (asset
   row id stays `arkade:asset:<commitmentTxid>`).
3. Unmark D-8 / D-9; ensure parity Case 0/1 still pass (none of them
   should be affected since fixture cases have no asset-bearing
   commitments).

**Acceptance**: D-8 + D-9 green; no other test regresses.

### Phase H — Deferred / opt-in (not blocking)

- ~~**DIV-1**~~ — *fixed in Phase B.5.* Tests pin
  `commitmentTxIds[0]` attribution.
- **DIV-2 (multi-leaf per commitment)**: pin current collapsed behavior
  with a synthetic test and `// TODO(DIV-2)`. Defer fix — SDK emits one
  row per leaf; we collapse to one per commitment with aggregated value.
  The collapsed form is arguably better UX (fewer redundant rows for the
  same commitment), so this may stay as-is even after review.
- **DIV-3 (`settled` flag for BTC offchain receives)**: intentional per
  commit `94b4a34`; add a comment in the test file. No code change.
  Asymmetric with D-2 by design — see §7 D-3 note.
- ~~**D-2**~~ — *fixed in Phase B.5.*
- **Performance**: the builder is `O(commitments × vtxos)` because the
  per-commitment loop re-filters `sorted` on each iteration (one pass for
  `spent`, one for `created`). For a wallet with C commitments and V
  vtxos: ~2 · C · V comparisons. The offchain pass adds another
  `O(V²)` via inner filters (`isChangeOfOwnTx`, `allSpent`, `changes`).
  At V ≈ 100, C ≈ 30 this is ~6k + 10k = ≤20k comparisons per call —
  fast enough today. At V ≈ 1000, C ≈ 300 this is ≥1M comparisons and
  warrants pre-indexing. Defer; track as a follow-up.

  Sketch of the future optimization (not part of this iteration):

  ```ts
  const bySettledBy   = groupBy(sorted, (v) => v.settledBy ?? "");
  const byArkTxId     = groupBy(sorted, (v) => v.arkTxId ?? "");
  const byTxid        = groupBy(sorted, (v) => v.txid ?? "");
  const byFirstCommit = groupBy(
    sorted.filter((v) => v.status.isLeaf),
    (v) => v.virtualStatus.commitmentTxIds?.[0] ?? "",
  );
  // then each lookup is O(1) per commitment / per arkTxId
  ```

  Trigger condition for this work: real-user wallets observed crossing
  V > 500, *or* visible UI jank on the Activity refresh path.

### Phase I — Wire CI (≈0.25d)

If/when CI is configured:

1. Add `pnpm test` to the CI script before `pnpm check`.
2. Cache `node_modules` and Jest's transform cache (`.jest-cache/`).
3. The parity fixture is checked in (§Phase E), so no skip logic is
   needed on CI — runners build identically locally and remote.

### Phase J — RN component-test scaffolding (out of scope, foreshadowed)

Not part of this Activity-history work but enabled by the framework
choice. When component tests land:

- Add `jest-setup.ts` with `import "@testing-library/jest-native/extend-expect";`
  and `import "react-native-gesture-handler/jestSetup";` if gesture
  components are tested.
- Switch `jest.config.ts`'s `testEnvironment` to the jest-expo default
  (no change needed; preset already targets RN).
- First candidate screens: `WalletScreen` (Activity list rendering),
  `Unlock` (auth flow), `RestoreWallet` (input validation). All three
  consume `useResolvedTheme` and the store, so a `renderWithProviders`
  helper that wraps `ToastProvider` + `NavigationContainer` should land
  in `app/__tests__/test-utils.tsx`.
- Mock surfaces likely needed beyond what `jest-expo` provides:
  - `lucide-react-native` icon components (render as `<Text>` stubs).
  - `react-native-reanimated` (use the official mock:
    `jest.mock("react-native-reanimated", () => require("react-native-reanimated/mock"));`).

This phase is mentioned solely to validate that the framework choice
holds up for the next round; do not implement during the Activity work.

### Sequencing & ownership

```
A (harness) → B (refactor) → B.5 (data-integrity fixes: DIV-1, D-2)
                                       │
                                       ├→ C (helpers)
                                       ├→ D (synthetic) ─┐
                                       │                 ├→ G (DIV-8 fix) → unmark D-8/D-9
                                       ├→ E (parity) ────┘
                                       ├→ F (Trixie)
                                       ├→ H (deferred notes)
                                       └→ I (CI, last)
```

Phases C–F are parallelizable once B.5 lands. **B.5 is non-optional**:
tests written before it would pin divergent behavior. Phase G is the last
behavior change before shipping the suite.

### Definition of Done

- `pnpm test` green on a clean checkout.
- ≥80% line coverage on `app/services/arkade/activity-history.ts` (track
  via `pnpm test -- --coverage`).
- Every DIV-N in §9.3 has at least one test that either pins behavior
  (deferred) or asserts the fix (resolved).
- This document references file paths and test IDs (`F-3`, `D-7`, etc.)
  that exist in the repo.

---

## 11. Open Questions / Follow-ups

These are not test cases but should be revisited when the SDK or product
adds capability:

1. **Per-commitment boarding amounts** (MILESTONE_3 §Caveats). Once
   `BoardingCommitmentInput` is exposed, replace the amount-match heuristic
   in `findBoardingMatch` with a direct attribution and tighten branch 3 of
   §3.5 to compute `externalDelta`.
2. ~~Asset row `status` (D-2)~~ — *resolved in Phase B.5.*
3. **`getTxCreatedAt` via public SDK helper** instead of constructing an
   `ExpoIndexerProvider` directly (MILESTONE_3 §Phase 6).
4. **Tie-break on equal timestamps**: consider adding a secondary sort by
   `id` to make I-1 hold without test-side normalization.
5. ~~Multi-commitment leaves (D-4)~~ — *resolved in Phase B.5* via
   first-commitment attribution. Revisit only if the protocol starts
   emitting leaves where first-commitment attribution materially
   misrepresents the event (e.g., a settlement spanning two truly
   independent commitments with no canonical "first").
6. **Builder performance**: per-commitment loop is `O(C·V)`, offchain
   pass adds `O(V²)`. Acceptable today (V ≤ ~200) but warrants
   pre-indexing once V crosses ~500 or UI jank is observed on Activity
   refresh. Optimization sketch in §10 Phase H.
