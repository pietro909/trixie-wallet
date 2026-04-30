# Milestone 5: Bitcoin On-Chain Send (Collaborative Exit)

Goal: turn on Bitcoin on-chain sends. The user pastes a Bitcoin address, enters
an amount, taps Send, and the wallet performs a collaborative exit to that
address through the next Arkade settlement round.

This is wiring work, not new protocol surface. The SDK already exposes
`Ramps.offboard(destinationAddress, feeInfo, amount?, eventCallback?)` and the
Activity layer (Milestone 3) already emits `"Collaborative exit"` rows.
Milestone 5 connects them through the existing send pipeline and adds a real
fee preview to the Review screen.

This milestone should prove:

- A user can send any positive amount up to their offchain balance to a valid
  Bitcoin address on the active network.
- The Review screen shows a real fee estimate before the user taps Send, not
  the placeholder `"Calculated by Arkade"`.
- The user is told plainly that the send is not instant — it lands when the
  next batch round finalises.
- A `"Collaborative exit"` Activity row appears after the send and is
  inspectable through the Milestone 4 details screen.
- An invalid address (wrong network, malformed) is caught before the send is
  attempted and shown inline on the Review screen.

## Current State

- `app/services/sendExecutor.ts:31-32` returns
  `"Bitcoin on-chain sends are not available yet."` for any
  `option.type === "bitcoin"`. `isPayableInThisMilestone()` gates the same.
- `app/services/paymentParser.ts` already classifies Bitcoin bech32/legacy
  inputs as `type: "bitcoin"` with `isPayable: true` and a `warning` for
  malformed payloads. No parser change is needed.
- `app/store/useAppStore.ts` exposes `sendArkade()` and `sendLightning()` but
  no `sendOnchain()`.
- `app/services/arkade/runtime.ts:fetchServerInfo` already pulls
  `info.fees.txFeeRate` from the Ark server but discards `info.fees.intentFee`.
  It needs to be propagated so the Review screen can estimate fees without
  re-querying.
- `app/services/arkade/activity-history.ts` already emits exit rows
  (`activityId("exit", commitmentTxid)`) with `direction: "out"` and the right
  amount. M5 does not need to add a new Activity kind.
- `app/screens/send/SendReviewScreen.tsx` shows a static
  `Row label="Network fee" value="Calculated by Arkade"` and a generic
  yellow notice. Both must be replaced with a real fee preview and a timing
  notice for on-chain sends.

## SDK Findings

`@arkade-os/sdk` provides everything we need:

- `Ramps` (`wallet/ramps.d.ts`): convenience wrapper around `Wallet.settle`.
  Constructor takes a `Wallet`. `offboard(destinationAddress, feeInfo, amount?,
  eventCallback?)` returns the Arkade settlement transaction id and accepts a
  `SettlementEvent` callback that fires through the batch lifecycle
  (`StreamStarted` → `BatchStarted` → tree signing → `BatchFinalization` →
  `BatchFinalized` | `BatchFailed`).
- `FeeInfo` (`providers/ark.d.ts`): `{ intentFee: IntentFeeConfig; txFeeRate:
  string }`. Already returned by `ArkProvider.getInfo()`. We discard
  `intentFee` today.
- `Estimator` (`arkfee/estimator.d.ts`): pure CEL evaluator constructed from
  `IntentFeeConfig`. `evalOffchainInput`, `evalOnchainOutput`, and `eval()` are
  the shapes we need: vtxos in, exit output(s) out, returns a
  `FeeAmount` (rounded up to whole sats).
- `Wallet.MIN_FEE_RATE`: defensive floor, already a static on the SDK class.
- `Wallet._txLock`: serialises `send`, `settle`, and `sendBitcoin`. The
  background `VtxoManager` renewal goes through the same lock, so a manual
  offboard cannot race with auto-renewal — the SDK handles that for us.

The collaborative exit consumes vtxos and produces an onchain output to the
destination address through the same settlement round that handles renewals
and onboarding. From a protocol view, that means:

- Boarding utxos cannot be offboarded directly — they must onboard first
  (`Ramps.onboard`), then be offboarded as vtxos. In Trixie this happens
  automatically when delegated/auto-renewal is on (`boardingUtxoSweep: true`
  in `runtime.ts:buildWallet`). M5 must therefore quote the
  **available offchain balance** as the upper bound, not the total balance.
