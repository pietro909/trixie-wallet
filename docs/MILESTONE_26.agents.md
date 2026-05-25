# Milestone 26: Loading Feedback & Sync Visibility

**Status:** Open.

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
[`app/store/useAppStore.ts:1225`](../app/store/useAppStore.ts)), kicked off
by [`WalletScreen.tsx:179-184`](../app/screens/WalletScreen.tsx) on mount.
That refresh chains:

1. `refreshWalletSnapshot` — VTXOs, balances, server snapshot.
2. `maybeEnsureLightning` — opens Lightning subsystems if needed.
3. `buildActivities` (in `app/services/arkade/activity-history.ts`, ~1174 LOC)
   — timestamp resolution, commitment decomposition, asset classification.
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
- **Backup / support-bundle export:** uses generic `LoadingOverlay` with a
  spinner and static label. Operations take seconds; the overlay does not
  reflect progress.
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
independently. Phase 1 is the driver and should land first.

### Phase 1 — Sync-state primitive + Wallet/Activity surfaces

Add a single source of truth for "is the wallet syncing" on the store, then
surface it on Wallet and Activity.

#### Suggested store API

In [`app/store/types.ts`](../app/store/types.ts):

```ts
export type SyncStage =
  | "snapshot"   // refreshWalletSnapshot — VTXOs, balances, server info
  | "lightning"  // maybeEnsureLightning — opening Lightning subsystems
  | "activities" // buildActivities — timestamps + decomposition
  | "notify";    // diffAndNotifyActivities — emitting notifications

export type SyncState =
  | { kind: "idle" }
  | { kind: "syncing"; stage: SyncStage; startedAt: number };
```

In [`app/store/useAppStore.ts`](../app/store/useAppStore.ts):

- Add `_syncState: SyncState` to `AppState`, default `{ kind: "idle" }`.
- Do **not** persist `_syncState` — it is lifecycle metadata, same treatment
  as `_hydrated` and `_schemaMismatch`. Strip it from the persisted payload
  in `persist()`.
- Wrap each `await` in `refreshWallet`'s inner sequence with
  `set({ _syncState: { kind: "syncing", stage, startedAt } })` before, and
  reset to `{ kind: "idle" }` in the outer `.finally()` (next to the existing
  `refreshInFlight = null`).
- The re-entrant pattern (`refreshPending` loop) keeps the state as
  `syncing` across consecutive runs, only flipping to `idle` once the
  outer promise settles. That is correct: the user sees "syncing" until
  every queued refresh has drained.

#### Wallet surface

In [`app/screens/WalletScreen.tsx`](../app/screens/WalletScreen.tsx):

- Subscribe to `_syncState` via `useAppStore`.
- Render a small "Syncing…" pill near the balance card title when
  `_syncState.kind === "syncing"`. Pill should fade in/out (250ms) and use
  `theme.colors.surfaceSubtle` background + `theme.colors.textMuted` label.
- Optionally swap the pill label per stage: "Syncing balance", "Syncing
  activity", "Notifying" — but only if all four labels test well; otherwise
  collapse to a single "Syncing…".

#### Activity surface

In [`app/screens/ActivityScreen.tsx`](../app/screens/ActivityScreen.tsx):

- When `_syncState.stage === "activities"` and the list is empty, render
  3–5 skeleton rows (use the existing `Skeleton` component from
  `app/components/Skeleton.tsx`).
- When the list is non-empty, render the same "Syncing…" pill as Wallet,
  pinned to the header.

### Phase 2 — Send & Receive motion polish

Discretionary; lands after Phase 1.

- Subtle entrance animation on the SendReview screen when fee preview arrives
  (slide-up + opacity, 200ms).
- Receive QR screen: a soft pulse on the QR border while the underlying
  invoice is being generated (Boltz hold invoice creation can take 1-3s).
- SendResult screen success animation: scale the success icon in with a
  slight bounce (already partially done — verify and tune).
- Constraint: no animation may delay tap response. All animations must be
  decorative, running on the UI thread via Reanimated.

### Phase 3 — Expressive loaders for long-running ops

Replace flat overlays with motion-forward loaders.

- **Backup export** (`app/screens/ProfileBackup.tsx`): swap the generic
  spinner for an animated icon (e.g., a slowly rotating Lock or
  ShieldCheck from `lucide-react-native`) plus rotating label copy
  ("Encrypting…", "Packing…", "Ready").
- **Support-bundle export** (`app/services/diagnostics/…`): same pattern
  with a FileText icon.
- The label rotation should be driven by real lifecycle hooks where they
  exist, not a fake timer. If the export does not expose hooks, fall back
  to a single honest label.

## Implementation Plan (Phase 1 only)

Phases 2 and 3 will get their own implementation plans when prioritized.

### 1. Store

- Update [`app/store/types.ts`](../app/store/types.ts) to add `SyncStage`
  and `SyncState`.
- Update [`app/store/useAppStore.ts`](../app/store/useAppStore.ts):
  - Add `_syncState: SyncState` to `AppState`.
  - Initialize with `{ kind: "idle" }` in the default state.
  - In `refreshWallet`, wrap each stage with the appropriate
    `set({ _syncState: { kind: "syncing", stage, startedAt: Date.now() } })`
    before the `await`.
  - Reset to `{ kind: "idle" }` in the `.finally()` block at line 1291.
  - Exclude `_syncState` from `persist()` (already excludes `_hydrated`,
    `_schemaMismatch` — follow the same pattern).

### 2. Wallet surface

- Add a `SyncPill` component (local to `WalletScreen.tsx` for now; promote
  to `app/components/` only if a third surface adopts it).
- Subscribe to `useAppStore((s) => s._syncState)`.
- Render above or beside the balance card title; fade in/out via
  Reanimated `withTiming(opacity, { duration: 250 })`.

### 3. Activity surface

- Reuse the `SyncPill`.
- Render 3–5 `Skeleton` rows when the list is empty and
  `_syncState.stage === "activities"`.

### 4. Verification

- `pnpm check` and `pnpm test` clean.
- Cold-start manual test on iOS and Android dev builds:
  - Splash fades, Wallet renders with cached data.
  - Sync pill appears within ~100ms of Wallet mount.
  - Pill stays for the duration of the refresh (~3s on the test wallet)
    and disappears when refresh settles.
  - Pulling to refresh from the Wallet header still works — the pill should
    *not* fight the `RefreshControl`. Decide: hide the pill while
    `RefreshControl.refreshing` is true, or let both coexist. Pick one and
    document it.
- Activity-screen cold open on a wallet with empty cached activities:
  - Skeleton rows render immediately.
  - Replaced by real rows when `_syncState.stage` advances past
    `"activities"`.

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
