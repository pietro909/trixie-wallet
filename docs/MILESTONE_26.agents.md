# Milestone 26: Loading Feedback & Sync Visibility

**Status:** All phases complete. Phase 1 delivered (sync-state primitive +
Wallet/Activity surfaces); Phase 2 delivered (Send & Receive motion polish);
Phase 3 delivered (expressive loaders for backup export & support-bundle
generation).

## Goal

Make the app *feel* as responsive as it is by surfacing the work it's already
doing. Heavy operations — most visibly the cold-start wallet refresh, but also
backup export, support-bundle generation, and the activity-history rebuild —
must communicate that they are running, what stage they are at, and roughly
how long they are likely to take.

This milestone replaces the previous "Issue 2: Animation and Loading Feedback
Pass" entry in [ISSUES.md](../ISSUES.md) and gives the work a concrete shape.

## Driver Symptom

On a cold start, the splash fades cleanly and the Wallet screen renders fast,
but the app is unresponsive for roughly 3 seconds afterwards. Nothing on
screen indicates that work is happening. The hidden work is
`useAppStore.refreshWallet` (defined at
[`app/store/useAppStore.ts`](../app/store/useAppStore.ts)), kicked off
by [`WalletScreen.tsx`](../app/screens/WalletScreen.tsx) on mount.
That refresh chains:

1. `refreshWalletSnapshot` — VTXOs, balances, and the expensive
   `getActivityHistory` pass (timestamp resolution, decomposition).
2. `maybeEnsureLightning` — opens Lightning subsystems if needed.
3. `buildActivities` (local helper in `useAppStore.ts`) — merges
   Lightning and swap activity sources.
4. `diffAndNotifyActivities` — emits user-visible notifications for new rows.

Each stage is awaited sequentially, but no in-flight signal is exposed to the
UI — `refreshInFlight` is a module-local Promise ref, not a store-readable
piece of state.

## Current State

- **Refresh in-flight signal:** none. UI cannot observe whether
  `refreshWallet` is running, nor which stage.
- **Wallet screen:** balance card and recent activity render with whatever
  cached snapshot the store hydrated, no indication that fresher data is on
  the way.
- **Activity screen:** the list renders the cached activities directly; no
  skeleton, no "syncing" affordance.
- **Send / Receive:** flows work, but transitions are flat. No motion that
  conveys "the app heard you and is working on it" beyond the standard
  `Button` press animation.
- **Backup / support-bundle export:** Backup uses `LoadingOverlay` with
  dynamic labels driven by `exportPhase`, but the layout remains generic.
  Support-bundle generation uses button-level busy states with no stage
  feedback. Both operations take seconds without reflecting progress.
- **Pull-to-refresh** on Wallet and Activity already shows the native
  `RefreshControl` indicator, so that path is fine. The gap is everywhere a
  refresh is *automatic*.

## Product Rules

- **Honest progress only.** Show stages the app can actually distinguish; do
  not invent fake granularity. If a stage is opaque, show a generic
  "Syncing…" affordance, not a fake substage.
- **Non-blocking.** Indicators must not block interaction with already-rendered
  cached data. The Wallet should remain scrollable while syncing.
- **Calm, not chatty.** A subtle pill or animated dot beats a banner. The
  indicator should be visible but not demand attention.
- **No extra cold-start time.** This milestone does not extend the splash to
  cover the refresh. Splash boundary stays at `hydrated && fontsLoaded`.
- **Theme parity.** Indicators must read well in light and dark mode.
- **Accessible.** Sync state should be exposed via `accessibilityLiveRegion`
  / `accessibilityLabel` so VoiceOver / TalkBack users hear it without
  needing to focus a hidden element.

## Selected Direction

Three phases, ordered by urgency. Each phase is self-contained and can ship
independently. Phase 1 is **Complete** (landed in commit `6830f53`).

### Phase 1 — Sync-state primitive + Wallet/Activity surfaces ✅ Delivered

Add a single source of truth for "is the wallet syncing" on the store, then
surface it on Wallet and Activity.

#### Suggested store API

In [`app/store/types.ts`](../app/store/types.ts):

