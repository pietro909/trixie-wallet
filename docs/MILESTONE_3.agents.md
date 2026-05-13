# Milestone 3: Activities

Goal: make the Activity list the app-owned source of truth for user-visible
wallet history.

The app should stop using `Wallet.getTransactionHistory()` as the input for
Activity rows. Instead, implement and use an app-level `getActivityHistory()`
that derives Activities directly from the same wallet data the SDK history
builder already uses.

This milestone should prove:

- Arkade payments still appear as incoming and outgoing Activity rows.
- Boarding deposits appear as Activity rows.
- Collaborative exits appear as Activity rows.
- VTXO renewals appear as non-payment Activity rows.
- Asset-related Arkade transactions appear as Activity rows, even though this
  wallet does not support asset management yet.
- Lightning rows from Milestone 2 still merge cleanly with Arkade-derived rows.
- Activity ids are stable across refreshes and app restarts.
- The Activity list remains chronological, deduplicated, and user-facing.

## Current State

- `app/services/arkade/runtime.ts` calls `wallet.getTransactionHistory()` inside
  `snapshotWallet()`.
- `app/services/arkade/mappers.ts` maps each SDK `ArkTransaction` to a generic
  payment Activity.
- `app/services/arkade/swap-mappers.ts` merges Arkade Activities with locally
  known Boltz swap Activities.
- The app's Activity model already supports non-payment rows via:
  - `kind: "wallet_event"`
  - `direction: "self"` or `"none"`
  - `status: "info"` or `"confirmed"`
  - `source: { type: "wallet_event", eventId }`

The problem is that the SDK transaction history is intentionally a payment-like
history. It returns only sent and received `ArkTransaction` rows, so it hides
some wallet events that Trixie's Activity list should show.

## SDK Findings

The SDK history builder lives in
`../ts-sdk/src/utils/transactionHistory.ts` as `buildTransactionHistory()`.

It derives history from:

- all wallet VTXOs, fetched from the contract manager;
- boarding transactions;
- a `commitmentsToIgnore` set for boarding commitments;
- an optional `getTxCreatedAt(txid)` helper for offchain spends without change;
- asset deltas attached to `ArkTransaction.assets` and `VirtualCoin.assets`.

That means the useful inputs are available to us:

- `wallet.getContractManager().getContractsWithVtxos()` gives the VTXOs used by
  SDK history.
- `wallet.getBoardingTxs()` currently provides `boardingTxs` and
  `commitmentsToIgnore` on the SDK `Wallet` class.
- `ExpoIndexerProvider` can be created by our runtime when we need
  `getTxCreatedAt`.

If `wallet.getBoardingTxs()` is considered too leaky because it is not part of
the public wallet interface, prefer adding a small SDK export/helper later over
continuing to depend on `Wallet.getTransactionHistory()` for Activity.

Milestone 3 can accept this concrete-`Wallet` dependency because Trixie's
runtime already constructs and imports the SDK `Wallet` class directly. Track a
follow-up SDK task to expose the boarding-history inputs through a public helper
or interface method.

## Selected Direction

Implement an app-owned `getActivityHistory()` and use it in
`snapshotWallet()` instead of:

```ts
wallet.getTransactionHistory()
```

This is safer and cleaner than trying to stretch `ArkTransaction` into an
Activity model:

- Activity is a product model; SDK transaction history is a protocol/payment
  summary.
- VTXO renewal is intentionally hidden by SDK history, but it is useful in a
  wallet activity feed.
- Lightning rows, swap rows, future diagnostics, and wallet lifecycle events
  already need Activity-specific semantics.
- Asset issuance/burn/transfer transactions are anchored by small Arkade
  transactions and should not be displayed as ordinary 330 sat payments.
- The app can preserve SDK behavior for protocol operations while owning the
  display policy.

Do not delete or fork SDK `Wallet.getTransactionHistory()`. Just stop treating
it as the app's Activity source.

Concrete integration point:

- In `app/services/arkade/runtime.ts`, replace `wallet.getTransactionHistory()`
  with `getActivityHistory(wallet)` inside `snapshotWallet()`.
- Change `WalletSnapshot.activities` to `Activity[]`.
- Remove the `mapArkTxs(txs)` step because the new builder returns Activity
  rows directly.
- Once no callers remain, delete `app/services/arkade/mappers.ts` and update
  comments in `swap-mappers.ts` that refer to `mapArkTxs`.

## VTXO Renewal Recognition