- The exit only finalises when the next batch round closes. That can take up
  to one settlement period (~minutes on mutinynet today).

## Product Rules

- **Network fence:** the destination address must decode as a Bitcoin address
  for the *active* network (`network.detectedNetwork`). A `bc1…` mainnet
  address from a `mutinynet` wallet must be rejected at parse time, not at
  send time. Use the wallet's network, not navigator-level guessing.
- **Amount:** partial offboard via the `amount` argument. Default behaviour is
  the value the user typed in `SendAmountScreen`; do not silently drain the
  wallet. Reject when `amount > balance.available` (offchain only — boarding
  does not count).
- **Timing:** the Review screen and the Result screen must say the send is not
  instant. Suggested copy: *"On-chain sends are settled by Arkade in the next
  batch round and confirmed on-chain afterwards."* Avoid implying instant
  finality.
- **Identifier expectation:** the value returned from `Ramps.offboard` is the
  Arkade settlement (commitment) tx id. The actual Bitcoin tx id is observable
  later via the indexer or a Bitcoin explorer. Display the commitment tx id
  initially; treat the Bitcoin tx id as deferred enrichment, consistent with
  M4's "render only what's persisted" rule.
- **Activity:** the next `refreshWallet()` (after settlement) materialises the
  `"Collaborative exit"` row through `activity-history.ts`. Do not synthesise
  a row in the send flow — the wallet is the source of truth.
- **Cancellability:** Once `Ramps.offboard` is called, the intent is in the
  pool. Treat the operation as best-effort and not reversible from the UI.
  Do not surface a Cancel button mid-flow.
- **Fee transparency:** show the estimated fee on Review with a hint that the
  actual fee is finalised at settlement. Do not pretend the estimate is the
  exact fee.

## Selected Direction

Wrap `Ramps.offboard` in a new `sendOnchain` store action and surface fee
estimates from the wallet's cached `ArkInfo`. Keep the existing `executeSend`
shape so the SendReview/SendResult screens need only minimal changes.

```ts
// useAppStore.ts (sketch)
sendOnchain: async (
  address: string,
  amountSats: number,
): Promise<{ txId: string; feeSats: number; amountSats: number }>;
```

The action:

1. Validates the address with `network.detectedNetwork`.
2. Pulls the cached `feeInfo` from `network.serverInfo` (extended in M5 to
   carry the full `FeeInfo`).
3. Calls `new Ramps(wallet).offboard(address, feeInfo, BigInt(amountSats))`.
4. On success: best-effort `refreshWallet()` to surface the exit row, return
   the commitment tx id and the estimated fee that was used.
5. Maps thrown errors to `ArkadeError` codes (`send_failed`,
   `insufficient_balance`, `server_unreachable`).

Do **not** introduce a separate "ramps" abstraction layer in `runtime.ts`.
`Ramps` is a thin SDK helper; instantiate it inline in `useAppStore.sendOnchain`
the same way `sendArkade` calls `wallet.send` directly.

## Address Validation

Add a small helper in `app/services/paymentParser.ts` (or alongside it) that
tightens validation when the wallet's network is known:

```ts
export function isBitcoinAddressForNetwork(
  address: string,
  network: NetworkName,
): boolean;
```

Backed by `bitcoinjs-lib` / `@scure/btc-signer` address decoding (already a
transitive dep). The parser already accepts both legacy and bech32 forms; this
helper just enforces the active network's prefix (`bc1`/`1`/`3` for mainnet,
`tb1`/`m`/`n`/`2` for testnet/signet/mutinynet/regtest).

`paymentParser.parsePaymentInput` should consume this helper and downgrade the
parsed option to `isPayable: false, warning: "Wrong-network Bitcoin address"`
when the parser knows the active network. Pass the network in via an existing
or new parser option — do not read from the store inside the parser.

## Fee Preview

Two pieces of information drive the preview:

- `txFeeRate` from `ArkInfo.fees`, in sat/vbyte.
- `intentFee` (`IntentFeeConfig`) from `ArkInfo.fees`, used to construct an
  `Estimator`.

