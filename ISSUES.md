# Issues

Open items and follow-ups that do not yet belong to a milestone. Items that grew into milestones are tracked in their respective docs instead.

## 1. Background Tasks logs and error reporting

**Status: OPEN**

**Where:** Advanced -> Support Bundle

The "Support Bundle" contains a `backgroundTasks` section like the following:

```json
  "backgroundTasks": {
    "swapPoll": {
      "taskName": "trixie-boltz-swap-poll",
      "totalRuns": 64,
      "totalSuccesses": 58,
      "totalFailures": 6,
      "lastSuccessAt": 1778658707035,
      "lastSuccessDurationMs": null,
      "lastSuccessSummary": {
        "polled": 1,
        "updated": 0,
        "claimed": 0,
        "refunded": 0,
        "errors": 1
      },
      "lastFailureAt": 1778621235211,
      "lastFailureMessage": "Background task failed"
    }
  },
```

The failure message is too generic: is it possible to get a stacktrace or something more specific? What that a network failure? A marhsalling issue? A business-logic inconsistency? DB-related? ...

## 2. Preference toggle persistence is not actually awaited at the call site

**Status: OPEN**

**Where:** `app/screens/ProfilePreferences.tsx` (theme / fiat / bitcoin unit `Pressable`s, notification `Switch`es)

Handlers were updated during Milestone 15 to `onPress={async () => await setThemePref(opt.value)}` and `onValueChange={async (v) => await setNotificationPrefs(...)}` to match the project's "fully durable" persistence goal. In practice this is close to a no-op: `Pressable.onPress` and `Switch.onValueChange` call the handler synchronously and discard the returned promise. Nothing in React Native waits for the persist to land before the gesture is considered complete.

Durability of preference writes is still provided by the store action itself (`setTheme` / `setFiatCurrency` / `setBitcoinUnit` / `setNotificationPreferences` each `await persist(get())` internally). The remaining gap is the small race between the tap and `AsyncStorage.setItem` resolving — if the user immediately backgrounds or kills the app, the write may be lost.

A real fix would either (a) disable the control and show a spinner until the persist resolves, or (b) introduce a top-level persist queue that the app-lifecycle handler flushes before allowing suspension. Both are larger than warranted today; preference writes are cheap and the race window is sub-millisecond. Tracking so the M15 retrospective wording does not imply more than what's implemented.

## 3. Password gate hashes with SHA-256 instead of a KDF

**Status: RESOLVED** — `hashPassword` now uses PBKDF2-SHA256 at 300k iterations, the unlock minimum was raised to 8 characters, and the backup export form carries a soft warning against password reuse. Sensitive UI flows (secret reveal, backup export, wallet reset, support bundle, and raw script hex) are now protected by an `AuthGate` requiring re-authentication via password or biometrics.

**Where:** `app/store/useAppStore.ts` (`hashPassword`) and `app/screens/ProfileLock.tsx` (6-char minimum at line 25)

## 4. `markDirtyForBackup()` fires `persist()` without awaiting

**Status: OPEN**

**Where:** `app/store/useAppStore.ts` (`markDirtyForBackup`)

Milestone 15 made the user-driven store actions `await persist(get())` so they cannot return before the AsyncStorage write lands. `markDirtyForBackup()` is the one remaining exception: it flips `security.dirtyForBackup` and then calls `void persist(useAppStore.getState())`, deliberately not awaiting. It runs as a side-effect of the swap-event listener (`setSwapEventListener`) — not a user action — so there is no call site that could await it without changing the listener contract.

The race window is small (the flag will be re-set on the next swap event anyway), but a swap-event burst that lands moments before app termination could lose the dirty mark, leaving the Reset gate's "needs backup" warning silent until the next mutation.