```ts
export type SyncStage =
  | "snapshot"   // refreshWalletSnapshot — VTXOs, balances, and history
  | "lightning"  // maybeEnsureLightning — opening Lightning subsystems
  | "activities" // buildActivities — local merge of activity sources
  | "notify";    // diffAndNotifyActivities — emitting notifications

export type SyncState =
  | { kind: "idle" }
  | { kind: "syncing"; stage: SyncStage; startedAt: number };
```

In [`app/store/useAppStore.ts`](../app/store/useAppStore.ts):

- Add `_syncState: SyncState` to `StoreState` (beside `_hydrated`), default `{ kind: "idle" }`.
- Do **not** persist `_syncState` — it is lifecycle metadata, same treatment
  as `_hydrated` and `_schemaMismatch`. Strip it from the persisted payload
  in `persist()`.
- Wrap each `await` in `refreshWallet`'s inner sequence with
  `set({ _syncState: { kind: "syncing", stage, startedAt } })` before, and
  reset to `{ kind: "idle" }` in the outer `.finally()`.
- The re-entrant pattern (`refreshPending` loop) keeps the state as
  `syncing` across consecutive runs, only flipping to `idle` once the
  outer promise settles. That is correct: the user sees "syncing" until
  every queued refresh has drained.

#### Wallet surface

In [`app/screens/WalletScreen.tsx`](../app/screens/WalletScreen.tsx):

- Subscribe to `_syncState` via `useAppStore`.
- Render a `SyncPill` near the balance card title (absolute positioned or
  flex-row with the title) when `_syncState.kind === "syncing"`.
- Pill should fade in/out (`theme.motion.duration.slow`) and use `theme.colors.surfaceSubtle`
  background + `theme.colors.textMuted` label.
- Label can be static "Syncing…" or dynamic based on `stage`. Dynamic
  is preferred for accessibility.

#### Activity surface

In [`app/screens/ActivityScreen.tsx`](../app/screens/ActivityScreen.tsx):

- When `_syncState.kind === "syncing"` and the list is empty, render
  3–5 skeleton rows (use the existing `Skeleton` component from
  `app/components/Skeleton.tsx`).
- When the list is non-empty, render the same `SyncPill` as Wallet,
  pinned to the header or as a header component in the `FlatList`.

### Phase 2 — Send & Receive motion polish ✅ Delivered

Discretionary; lands after Phase 1.

- **SendReview entrance choreography** ([`app/screens/send/SendReviewScreen.tsx`](../app/screens/send/SendReviewScreen.tsx)):
  Instead of values "popping" into existence, let the resolved totals and
  conditional fee quotes perform a graceful entrance. Always-present fee
  rows should continue showing their "Estimating..." labels to preserve
  honest progress, while their final numeric states arrive with a subtle
  motion signature.
- **Receive QR pulse & placeholder** ([`app/screens/receive/ReceiveQRScreen.tsx`](../app/screens/receive/ReceiveQRScreen.tsx)):
  Banish the full-screen spinner. Replace it with a `QRPlaceholder` — a
  clean, rounded square that pulses its border opacity (0.4 to 1.0) while
  waiting for the LNURL session string to resolve. Align the pulse rhythm exactly with the
  `SyncPill` (1200ms round-trip, quad-in-out easing).
- **SendResult Reanimated refactor** ([`app/screens/send/SendResultScreen.tsx`](../app/screens/send/SendResultScreen.tsx)):
  Upgrade from legacy `Animated` to `Reanimated`. Replace the flat spring
  with a bouncy `withSpring` overshoot. Synchronize the corresponding `Success` or `Error` haptic to
  fire exactly at the apex of the bounce.
- **Constraint:** Animations must be "air-like" — decorative and non-blocking.
  Touch targets must remain static and responsive.

### Phase 3 — Expressive loaders for long-running ops ✅ Delivered

Replace flat overlays with motion-forward loaders.