Compute the estimate purely on the client:

```
const estimator = new Estimator(intentFee);
const fee = estimator.eval(
  offchainInputs,         // vtxos coin-selected for the amount
  [],                     // no onchain (boarding) inputs
  changeOutputs,          // optional offchain change back to ourselves
  [{ amount, script }],   // the collaborative-exit output
);
const totalFeeSats = fee.satoshis + Math.ceil(txWeight * txFeeRate / 4);
```

Suggested home: `app/services/arkade/feePreview.ts` exporting

```ts
estimateOffboardFee(input: {
  vtxos: ExtendedVirtualCoin[];
  amountSats: number;
  destinationAddress: string;
  feeInfo: FeeInfo;
}): { feeSats: number; selectedVtxos: ExtendedVirtualCoin[]; changeSats: number };
```

Reuse `selectVirtualCoins` from `@arkade-os/sdk` for selection, so the preview
matches what `offboard` will do at send time.

The Review screen should:

- Replace `"Calculated by Arkade"` with the estimated fee, expressed in the
  user's selected unit (`useFormatSats`).
- Show a small subtitle like *"Estimate — finalised at settlement."*.
- Show the timing notice in place of the existing yellow notice when
  `option.type === "bitcoin"`.
- Disable the Send button if the estimate fails (server unreachable, no
  selectable vtxos, amount above offchain balance).

Persist the most-recently fetched `FeeInfo` on the store as part of
`network.serverInfo` so the Review screen does not reach across screens to
trigger a probe. M5 should extend `ArkadeServerInfo` to include `intentFee`
alongside the existing `txFeeRate`.

## Settlement Progress UX

A collaborative exit can take a settlement round to land. The send flow
should not block the UI for that long, but it should report progress.

Two paths, in order of preference:

1. **Optimistic Result screen.** Submit the offboard, immediately replace to
   `SendResult` with `status: "success"` and a `pending: true` flag. Body copy
   reads *"Submitted. The on-chain transaction will appear once Arkade closes
   the next batch round."* The Activity list will pick up the
   `"Collaborative exit"` row after the existing `incoming-funds` /
   `refreshWallet` cycle finishes.
2. **Inline event callback (later).** Pass a `SettlementEvent` callback to
   `Ramps.offboard` and reflect intermediate states (`StreamStarted`,
   `BatchStarted`, `BatchFinalization`) on a new sending screen. Useful for
   debugging but not required to ship M5; defer unless QA reports the
   optimistic path is confusing.

The `SendResult` route's `paymentType: "bitcoin"` branch is the natural place
for the *"On-chain settlement is in flight"* copy. Reuse the same screen; no
new route needed.

## Implementation Phasing

Land in phases. Each phase ends with `pnpm check` clean and the app running.

### Phase 1 — Server info + fee preview helper (no UI yet)

- Extend `ArkadeServerInfo` in `app/store/types.ts` to carry the full `FeeInfo`
  (or at minimum `intentFee` + `txFeeRate`).
- Update `runtime.ts:fetchServerInfo` to pass `intentFee` through.
- Add `app/services/arkade/feePreview.ts` exporting `estimateOffboardFee`,
  using `selectVirtualCoins` and `Estimator`.
- Type-only changes plus a new pure helper. No screen changes.

### Phase 2 — `sendOnchain` store action

- Add `sendOnchain(address, amountSats)` to `useAppStore.ts`. Mirror
  `sendArkade`'s shape: ensureWallet, do the call, refresh, persist.
- Use `new Ramps(wallet).offboard(address, feeInfo, BigInt(amountSats))`.
- Map errors via `toArkadeError`. Surface `insufficient_balance` when the
  offchain balance < amount.
- Validate the address against the active network (Phase 4 helper if
  available; otherwise inline check, then refactor in Phase 4).

### Phase 3 — Send executor + Review/Result screens

- In `app/services/sendExecutor.ts`: add a `bitcoin` branch that calls
  `useAppStore.getState().sendOnchain(address, amountSats)`. Remove the
  `case "bitcoin":` early return and the `isPayableInThisMilestone` `false`
  path for `option.type === "bitcoin"`.