The SDK already contains the signal for renewals by omission.

Process finalized batch commitments as groups. For a settlement commitment id:

```ts
const spentVtxos = allVtxos.filter((v) => v.settledBy === commitmentTxid);

const newVtxos = allVtxos.filter(
  (v) =>
    v.status.isLeaf &&
    v.virtualStatus.commitmentTxIds?.every((id) => id === commitmentTxid),
);
```

Then compute:

```ts
const spentAmount = sumValue(spentVtxos);
const createdAmount = sumValue(newVtxos);
const delta = createdAmount - spentAmount;
```

Use this decomposition for non-boarding commitments:

- `spentAmount === 0 && createdAmount > 0` -> batch receive;
- `spentAmount > 0 && createdAmount === 0` -> collaborative exit;
- `spentAmount > 0 && delta === 0` -> pure VTXO renewal;
- `spentAmount > 0 && delta > 0` -> VTXO renewal plus net Arkade receive for
  `delta`;
- `spentAmount > 0 && delta < 0` -> collaborative exit/spend for `Math.abs(delta)`.

Recognize a pure renewal when:

- `commitmentsToIgnore` does not contain `commitmentTxid`;
- `spentVtxos.length > 0`;
- `newVtxos.length > 0`;
- total spent value equals total new value;
- asset deltas are zero, once asset display is supported.

Timestamp policy: use the earliest new leaf `createdAt` for the renewal row.
That is when the refreshed VTXO becomes visible to the wallet. If there are
multiple new leaves, use the minimum created time among them for deterministic
sorting.

That is the case where `buildTransactionHistory()` suppresses both sides:

- the new leaf VTXO is not shown as a batch receive because it refreshed a
  previous VTXO;
- the spent VTXO is not shown as an exit because `forfeitAmount` is not greater
  than `settledAmount`.

Represent it as:

```ts
{
  id: `arkade:renewal:${commitmentTxid}`,
  kind: "wallet_event",
  direction: "self",
  title: "VTXO renewed",
  status: "confirmed",
  rail: "arkade",
  source: { type: "wallet_event", eventId: `arkade:renewal:${commitmentTxid}` },
  metadata: {
    commitmentTxid,
    inputCount: spentVtxos.length,
    outputCount: newVtxos.length,
    amountSats: totalSpent,
  },
}
```

Prefer hiding the amount in the row UI at first. Renewal is not a payment; the
amount belongs in metadata/details, not in the right-aligned debit/credit
column.

For mixed renewal-plus-receive commitments, emit two rows when the value delta
proves both parts:

- `VTXO renewed` for the refreshed component;
- `Arkade received` for the net positive `delta`.

For mixed renewal-plus-exit commitments, emit:

- `VTXO renewed` for the refreshed component;
- `Collaborative exit` for the net negative `delta`.

Do not classify a commitment as only renewal unless BTC value and asset deltas
are neutral.

## Boarding-Mixed Commitments

`commitmentsToIgnore` only tells us that a commitment spent one or more boarding
outputs. It does not currently expose the boarding amount per commitment. That
is enough to hide duplicate boarding-derived batch receives, but it is not
enough to precisely decompose every commitment that combines boarding, renewal,
and fresh received value.

For Milestone 3:

- always emit boarding deposits from `getBoardingTxs().boardingTxs`;
- for a `commitmentsToIgnore` commitment, still emit a renewal row if the
  created VTXO value covers the spent VTXO value and asset deltas do not
  contradict a refresh;
- do not emit a normal batch receive for value that may be attributable to
  boarding;
- if there is leftover created value that cannot be attributed safely, emit an
  `"Arkade settlement"` fallback row with `status: "info"` and metadata
  containing the commitment id and unresolved amount.

Preferred SDK follow-up: expose boarding inputs grouped by commitment, for
example:

```ts
type BoardingCommitmentInput = {
  commitmentTxid: string;
  boardingTxids: string[];
  amountSats: number;
};
```

Once available, compute external net receive as:

```ts
externalDelta = createdAmount - spentAmount - boardingAmount;
```

Then classify only `externalDelta > 0` as fresh Arkade receive.

## Asset Activity

Assets are out of scope as a supported wallet feature for this milestone. The
app should not add asset balances, asset detail screens, minting, burning,
reissuance, asset sending, or asset import UX.

However, the Activity list should still represent asset-related history when
the wallet has asset-bearing VTXOs or asset-bearing transactions. Otherwise the
app can mislead the user by showing the anchor transaction as a normal small
Bitcoin/Arkade payment.

