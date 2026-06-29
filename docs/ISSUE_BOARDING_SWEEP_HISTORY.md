# RESOLVED

# Issue 9: SDK Upgrade & Boarding-Sweep History (ts-sdk #587)

**Status:** Resolved
**Last updated:** 2026-06-29

## Resolution Summary

The boarding-sweep double-count is fixed at the source and our compensating
workaround has been removed.

- **SDK upgraded.** `@arkade-os/sdk` `0.4.35 → 0.4.40` and
  `@arkade-os/boltz-swap` `0.3.40 → 0.3.45` (the latter pins `sdk@0.4.40`).
  Version 0.4.40 is the first release containing
  [ts-sdk #587](https://github.com/arkade-os/ts-sdk/pull/587): `getBoardingTxs`
  now recovers the sweep commitment txid from the boarding address's own `vin`
  list (`commitmentByOutpoint`), so `commitmentsToIgnore` is reliable even on
  the default mainnet Esplora (`mempool.arkade.sh`), where `/outspends` returns
  `{"spent":true}` without the spender txid.
- **Amount-based rescue removed.** `app/services/arkade/activity-history.ts` no
  longer reclassifies an *unmarked* commitment to a boarding settlement by
  amount coincidence. The reclassification is now gated on `isBoardingMixed`
  (i.e. `commitmentsToIgnore.has(commitmentTxid)`), which is authoritative. The
  amount match (`findBoardingMatch`) survives only to resolve *which* boarding
  tx a marked settlement links to for the explorer, and its dead
  `requireUnsettled` parameter was dropped.
- **Combined multi-deposit nets correctly.** When several deposits are swept
  into one commitment, that commitment is now marked, so a single "Boarding
  settled" row is emitted for the combined amount with no phantom "Arkade
  received". No single deposit equals the swept total, so the explorer link is
  left unset while the netted amount is still surfaced once.

### Why removing the rescue is also a correctness win

The old amount fallback was not just redundant after #587 — it was unsafe. A
genuine off-chain receive whose value happened to equal a boarding deposit
would have been suppressed and mislabeled as a boarding settlement. Gating on
the authoritative ignore-set preserves real receives.

### Verification

- `app/services/arkade/__tests__/activity-history.trixie.test.ts`
  - **F-12** rewritten: an unmarked `renewal_plus_receive` whose receive part
    coincidentally equals a boarding amount keeps its genuine "Arkade received"
    row and emits **no** `boarding_settled`.
  - **F-14** added: two deposits of different amounts swept into one *marked*
    commitment net to a single `boarding_settled` (combined amount, no linked
    `boardingTxid`) with no phantom receive — the #587 case.
  - F-2 / F-3 / F-13 (SDK-marked settlements and renewal leftovers) unchanged
    and still green.
- Full suite: 457 tests passing; `tsc --noEmit` clean.

### Incidental upgrade fix

`app/services/arkade/lightning.ts` — `sendLightningPayment` now passes
`waitFor: "settled"` explicitly. Since boltz-swap 0.3.45 a plain call resolves
to `OptimisticSendLightningPaymentResponse` (preimage may be absent); requesting
settled semantics selects the strict response and preserves this wrapper's
preimage guarantee, matching the pre-0.3.45 default behavior.

---

## Original Issue (for reference)

### Summary
The SDK fix for phantom "Received" inflation from boarding sweeps
([ts-sdk #587](https://github.com/arkade-os/ts-sdk/pull/587)) was merged to
`master` but unreleased as of the original write-up. We were pinned to
`@arkade-os/sdk` 0.4.35, which predates it.

### Background
On the default mainnet Esplora (`mempool.arkade.sh`), `/outspends` returns
`{"spent":true}` **without** the spender txid. The SDK's
`wallet.getBoardingTxs()` therefore built an unreliable `commitmentsToIgnore`,
so a boarding sweep's resulting VTXO was surfaced *in addition to* the on-chain
boarding deposit(s) — double-counting the inflow (e.g. a 228,532-sat onboard
from two deposits shown as 457,064). #587 fixes this in the SDK by recovering
the sweep commitment txid from the boarding address's own `vin` list.

### Current Behavior (trixie, pre-fix)
- `app/services/arkade/activity-history.ts` re-implemented history
  (`buildActivityHistory`) but still consumed the SDK-derived
  `commitmentsToIgnore` from `wallet.getBoardingTxs()`, inheriting the
  unreliable ignore-set.
- The safety net was the amount-based `findBoardingMatch` fallback — exactly the
  fallback #587 notes is insufficient for combined deposits: when several
  deposits are swept into one VTXO, no single boarding tx equals the combined
  amount, so the match failed and a phantom `batch_receive` was still emitted.
- Net effect: single-deposit onboards were masked by the amount match, but
  **multi-deposit / combined onboards were still double-counted**.

### Expected Behavior
- Track the SDK release that first contains #587; bump `@arkade-os/sdk` to it.
- After upgrading, re-evaluate the custom `findBoardingMatch` / boarding-sweep
  handling: if `getBoardingTxs()` returns a correct `commitmentsToIgnore`,
  simplify or remove the amount-based fallback, and verify the combined
  multi-deposit case nets correctly (no phantom receive).
