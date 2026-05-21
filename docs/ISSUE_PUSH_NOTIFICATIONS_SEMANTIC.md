# RESOLVED

# Issue: Push Notifications Need Semantic Classification

**Status:** RESOLVED — delivered in two passes:

- Steps 1–5 (policy mapper, activity-delta detector, neutral background swap copy, tests) landed in commit `d66f666` ("Fix push-notification double-buzz and cold-start flag clobber").
- Step 6 (toggle relabel in `app/screens/ProfilePreferences.tsx`, routing comment in `app/services/notifications.ts`) landed alongside this doc move.
- Step 7 (manual QA matrix) is a device-side verification owned by the maintainer.

## Summary

Push notifications and foreground toasts are currently emitted from low-level wallet and swap events, not from semantically classified user-facing activities. This causes incorrect messages such as:

- `VTXO renewed` surfacing as `Payment received`
- payment send flows surfacing `Payment received`
- background swap claims being described as received payments even when the event is only a protocol-level swap completion

The notification system needs to be driven by semantic activity classification rather than raw transport- or contract-level callbacks.

## Observed Problems

### Problem 1: Foreground incoming-funds callback is too low-level

The foreground listener in [app/store/useAppStore.ts](./app/store/useAppStore.ts) currently does this:

- subscribes to `setIncomingFundsListener(...)`
- immediately shows `Payment received`
- then triggers `refreshWallet()`

That callback is not a "user received money" signal. It is just a raw SDK incoming-funds callback.

### Problem 2: SDK callback shape is transport-level, not user-level

The SDK's `IncomingFunds` type is:

- `{ type: "utxo", coins }`
- `{ type: "vtxo", newVtxos, spentVtxos }`

And the SDK implementation of `notifyIncomingFunds()` emits contract-level updates:

- `vtxo_received` -> `newVtxos`
- `vtxo_spent` -> `spentVtxos`

This means the callback can fire for:

- true inbound funds
- pure VTXO renewals
- outgoing payments that still produce replacement or change VTXOs

So using that callback directly for user-facing notification copy is semantically incorrect.

### Problem 3: Background swap copy also over-classifies

The background swap notification path in [app/services/arkade/swap-background.ts](./app/services/arkade/swap-background.ts) currently maps claimed swaps to `Payment Received`.

The foreground drain path in [app/services/arkade/lightning.ts](./app/services/arkade/lightning.ts) similarly says `Received X payments in background`.

That wording is too strong unless the app has already mapped the swap result to a concrete inbound payment activity row.

## Why The App Already Has Enough Information

The activity builder in [app/services/arkade/activity-history.ts](./app/services/arkade/activity-history.ts) already distinguishes:

- `wallet_event` rows such as `VTXO renewed`
- true inbound `payment` rows
- mixed cases such as `renewal_plus_receive`, which emit both:
  - a `wallet_event` renewal row
  - a separate inbound `payment` row

So the app already has a semantic model that can tell the difference. The problem is that notifications are emitted too early, before the event has been classified into that model.

## Root Cause

Notification and toast emission currently happens from raw SDK or swap task callbacks instead of from semantically classified activities.

In other words:

- activity rendering is driven by the app's semantic model
- notification copy is driven by lower-level signals

Those two systems have drifted apart, and the low-level one is now incorrect.

## High-Level Plan

### 1. Stop using raw `notifyIncomingFunds` as a user-facing notification source

Keep `setIncomingFundsListener(...)` only as a refresh trigger.

Plan:

- remove direct `Payment received` toast emission from the incoming-funds listener
- keep the callback for coalesced `refreshWallet()` only

Rationale:

- raw `IncomingFunds` is too low-level to determine whether the user actually received spendable money
- it cannot reliably distinguish receive vs renewal vs send-with-change

### 2. Centralize notification policy in one mapper (do this first)

Add a small policy layer that takes semantic input and decides:

- whether to notify at all
- whether to show a toast or local notification
- what title/body/category to use

This must be built **before** the activity-delta detector in step 3, because step 3 needs a typed sink to emit into. Without the mapper, the delta detector and the swap paths each re-implement category routing and copy selection, and the two will drift again.

Input shape (proposed):

```ts
type WalletNotificationEvent =
  | { source: "activity"; activity: Activity; reason: "appeared" | "transitioned" }
  | { source: "swap_drain"; claimed: number; refunded: number; context: "foreground" | "background" };
```

Output shape:

```ts
type NotificationDecision =
  | { kind: "none" }
  | { kind: "toast"; message: string; tone: "success" | "info" | "error" }
  | { kind: "local_notification"; title: string; body: string; channelId: "swaps" | "payments" | "default" };
```