SDK and sibling wallet findings:

- SDK `Recipient.amount` defaults to the dust amount (`330`) when assets are
  sent with no explicit BTC amount.
- SDK `Asset` is `{ assetId, amount }`, with `AssetDetails` carrying optional
  immutable metadata such as `name`, `ticker`, `decimals`, and `icon`.
- SDK issuance returns `{ arkTxId, assetId }`; the permanent asset id is derived
  from the Arkade transaction id and asset group index.
- The sibling wallet treats `tx.type === "sent" && tx.amount === 0` with a
  positive asset delta as issuance, and with a negative asset delta as burn.

For Trixie, the Activity builder should inspect asset deltas and emit generic
asset rows instead of plain payment rows when assets are present.

Suggested first-pass titles:

- `"Asset issued"` for a positive asset delta on a zero-sat sent Arkade row.
- `"Asset burned"` for a negative asset delta on a zero-sat sent Arkade row.
- `"Asset received"` for inbound asset deltas.
- `"Asset sent"` for outbound asset deltas that are not clearly burns.
- `"Asset activity"` as the fallback when classification is ambiguous.

Represent these as Activity rows, not as a new asset product surface:

```ts
{
  id: `arkade:asset:${arkTxid}`,
  kind: "wallet_event",
  direction: "self",
  title: "Asset issued",
  status: settled ? "confirmed" : "pending",
  rail: "arkade",
  source: { type: "wallet_event", eventId: `arkade:asset:${arkTxid}` },
  metadata: {
    arkTxid,
    assetId,
    assetAmount,
    anchorAmountSats,
    assetName,
    assetTicker,
    assetDecimals,
  },
}
```

Use `direction: "in"` or `"out"` only when the asset movement is clearly a
receive or send. For issuance/burn, `direction: "self"` is safer because the
event is not a Bitcoin payment.

Do not fetch remote asset icons for Activity rows in this milestone. If metadata
is locally available from the SDK/indexer, display a plain text label such as
ticker/name; otherwise show a truncated asset id.

Classification must distinguish zero-sat asset events from dust-anchor asset
transfers:

- zero-sat sent row plus positive asset delta -> `"Asset issued"`;
- zero-sat sent row plus negative asset delta -> `"Asset burned"`;
- dust-anchor row, commonly `330 SAT`, plus outbound asset delta -> `"Asset sent"`;
- dust-anchor row, commonly `330 SAT`, plus inbound asset delta -> `"Asset received"`;
- any other asset-bearing row that cannot be classified safely -> `"Asset activity"`.

Do not render the dust anchor as the primary amount for an asset row. Preserve it
in metadata as `anchorAmountSats`.

## Timestamp Policy

Use deterministic timestamps per Activity source:

- boarding deposit: `boardingTx.createdAt` from `getBoardingTxs().boardingTxs`;
- offchain receive: received VTXO `createdAt`;
- offchain send with change: change VTXO `createdAt`;
- offchain send without change: `getTxCreatedAt(arkTxid)` when available,
  otherwise SDK-compatible `spentVtxo.createdAt + 1`;
- batch receive: new leaf VTXO `createdAt`;
- collaborative exit with change: change/new leaf VTXO `createdAt`;
- collaborative exit without change: SDK-compatible `spentVtxo.createdAt + 1`
  until a commitment timestamp helper is exposed;
- VTXO renewal: earliest new leaf `createdAt`;
- asset activity: Arkade anchor transaction time, using the same offchain
  timestamp policy as the underlying Arkade row.

## Activity Builder Shape

Add a dedicated module, for example:

- `app/services/arkade/activity-history.ts`

Suggested API:

```ts
export async function getActivityHistory(wallet: Wallet): Promise<Activity[]>;
```

Implementation outline:

1. Fetch and sort all VTXOs oldest to newest.
2. Fetch boarding rows and `commitmentsToIgnore` from
   `wallet.getBoardingTxs()`.
3. Group VTXOs by `arkTxId`, `txid`, and `settledBy`.
4. Build Activity rows directly:
   - boarding receive from `boardingTxs`, not from the leaf-VTXO path;
   - offchain receive;
   - offchain send;
   - batch receive;
   - collaborative exit;
   - VTXO renewal;
   - mixed commitment rows from value-delta decomposition;
   - ambiguous `"Arkade settlement"` fallback rows for boarding-mixed leftovers;
   - asset activity.