- **Backup export progress** ([`app/screens/ProfileBackup.tsx`](../app/screens/ProfileBackup.tsx)):
  The screen already handles `exportPhase` labels; transition the UI to a
  localized animation in the backup card while phasing out `LoadingOverlay`. The loader should cycle through labels based on `exportPhase`:
  "Encrypting…", "Saving to device…", "Opening share sheet…". Use an animated
  `ShieldCheck` from `lucide-react-native`.
- **Support-bundle progress** ([`app/services/diagnostics/bundle.ts`](../app/services/diagnostics/bundle.ts)):
  Refactor `buildSupportBundle` to accept a progress callback. Update the
  UI to show granular stages: "Collecting logs…", "Exporting database…",
  "Compressing…".
- The label rotation should be driven by real lifecycle hooks where they
  exist, not a fake timer. If the operation does not expose hooks, fall back
  to a single honest label.

#### What shipped (Phase 3)

- **Backup export:** Replaced the full-screen `LoadingOverlay` with a localized
  `BackupProgress` block inside the backup card — a `ShieldCheck` that pulses
  opacity + scale on the shared 1200ms quad-in-out rhythm (matching `SyncPill` /
  `QRPlaceholder`), with `exportPhase`-driven labels ("Encrypting…", "Saving to
  device…", "Opening share sheet…") and a polite live-region announcement. The
  password form now renders only in the `form` phase and the Save/Share buttons
  only in `dispatch`, so the loader is the single source of busy feedback per
  phase.
- **Support bundle:** `buildSupportBundle(onProgress?)` now reports four coarse
  stages (`server` → `swaps` → `wallet` → `assembling`) at the real async-work
  boundaries. `ProfileRecovery` shows the live stage label in place of
  "Preparing bundle…"; `AdvancedScreen`'s `RawRow` shows it via a new
  `busyLabel` prop (swapped into the row subtitle while busy).
- **Honesty deviation from the suggested labels:** the spec's
  "Exporting database…" / "Compressing…" describe work `buildSupportBundle` does
  not perform (it assembles an in-memory JSON snapshot — no DB export, no
  compression). Per the "Honest progress only" Product Rule and the
  real-lifecycle-hooks note above, the stages use truthful labels for the work
  that actually runs (server probe, swap/recovery scan, wallet/VTXO read,
  assembly) instead.

#### Verification (Phase 3)

- `pnpm check`, `pnpm test` (351 passing), and `tsc --noEmit` all clean.
- **Manual Verification (iOS + Android):** _pending on-device pass_ — confirm the
  backup `ShieldCheck` pulses through all three phase labels and the support-bundle
  stage labels advance (most visible on a wallet with Lightning/recovery state).

## Implementation Plan (Phase 2)

### 1. SendResult Refactor
- Convert `SendResultScreen.tsx` to use `react-native-reanimated`.
- Define a `scale` shared value (init 0.7).
- Use `withSpring(1, { damping: 8, stiffness: 100 })` for the "overshoot" pop.
- Trigger the appropriate `Success` or `Error` haptic in a `useEffect` using a timed approximation of the spring apex (~150ms for the requested spring params; re-tune if damping/stiffness change).

### 2. SendReview Entrance
- Create an `AnimatedRow` wrapper in `SendReviewScreen.tsx`.
- Use `useAnimatedStyle` to map a `visible` prop to `opacity` (0 -> 1) and
  `translateY` (10 -> 0) using `theme.motion.duration.slow`.
- Wrap the conditionally-mounted Total rows (the Lightning Total and the
  chainswap Total).
- Trigger the entrance animation when they mount upon loading completion.
- For the always-present Network Fee row, apply a subtle numeric fade-in
  transition only for the value text when it flips from "Estimating..." to a
  final number, preserving the loading label visibility.

### 3. Receive QR Pulse
- Create a `QRPlaceholder` component (232x232 rounded square, matching the `QRCode` dimensions and aligned to its inner position within the padded card).
- Implement a `borderOpacity` shared value with a repeat-sequence loop:
  - `withTiming(1, { duration: 600, easing: Easing.inOut(Easing.quad) })`
  - `withTiming(0.4, { duration: 600, easing: Easing.inOut(Easing.quad) })`
- Replace the `ActivityIndicator` in the `lnurlPending` branch with the `QRPlaceholder`.

### 4. Verification
- `pnpm check` and `pnpm test` clean. ✅ (also `tsc --noEmit` clean)
- **Manual Verification (iOS + Android):** _pending on-device pass_
  - **SendReview:** Confirm that Totals slide up smoothly and the Fee row resolves without flickering or hiding the "Estimating..." labels.
  - **ReceiveQR:** Confirm the `QRPlaceholder` pulses during LNURL session setup and disappears exactly when the QR code renders.
  - **SendResult:** Confirm the icon pop feels "springy" (not linear) and the haptic fires at the peak of the expansion, not at the start.


## Implementation Plan (Phase 1 complete)

Phases 2 and 3 will get their own implementation plans when prioritized.

### 1. Store

- Update [`app/store/types.ts`](../app/store/types.ts) to add `SyncStage`
  and `SyncState`.
- Update [`app/store/useAppStore.ts`](../app/store/useAppStore.ts):
  - Add `_syncState: SyncState` to `StoreState` (beside `_hydrated`).
  - Initialize with `{ kind: "idle" }` in the default state.
  - In `refreshWalletOnce`, wrap `refreshWalletSnapshot` with stage `"snapshot"`.
  - Wrap `maybeEnsureLightning` with stage `"lightning"`.
  - Wrap `buildActivities` with stage `"activities"`.
  - In the outer `refreshInFlight` block, wrap `diffAndNotifyActivities` with
    stage `"notify"`.
  - Reset to `{ kind: "idle" }` in the `.finally()` block.
  - Exclude `_syncState` from `persist()` (follow the `_hydrated` pattern).
- **Unit Testing:** Add a test case to `app/store/__tests__/useAppStore.test.ts`.
  Mock imported dependencies (`refreshWalletSnapshot`, `ensureLightning`,
  `isLightningSupportedForNetwork`, `getLightningActivitySources`,
  `mergeActivities`, and `diffAndNotifyActivities`) and verify that `_syncState`
  correctly transitions through all stages and returns to `idle`.

### 2. Wallet surface

- Add a `SyncPill` component.
- Subscribe to `useAppStore((s) => s._syncState)`.
- Render in the balance card near the wallet label; fade in/out via
  Reanimated `withTiming(opacity, { duration: 250 })`.
- **Accessibility:** Ensure the pill uses `accessibilityLiveRegion="polite"` and
  provides a clear `accessibilityLabel` mapping the `stage` to user-facing text.

### 3. Activity surface

- Reuse the `SyncPill` as a floating indicator or header item.
- Render 3–5 `Skeleton` rows when the list is empty, `_syncState.kind === "syncing"`,
  and `!refreshing` (to avoid overlap with native Pull-to-Refresh).
- **Skeleton Layout:** Each skeleton row should approximate the height and
  internal layout of `ActivityRow.tsx` (avatar placeholder + two-line text
  placeholders) to provide a smooth transition when real data arrives.

### 4. Verification

- `pnpm check` and `pnpm test` clean.
- Cold-start manual test on iOS and Android dev builds:
  - Splash fades, Wallet renders with cached data.
  - Sync pill appears within ~100ms of Wallet mount.
  - Pill stays for the duration of the refresh (~3s on the test wallet)
    and disappears when refresh settles.
  - Pulling to refresh from the Wallet header still works — hide the pill
    while `RefreshControl.refreshing` is true to avoid double indicators.
- Activity-screen cold open on a wallet with empty cached activities:
  - Skeleton rows render immediately.
  - Replaced by real rows when `_syncState.kind` flips to `"idle"`.

## Out of Scope

- Cancelling an in-flight refresh.
- Showing a percentage / progress bar — stages are coarse, percentages
  would be dishonest.
- Replacing `LoadingOverlay` for short-lived modals (lock/unlock, password
  setup) — those are in Issue 1's territory if at all.
- Refactoring `refreshWallet`'s control flow (`refreshInFlight` /
  `refreshPending` re-entrancy). The wrap is purely additive.
- Adding sync state for non-refresh paths (Lightning resume, swap polling).
  Those already have their own surfaces or are fast enough.