The mapper owns:

- the `shouldNotify(category)` gate (currently duplicated between [app/services/notifications.ts](./app/services/notifications.ts) and the foreground drain in [app/services/arkade/lightning.ts](./app/services/arkade/lightning.ts))
- the category routing decision (see step 6 below — `payments` vs `swaps`)
- all user-facing copy strings, so a single edit changes wording everywhere

File location (proposed): `app/services/notifications/policy.ts`, with `app/services/notifications.ts` reduced to the OS-level scheduling primitives.

Rationale:

- prevents copy and classification drift across foreground, background, and resume paths
- creates one place to reason about notification correctness
- lets steps 3 and 4 each be implementations of the same emitter, not new emitters

### 3. Move foreground payment toasts to semantic activity-delta detection

After `refreshWallet()` completes, compare the new activity snapshot against the previous one and emit through the policy mapper only for newly appeared rows that are truly user-facing inbound payments.

Candidate criteria for emitting a "received" notification:

- `activity.kind === "payment"`
- `activity.direction === "in"`
- not `wallet_event`
- not a protocol-maintenance-only row
- rail-aware (`arkade`, `lightning`, `bitcoin`) if copy should differ

**Implementation subtleties — do not skip:**

- **Atomic snapshot capture.** Capture `previousActivities` from the same `useAppStore.getState().wallet` read that the new snapshot is about to replace, inside the `refreshWalletOnce` closure in [app/store/useAppStore.ts](./app/store/useAppStore.ts) (currently lines ~1225-1255). Doing the diff from the incoming-funds listener instead would race the store update.
- **Initial-snapshot suppression.** On the first refresh after `hydrate()` (or after `createWallet` / `restoreWallet`), there is no prior in-memory baseline — the persisted activities just loaded from JSON. Track a per-walletId `hasEmittedBaseline` flag in module scope; the first diff after hydration records the baseline and emits nothing. Without this, the user gets a toast storm on every cold start.
- **Stable identity keys.** Diff by `activity.id`. The IDs produced by `activityId(...)` in [app/services/arkade/activity-history.ts](./app/services/arkade/activity-history.ts) are stable across refreshes — a pending row keeps the same id when it transitions to confirmed.
- **Per-session de-dup set.** Keep a `toastedActivityIds: Set<string>` in module scope so a second refresh that re-emits the same row (debounced refresh, swap-event-driven refresh, resume-driven refresh all converge here) cannot double-toast. Clear on lock / reset / wallet swap.
- **Pending → confirmed transitions.** A pending outbound row becoming confirmed must not produce a toast, since the user already saw the send confirmation UI. The diff should only emit on `appeared` (id not in previous snapshot AND not in `toastedActivityIds`), not on `transitioned` (status change).
- **Multiple coalesced refreshes.** `refreshWallet()` re-enters via `refreshPending`. Only the final pass writes to the store, but the diff must be computed against the snapshot from *before* the whole batch started, not the intermediate value. Capture the baseline once at the start of the in-flight wrapper, not inside `refreshWalletOnce`.

Rationale:

- the semantic activity model already exists
- this keeps notifications consistent with what the user sees in Activity history

### 4. Tighten swap notification semantics

Fix both swap notification paths so they do not say `Payment received` unless the event is definitely a user-visible inbound payment.

**Short-term (this issue) — neutral wording:**

- background OS notification:
  - `Swap completed`
  - `Swap refunded`
  - `Swap activity`
- foreground drain after background:
  - `Background swap completed`
  - `X swaps refunded`

**Long-term target — subsume into activity-delta:**

A successful inbound LN claim *does* produce a true `payment` Activity row via the swap → activity mapper in [app/services/arkade/swap-mappers.ts](./app/services/arkade/swap-mappers.ts). The clean end-state is to delete the foreground-drain toast path entirely once step 3 lands and have the activity-delta detector cover claims too. The background OS-tray path is structurally harder — see the next bullet — so a hybrid (semantic foreground + neutral background) is the realistic target.

**Background OS-tray path is structurally constrained.** The swap-poll task in [app/services/arkade/swap-background.ts](./app/services/arkade/swap-background.ts) runs in OS-scheduled headless JS, where the full activity classifier (Zustand store, merged activity list, in-memory metadata caches) is not available. Running the classifier inside the headless task would require duplicating the merge pipeline. For this issue, the headless context keeps neutral copy; semantic copy for headless is a separate follow-up.

Rationale:

- swap completion is not always equivalent to a user-facing inbound payment
- neutral wording is safer until the app ties swap completion to a specific semantic activity row
- preserves the existing `notified` flag de-dup contract in [app/services/arkade/swap-background.ts](./app/services/arkade/swap-background.ts) between background tray and foreground drain

### 5. Add regression tests for the exact reported failures

Minimum cases:

- pure renewal -> no toast, no notification
- outgoing payment with change -> no `Payment received`
- real inbound Arkade receive -> payment toast allowed
- background claimed swap -> neutral swap copy, not `Payment received`
- refunded swap -> refund copy only

Additional cases required by step 3's implementation subtleties:

- **initial-snapshot suppression:** simulate `hydrate()` loading a persisted wallet with N existing activities, run the first `refreshWallet()`, assert zero toasts emitted
- **double-refresh idempotence:** simulate two back-to-back `refreshWallet()` calls (one from `setIncomingFundsListener`, one from `setSwapEventListener`) that both surface the same new inbound row, assert exactly one toast
- **background → foreground de-dup:** simulate a background swap claim with `notified: true` (OS tray fired), then a foreground resume drain — assert no foreground re-toast; the existing `notified` flag contract in `RecordedSwapTaskResult` must keep working
- **iOS permission-denied path:** simulate `scheduleNotificationAsync` resolving but `getPermissionsAsync` reporting non-granted — assert the foreground drain still toasts (no silent miss)
- **pending → confirmed transition:** an existing outbound pending row flips to confirmed, assert no toast

Rationale:

- these failures are classification bugs
- they are likely to regress unless explicitly covered

### 6. Decide and document the `payments` vs `swaps` category routing

Today:

- `notifications.payments` gates the foreground `Payment received` toast
- `notifications.swaps` gates the background swap tray and the foreground drain toast

If swap-claim notifications move to activity-delta detection (step 4 long-term), a user with `payments: false, swaps: true` would silently lose notifications they used to receive. The mapper in step 2 must encode the routing decision explicitly.

Proposal:

- activity-delta detection routes by the row's rail: `arkade` and `bitcoin` inbound payments → `payments`; `lightning` inbound payments → `payments` (since the user-visible event is "Lightning payment received", which is a payment notification, not a swap notification)
- swap-poll notifications (claim/refund counts without semantic context) → `swaps`
- update [app/screens/ProfilePreferences.tsx](./app/screens/ProfilePreferences.tsx) (or wherever the toggles render) so the toggle labels reflect this routing

Document the decision in [app/services/notifications.ts](./app/services/notifications.ts) above `shouldNotify` so future contributors do not re-litigate it.

Rationale:

- the existing `swaps` toggle was a transport-level toggle; it cannot stay so once notifications move to semantic events
- silent behavior change for existing users is worse than re-routing it predictably

### 7. Run a focused manual QA matrix

Verify all of:

- foreground receive
- foreground renewal
- foreground send
- background claim
- background refund
- cold-start with persisted activities (no toast storm)
- background claim followed by foreground resume (no double-buzz)

Rationale:

- these flows cross foreground/background boundaries
- copy and duplicate-suppression bugs are easiest to miss without explicit matrix testing

## Recommended Implementation Order

1. Remove direct `Payment received` toast emission from `setIncomingFundsListener`
2. Build the centralized notification policy mapper (defines the interface for steps 3 and 4)
3. Decide `payments` vs `swaps` category routing and document it in the mapper
4. Add semantic post-refresh detection for newly appeared inbound payment activities, emitting through the mapper
5. Change swap copy to neutral wording, routing through the mapper (foreground drain + background tray)
6. Add regression tests, including the implementation-subtlety cases (initial snapshot, double refresh, background→foreground de-dup, pending→confirmed transition, iOS permission-denied)
7. Run manual verification across the notification matrix

## Open Product Question

Before implementation, one behavior should be made explicit:

- Should successful inbound Lightning claim completion produce a payment-style notification?
- Or should swap-completion messaging stay neutral unless the app can map it to a concrete inbound payment activity row?

Recommended answer:

- foreground: yes, route through activity-delta detection — the LN claim produces a real `payment` Activity row, so it gets a payment notification by virtue of step 3
- background headless context: no — keep neutral copy until the activity classifier can run in headless JS (separate follow-up)

## Expected Outcome

After this change:

- `VTXO renewed` will not surface as `Payment received`
- send flows will not surface as `Payment received`
- swap-related notifications will use semantically accurate wording
- notification behavior will match the app's own activity model instead of raw wallet callbacks
- cold-start no longer storms toasts for historical activities
- a single background claim does not double-buzz across OS tray and foreground drain
- a single edit to the policy mapper changes copy and routing everywhere