5. Use stable ids derived from protocol ids:
   - `arkade:offchain:${arkTxid}`;
   - `arkade:batch:${commitmentTxid}`;
   - `arkade:boarding:${boardingTxid}`;
   - `arkade:exit:${commitmentTxid}`;
   - `arkade:renewal:${commitmentTxid}`;
   - `arkade:settlement:${commitmentTxid}`;
   - `arkade:asset:${arkTxid}`;
6. Sort newest first.

Keep helper functions small and testable:

- `collectAssets(vtxos)`
- `subtractAssets(spent, received)`
- `sumValue(vtxos)`
- `isRenewalGroup(group)`
- `decomposeCommitmentGroup(group)`
- `assetDeltas(spent, received)`
- `classifyAssetActivity(row)`
- `activityId(kind, idValue)`

Export pure helpers such as `isRenewalGroup`, `assetDeltas`,
`decomposeCommitmentGroup`, `classifyAssetActivity`, and `activityId` from
`activity-history.ts` so future fixture tests can exercise them without booting
an SDK wallet.

## Merge Rules

The current Lightning merge policy should remain:

- Lightning swap Activity wins over matching Arkade payment Activity when a
  wallet tx id link exists.
- Unlinked swap rows and Arkade rows can coexist.
- Wallet events such as renewals are never suppressed by Lightning tx links.
- Asset wallet-event rows are never suppressed by Lightning tx links.

Because renewal ids are commitment-based wallet-event ids, they should not
collide with payment ids.

Do not assume local swap `walletTxId` is always an Arkade txid. Send linkage
usually stores an Arkade txid, but receive history-match fallback can store
`arkTxid`, `commitmentTxid`, or `boardingTxid`. Collision safety must come from
namespaced Activity ids such as `arkade:renewal:${commitmentTxid}`, not from raw
txid domains.

## UI Rules

Activity rows should read like user events:

- "Arkade received"
- "Arkade sent"
- "Boarding deposit"
- "Collaborative exit"
- "VTXO renewed"
- "Arkade settlement"
- "Asset issued"
- "Asset burned"
- "Asset received"
- "Asset sent"
- "Lightning received"
- "Lightning sent"
- "Lightning refund"

For renewal rows:

- use `direction: "self"`;
- use the existing repeat-style icon path;
- do not show a `+` or `-` sign;
- consider omitting `amountSats` from the rendered row even if metadata keeps
  the renewed total.

If Activity details are added later, show the commitment txid, renewed amount,
input count, output count, and timestamp there.

For asset rows:

- do not show the anchor `330 SAT` amount as a normal debit/credit;
- show asset name/ticker when available;
- fall back to a truncated asset id when metadata is unavailable;
- keep icons generic until asset icon trust/approval rules are intentionally
  added.

## Testing Notes

> Jest landed in Phase C of the Activity History work (commit `ee73d93`+).
> The fixture list below is preserved as historical record of what M3 set
> out to cover; the test suite that grew from it lives under
> `app/services/arkade/__tests__/activity-history.*.test.ts`. See
> [docs/TESTING.md](./TESTING.md) for current practice.

Minimum fixture cases to preserve:

- offchain receive with no spent inputs;
- offchain send with change;
- offchain send without change;
- batch receive;
- boarding deposit swept into a batch, hidden via `commitmentsToIgnore`;
- collaborative exit with offchain change;
- collaborative exit without change;
- renewal with equal spent and received value;
- renewal with multiple spent VTXOs and multiple new VTXOs;
- mixed non-boarding commitment with renewal plus net receive;
- mixed non-boarding commitment with renewal plus net exit;
- boarding-mixed commitment with provable renewal and no duplicate receive;
- boarding-mixed commitment with unresolved leftover emits `"Arkade settlement"`;
- asset issuance anchor with positive asset delta and zero net sats;
- asset burn with negative asset delta and zero net sats;
- asset receive/send rows do not render as ordinary 330 sat payments;
- Lightning merge still suppresses linked Arkade payment rows.

## Caveats

The equality rule is intentionally conservative. If renewal fees become
explicit or if the server returns a settlement where value decreases for a
non-payment reason, the app should not guess silently. In that case the SDK
should expose a stronger settlement event type or history tag, and the Activity
builder should use that explicit signal.