- In `SendReviewScreen.tsx`:
  - For `option.type === "bitcoin"`, compute `estimateOffboardFee` once on
    mount via the cached `ArkadeServerInfo` and the wallet's vtxos.
  - Replace the static `"Calculated by Arkade"` row with the estimate.
  - Replace the generic yellow notice with the timing notice.
  - Disable the Send button when the estimate fails or
    `amountSats > balance.available`.
- In `SendResultScreen.tsx`: when `paymentType === "bitcoin"`, render a
  *"Settlement in flight"* helper line beneath the success state.

### Phase 4 — Address validation hardening

- Implement `isBitcoinAddressForNetwork` (see Address Validation). Use it in
  `paymentParser.parsePaymentInput` when the network is known and in
  `sendOnchain` as a defence-in-depth check.
- Snapshot the validation outcome in `ParsedPaymentOption.warning` so the
  same string drives the Review screen banner — keep one source of truth for
  the user-visible message.

### Phase 5 — Settlement event progress (optional, defer if not needed)

- Pass a `SettlementEvent` callback into `Ramps.offboard`. Convert events to
  a tiny progress state and surface either via the existing
  `LoadingOverlay` or a new step-list on a sending screen.
- Defer until QA shows the optimistic Phase 3 flow is confusing.

## Testing Notes

No test framework is configured. The pieces that benefit most from unit-style
testability without React Native:

- `isBitcoinAddressForNetwork` — table-test the four networks plus malformed
  inputs.
- `estimateOffboardFee` — given a fixed `FeeInfo` and a synthetic vtxo set,
  assert that fee + change + selected inputs match `Ramps.offboard`'s
  selection. The SDK's `selectVirtualCoins` can be exercised directly.

Manual emulator checks:

- Mutinynet wallet, paste a `tb1…` address → Review shows real fee, timing
  notice, Send works, exit row appears after refresh.
- Paste a `bc1…` (mainnet) address into a mutinynet wallet → Review surfaces
  *"Wrong-network Bitcoin address"* and Send is disabled.
- Paste a malformed `tb1qxxx` → existing parser warning still wins.
- Paste a `tb1…` then enter an amount above offchain balance → Review
  surfaces `insufficient_balance` and Send is disabled.
- Trigger an offboard with delegated auto-renewal on → background renewal
  should not race or surface an extra Activity row beyond the expected exit
  + renewal pair documented in M3.

## Phase 6 — Chain Swap Rail (Deferred Follow-Up)

A second rail to the same destination: send to a Bitcoin address through a
Boltz **ARK → BTC chain swap** instead of waiting for the next batch round.
The user-facing axis is *fast vs cheap*, not *collab exit vs chain swap* — both
land sats at the same address, they just price and time differently.

The economics (verified against the live Boltz quote):

- Chain swap = mainnet miner fee for Boltz's claim tx + percentage spread
  (e.g. 168 sats + 485 sats on a 100k mainnet send). The percentage scales
  with amount and is unavoidable — Boltz needs revenue to broadcast a real
  mainnet tx for *just your output*.
- Collab exit = sum of `Estimator.evalOffchainInput` per consumed vtxo plus
  `evalOnchainOutput` for the destination. No third-party spread. On
  mainnet this will be non-zero (mutinynet returns empty CEL programs and
  `txFeeRate=0`, so it estimates to 0 there) but expected to be lower than
  any reasonable Boltz spread.
- Latency: chain swap settles in ~1 mainnet confirmation (~10 min). Collab
  exit waits for the next Arkade settlement round (~minutes on mutinynet,
  variable on mainnet).

### Current State

- `app/services/arkade/lightning.ts` already constructs `ArkadeSwaps`. The
  chain swap APIs (`arkToBtc`, `getChainFees`, `getChainLimits`, `claimBtc`,
  `refundArk`, `waitAndClaimBtc`) are exposed via the same instance and are
  unused.
- `app/services/arkade/lightning.ts:restoreLightningActivity` already
  surfaces `chainCount` from `restoreSwaps()`, but there is no further
  plumbing.
- `app/services/arkade/swap-mappers.ts:221` notes chain swaps are
  "tolerated by the mapper but rendered as a generic Lightning activity
  row" — needs proper chain-swap mapping to render as a Bitcoin rail row.