A real fix would either (a) make the listener async and have the SwapManager await it, or (b) introduce a top-level persist queue that the app-lifecycle handler flushes before allowing suspension (same mechanism that would close [#2](#2-preference-toggle-persistence-is-not-actually-awaited-at-the-call-site)).

## 5. In-app notifications appear at the bottom instead of the top

**Status: OPEN**

**Where:** `app/components/ToastProvider.tsx`

Most OS and app-level notifications appear at the top of the screen. The current toast implementation anchors to the bottom, which is atypical and may confuse users who expect status feedback near the top.

## 6. Send / Receive actions are not thumb-reachable on Wallet home

**Status: OPEN**

**Where:** `app/screens/WalletScreen.tsx`

Send and Receive are the primary actions on the Wallet home screen, but their current placement is not optimised for one-handed use. Moving them toward the bottom of the screen would put them within natural thumb reach, matching the ergonomic conventions of other mobile wallet apps.

## 7. VTXO list title and explorer link assume a single address, but the wallet owns several

**Status: RESOLVED** (done in `4ea531a9c112e78175809920c145be14505795f7`)

**Where:** `app/screens/vtxos/VtxoListScreen.tsx`

The screen header reads "VTXOs at this address" and the error-state "Open address in explorer" link uses `wallet.arkAddress`. Both are wrong:

- The list is sourced from `wallet.getVtxos()`, which internally calls `contractManager.getContractsWithVtxos()` and `flatMap`s every contract the wallet owns. The SDK auto-registers a `default` contract and, whenever `delegatedRenewal` is on (the app's default — see `app/store/useAppStore.ts:218`), a `delegate` contract with a different address. So the list aggregates VTXOs across **multiple** addresses; the singular "this address" copy is misleading from a fresh install onward. (VHTLCs used by `@arkade-os/boltz-swap` are not registered with `ContractManager` today, so they do not contribute additional addresses yet — but a planned SDK-space refactor will eventually add them, and the fix should not assume exactly two.)
- `arkAddress` is the **default** contract's address only (`app/store/types.ts:108`, `app/services/arkade/runtime.ts:271`). The explorer link goes to that single address, but a delegate VTXO shown one line above the link will not appear at that URL. Silent inconsistency.

This is the narrow bug carved out of the paused [MILESTONE_21](./docs/MILESTONE_21.agents.md). It can be fixed without restructuring the list.

### Resolution direction

Two options, in order of effort:

1. **Minimal:** retitle the screen and drop the single-address explorer link. One file changed; ships the truth.
2. **Expanded (preferred):** retitle, drop the broken link, and add a small read-only Addresses sub-screen. This is the smallest useful slice of a future Contracts Management surface (see [MILESTONE_21](./docs/MILESTONE_21.agents.md) for the broader design context that was paused) — view-only, no labeling/closing/filtering.

The expanded option, refined:

- **Title:** "Your VTXOs" (address-agnostic).
- **Subtitle:** "X VTXOs at Y addresses", where Y counts every owned contract — including an empty `delegate` — so the user can see what the wallet owns even when no funds are present. Y is honest about the wallet's address surface; X is the same count the list shows today.
- **CTA below the subtitle:** "Show all my addresses" → opens a new Addresses screen.
- **Addresses screen contents:** one row per owned contract. Per-row data limited to public fields — `type`, `state`, `address`, `label`, `createdAt` (mirroring the information-disclosure rule from the paused MILESTONE_21). No `params`, no witness data, no preimages.
- **Per-row actions:** tap-to-copy address with toast confirmation (primary, matches the existing `CopyableField` pattern); secondary affordance opens the per-address page in the OS browser using the network-aware explorer base (`mutinynet` → `explorer.mutinynet.arkade.sh`, `bitcoin` → `arkade.space`) that `VtxoListScreen.openExplorer` already uses today.
- **Out of scope here:** labeling, closing, filtering, per-contract balances. Those belong to a future Contracts Management feature.

### Notes

- The minimal option is a viable ship-it-tomorrow fix if the expanded option slips. The issue documents both so we don't pretend the new screen is "the bugfix".
- Treat the Addresses screen as a deliberate first read-only step toward the Contracts Management feature the paused [MILESTONE_21](./docs/MILESTONE_21.agents.md) gestured at — not as scope creep.