Mixed commitments are expected. A single commitment can refresh existing wallet
VTXOs and also introduce externally received value, or refresh while exiting
some value. The Activity builder should decompose non-boarding commitments by
value and asset deltas instead of inheriting the SDK's commitment-wide hidden
receive behavior.

The remaining caveat is boarding-mixed commitments. Until the SDK exposes
boarding amounts per commitment, the app cannot always distinguish fresh
external receive value from boarding-derived receive value inside the same
commitment. Use the conservative `"Arkade settlement"` fallback for unresolved
leftovers rather than showing a misleading payment row.

Until then, equal-value same-commitment groups remain the strongest pure-renewal
signal; mixed groups should be decomposed only where value and asset deltas make
the result defensible.

## Action Plan

Sequenced steps with explicit file touchpoints. Each phase ends in a state where
`pnpm check` passes and the app still runs.

### Phase 0 — Pre-flight

1. Confirm the concrete-`Wallet` dependency is acceptable for accessing
   `getBoardingTxs()`. `runtime.ts:1` already imports the concrete `Wallet`
   class, so no surface change is required. File a follow-up ts-sdk task to
   expose boarding-history inputs and per-commitment boarding amounts via the
   public interface.
2. Decide the merge-filter strategy (see Phase 3). Default: keep the linkage
   table format as raw txids; expand each linked raw txid into candidate
   namespaced Activity ids on the merge side.

### Phase 1 — Build `activity-history.ts`

Create `app/services/arkade/activity-history.ts`. Export:

- `getActivityHistory(wallet: Wallet): Promise<Activity[]>` (default export not
  needed; named export to mirror `swap-mappers`).
- Pure helpers: `sumValue`, `collectAssets`, `subtractAssets`, `assetDeltas`,
  `decomposeCommitmentGroup`, `isRenewalGroup`, `classifyAssetActivity`,
  `activityId`.

Internal sequence inside `getActivityHistory`:

1. `const cm = await wallet.getContractManager();`
2. `const contracts = await cm.getContractsWithVtxos();`
3. `const allVtxos = contracts.flatMap((c) => c.vtxos);` then sort
   ascending by `createdAt`.
4. `const { boardingTxs, commitmentsToIgnore } = await wallet.getBoardingTxs();`
5. Create `getTxCreatedAt` from a fresh `ExpoIndexerProvider(arkServerUrl)`
   bound to the wallet's server URL (mirror `transactionHistory.ts:515-518`).
   Either thread the URL through `getActivityHistory` or read it from a
   runtime accessor; do not reach into wallet internals.
6. Build rows in this order:
   - Boarding rows from `boardingTxs` with id `arkade:boarding:${boardingTxid}`,
     direction `in`, title `"Boarding deposit"`, status from
     `tx.settled`. Never derive boarding from leaf VTXOs.
   - Per-commitment groups (non-boarding), via `decomposeCommitmentGroup`:
     classify into pure renewal, pure batch receive, pure exit, mixed
     renewal+receive (two rows), mixed renewal+exit (two rows), or
     `"Arkade settlement"` fallback when boarding-mixed leftovers cannot be
     attributed.
   - Per-commitment groups touching boarding (`commitmentsToIgnore` hit):
     emit a renewal row only when created VTXO value covers spent VTXO
     value and asset deltas are neutral; otherwise emit
     `"Arkade settlement"` with `status: "info"` and the unresolved amount
     in metadata.
   - Offchain receive rows from leaf-less VTXOs that are not spent by any
     `arkTxId` in the set. Id `arkade:offchain:${arkTxid}`.
   - Offchain send rows aggregated per `arkTxId` (mirror
     `transactionHistory.ts:123-171` for change/no-change handling). Id
     `arkade:offchain:${arkTxid}`.
   - Asset rows derived from non-zero asset deltas on Arkade-anchored
     transactions, classified per the Asset Activity section.
7. Sort newest first by `timestamp` and return.

Acceptance for Phase 1:

- Module compiles in isolation.
- All helpers are pure and exported.
- No imports from React Native or the Zustand store.

### Phase 2 — Wire `snapshotWallet`

Edit `app/services/arkade/runtime.ts`:

1. Add import of `getActivityHistory` from `./activity-history`.
2. Remove the `mapArkTxs` import from `./mappers`.
3. In `snapshotWallet` (currently lines 166-192):
   - Drop `wallet.getTransactionHistory()` from the `Promise.all` tuple.
   - Add `getActivityHistory(wallet)` to the tuple in its place.
   - Replace `activities: mapArkTxs(txs)` with `activities`.