- `app/screens/send/SendReviewScreen.tsx` currently quotes only the collab
  exit estimate for `option.type === "bitcoin"`.

### SDK Findings

- `ArkadeSwaps.arkToBtc({ btcAddress, receiverLockAmount })` →
  `ArkToBtcResponse = { arkAddress, amountToPay, pendingSwap: BoltzChainSwap }`.
  Use `receiverLockAmount` (recipient gets exactly this; sender pays
  `amountToPay`) to keep the user's typed amount = destination amount,
  matching Lightning's UX.
- After creation: `wallet.send({ address: arkAddress, amount: amountToPay })`
  is the offchain leg into Boltz's lockup vtxo. Then
  `arkadeSwaps.waitAndClaimBtc(pendingSwap)` resolves with the mainnet
  `{ txid }` once Boltz claims and broadcasts.
- Limits: `getChainLimits("ARK", "BTC")` → `{ min, max }` (sats).
- Fees: `getChainFees("ARK", "BTC")` → `ChainFeesResponse =
  { percentage, minerFees: { server, user: { claim, lockup } } }`.
  Total user pays ≈ `receiver + receiver*percentage/100 + minerFees.server +
  minerFees.user.claim` (mirror `../wallet/src/providers/swaps.tsx:180-184`'s
  `calcArkToBtcSwapFee`).
- Refund path: `arkadeSwaps.refundArk(pendingSwap)` if Boltz fails to claim
  before timeout. Needs persisted `BoltzChainSwap` (preimage, ephemeralKey)
  to reconstruct the refund tx.

### Product Rules

- **Default rail:** collab exit (cheaper). Surface chain swap as the
  *Fast* alternative on Review only.
- **Network gate:** chain swap rail only available where Boltz is
  configured (mutinynet, bitcoin). Hide entirely on regtest. Reuse
  `isLightningSupportedForNetwork` rather than introducing a parallel
  helper — Boltz availability is the same gate.
- **Limits gate:** if `amount` is outside `getChainLimits`, the rail is
  disabled with an inline reason ("Chain swap supports 1k–25M sats").
- **Boltz reachability:** if `getChainFees` fails on mount, hide the chain
  swap toggle silently and fall back to collab exit only — do not block
  the Send button.
- **Receiver semantics:** the destination receives the user's typed amount
  exactly. Boltz's spread + miner fees are added to the offchain leg, not
  deducted from the destination. This matches Lightning send.
- **Pending state:** chain swap creates a row in Activity immediately on
  submit (consistent with submarine-swap rows from M2). Subsequent status
  events update the row in place.
- **Refund:** if `waitAndClaimBtc` fails or times out, the funds stay
  locked in the Boltz vtxo. Local metadata must persist enough to call
  `refundArk` later. Full refund UX is M8 territory — for M5b, log the
  pending refund and surface it in the Activity detail screen.
- **Cancellability:** once the offchain leg fires, the swap is in flight.
  No mid-flow cancel.

### Selected Direction

Wrap the create + send + claim cycle in a new store action mirroring
`sendOnchain`'s shape:

```ts
sendChainSwap: async (
  address: string,
  amountSats: number, // what destination receives
): Promise<{ txId: string; feeSats: number; amountSats: number; swapId: string }>;
```

Add a small client-side quote helper for the Review screen so the toggle
can show both rails' fees side-by-side without firing two settlements.

```ts
quoteArkToBtcChainSwap(amountSats: number): Promise<{
  feeSats: number;       // total Boltz cost for the user
  percentageFee: number;
  minerFeeSats: number;  // claim + server miner fees
  withinLimits: boolean;
  min: number;
  max: number;
}>;
```

Do **not** introduce a new "chainSwap" service file beyond a thin helper.
The SwapManager / ArkadeSwaps instance already exists; use it directly the
same way `sendLightning` does.

### Implementation Phasing

Land in phases. Each phase ends with `pnpm check` clean and the app
running.

#### Phase 6.1 — Chain swap quote helper (no UI yet)

- Add `quoteArkToBtcChainSwap` to `app/services/arkade/lightning.ts` (or
  a sibling `chainSwap.ts` if `lightning.ts` grows past comprehension).
- Cache the latest `ChainFeesResponse` and `LimitsResponse` for the active
  network — refresh on `ensureLightning` boot, not per-quote.
- Add `isChainSwapSupportedForNetwork(network)` reusing the existing
  Boltz network gate.

#### Phase 6.2 — `sendChainSwap` store action

- Add `sendChainSwap(address, amountSats)` to `useAppStore.ts`. Steps:
  1. `arkadeSwaps.arkToBtc({ btcAddress: address, receiverLockAmount: amountSats })`.
  2. `recordSwapMetadata({ swapId, walletId, direction: "out",
     createdForFlow: "send", invoiceAmountSats: amountSats,
     arkadeAmountSats: amountToPay })` — same shape as submarine swaps so
     the Activity merge layer recognises it.
  3. `wallet.send({ address: arkAddress, amount: amountToPay })` — offchain
     leg.
  4. `linkSwapToWalletTx({ swapId, walletTxId, source: "send_result" })`.
  5. `arkadeSwaps.waitAndClaimBtc(pendingSwap)` (best-effort; the swap row
     covers the long-running case).
  6. `refreshWallet()` — pick up the offchain leg in Activity.
- Map errors via `toArkadeError` to `swap_create_failed`, `send_failed`,
  `swap_settle_failed`.

#### Phase 6.3 — Chain swap Activity row

- Update `swap-mappers.ts:mapSwapToActivity` — add a `swap.type === "chain"`
  branch that renders as `rail: "bitcoin"`, title *"Sent to Bitcoin (Chain
  swap)"*, status mapped via `isChainPendingStatus` /
  `isChainSuccessStatus` / `isChainFailedStatus` /
  `isChainRefundableStatus`, metadata carrying `swapId`, `mainnetTxid`
  (when known), and the Boltz fee.
- Refundable status surfaces a "Refund available" pill — wiring the actual
  refund button is a follow-up, but the metadata must already be there.

#### Phase 6.4 — Review screen rail toggle

- On `SendReviewScreen` for `option.type === "bitcoin"`:
  - On mount, fire both `estimateOffboardFee` (collab exit) and
    `quoteArkToBtcChainSwap` (chain swap) in parallel. Each can fail
    independently.
  - Render a segmented control: `[ Cheap (next batch) | Fast (chain swap) ]`.
    Disable the Fast tab when its quote fails; disable Cheap when collab
    exit estimate fails. If both fail, fall through to existing
    error-notice path.
  - Show the selected rail's fee row + timing notice. Timing copy:
    - Cheap → existing "On-chain sends are settled by Arkade in the next
      batch round and confirmed on-chain afterwards."
    - Fast → "Settles in one Bitcoin confirmation (~10 min)."
  - Default selection: collab exit. Persist the user's last choice across
    sends (within the session, not across app restarts — keep this purely
    in `useState` for now).
- On Send: dispatch to `sendOnchain` or `sendChainSwap` based on the
  selected rail.

#### Phase 6.5 — Refund recovery surface (deferred to M8)

- When a chain swap surfaces in `isChainRefundableStatus`, the Activity
  detail screen exposes a "Refund" action that calls
  `arkadeSwaps.refundArk(pendingSwap)`.
- Background refund loop is M8's responsibility — for now, only the
  manual button.

### Testing Notes (Phase 6)

Manual emulator checks, in addition to the M5 list:

- Mutinynet, paste `tb1…`, Review screen renders both fees with the
  segmented toggle. Toggling between rails updates the fee row and timing
  notice.
- Tap Fast, Send: chain swap row appears as pending in Activity within a
  few seconds; transitions to confirmed once Boltz claims. Mainnet
  `txid` shown in detail screen.
- Amount below `min` (typically 1k sats): Fast tab disabled with reason.
- Amount above `max`: Fast tab disabled with reason.
- Boltz API down (simulate by blocking `boltz.mutinynet.arkade.sh`): Fast
  tab hidden, Cheap still works.
- Force-quit between offchain leg and Boltz claim: on next app start,
  `restoreLightningActivity` should resurface the pending chain swap row.
  Refund button reachable via Activity detail.
- Comparison render: 100k-sat send shows Cheap ≈ small CEL-based fee,
  Fast ≈ `~percentage*amount + miner fees` — confirm the toggle's number
  matches the Boltz quote (within rounding).