4. Update `WalletSnapshot.activities` (line 36) from
   `ReturnType<typeof mapArkTxs>` to `Activity[]`. Add an `Activity` import
   from `../../store/types`.

Acceptance for Phase 2:

- `pnpm check` clean.
- Snapshot still produces a populated `activities` array on a synced wallet.

### Phase 3 — Update merge filter

Edit `app/services/arkade/swap-mappers.ts:165-187`:

1. Replace the raw-txid `linkedWalletTxIds` set with a namespaced
   `linkedActivityIds` set built directly from each linked raw txid:

   ```ts
   const linkedActivityIds = new Set<string>();
   for (const m of sources.metadata) {
     if (!m.walletTxId) continue;
     const t = m.walletTxId;
     linkedActivityIds.add(`arkade:offchain:${t}`);
     linkedActivityIds.add(`arkade:batch:${t}`);
     linkedActivityIds.add(`arkade:boarding:${t}`);
     linkedActivityIds.add(`arkade:exit:${t}`);
   }
   ```

   Do not include `arkade:renewal:${t}`, `arkade:settlement:${t}`, or
   `arkade:asset:${t}` — those are wallet-event rows and must remain visible
   regardless of Lightning linkage.

2. Replace the existing arkade filter with
   `!linkedActivityIds.has(a.id)`.

3. Update the header doc comment that references `mapArkTxs` to reference
   `getActivityHistory` instead.

4. Consider also matching on Activity `source.type === "arkade_tx"` only when
   tightening, but the namespaced-id check is sufficient for now.

Acceptance for Phase 3:

- A linked reverse swap with a known `walletTxId` produces exactly one row
  in the merged Activity list (the Lightning row), regardless of which of
  `offchain | batch | boarding` the Arkade builder picked.
- A renewal row coexists with a Lightning swap that happens to share its
  commitment id (cannot collide: linkage stores the swap's txid, not the
  commitment id, and the namespaced expansion does not include
  `arkade:renewal:`).

### Phase 4 — Cleanup

1. Delete `app/services/arkade/mappers.ts`.
2. Search the repo for any remaining `mapArkTxs` / `mapArkTxToActivity`
   references and remove them. The known callers at the time of writing are
   `runtime.ts` only.
3. Update the `mergeActivities` JSDoc to drop the `Per MILESTONE_2` reference
   to `mapArkTxs` or rephrase.

Acceptance for Phase 4:

- `pnpm check` clean.
- `grep mapArkTxs` returns no hits.

### Phase 5 — Manual regtest verification

No automated harness exists. Walk through these flows on regtest with a
freshly synced wallet:

1. Boarding deposit: send onchain to the boarding address and confirm the
   row reads `"Boarding deposit"`.
2. Settle the boarding deposit and confirm no duplicate batch-receive row
   appears for the same commitment.
3. Offchain receive: receive from another Arkade wallet; row should be
   `"Arkade received"` with id `arkade:offchain:${arkTxid}`.
4. Offchain send with change.
5. Offchain send without change.
6. Trigger a VTXO renewal (vtxo-auto-renewal or manual settle of an aging
   leaf). Expect a `"VTXO renewed"` row with `direction: "self"` and no
   debit/credit amount in the row.
7. Lightning receive against a fresh reverse swap: expect exactly one row
   (Lightning), no Arkade duplicate.
8. Lightning send via submarine swap: expect a single `"Lightning sent"` row.
9. Restart the app and confirm Activity ids are byte-identical to the
   pre-restart snapshot for the same VTXO state.

Cases that may be hard to produce on regtest (mixed renewal+receive,
boarding-mixed leftovers, asset issuance/burn) should be exercised once
fixture inputs become available; until then, document them as
implementation-validated rather than user-validated.

### Phase 6 — Follow-ups (track separately)

- ts-sdk: expose boarding inputs grouped by commitment
  (`BoardingCommitmentInput`) so `externalDelta` can be computed and the
  `"Arkade settlement"` fallback can be removed.
- ts-sdk: add a commitment-timestamp helper so collaborative-exit-without-
  change rows stop relying on `vtxo.createdAt + 1`.
- ts-sdk: hoist `getBoardingTxs()` to `IReadonlyWallet` (or add a dedicated
  helper) so Trixie no longer depends on the concrete `Wallet` class for
  Activity derivation.
- Trixie: add a fixture-test harness for `activity-history.ts` once a Node
  test framework is configured.
