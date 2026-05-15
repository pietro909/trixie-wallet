# RESOLVED

# Issue 10 — Background tasks visibility & configuration

**The ask:** show users which background tasks the app is running, with run metrics, and let them turn each one off. Slot the UI under "Wallet Behaviour".

## What's actually running today

The app registers exactly one OS-scheduled task: `trixie-boltz-swap-poll` in `app/services/arkade/swap-background.ts`, fired by `expo-background-task` on a 15-minute cadence. It's activated by `ensureSwapBackgroundRegistered()` from `lightning.ts:209` and torn down by `clearSwapBackgroundState()` on reset.

Results already get captured: `RecordingSwapTaskQueue.pushResult` (`swap-background.ts:56`) appends each `TaskResult` to a `recent-results` AsyncStorage list (cap 50), and `drainSwapPollResults` sums it into `LightningResumeSummary` on foreground resume — **destructively**. So the data we want for the UI exists; we just can't reuse the same drain because it clears.

The Push Notifications milestone (recent commit `6061380`) will likely add a second OS-scheduled task. The scaffolding below must be generic from day one — swap-poll is the only current consumer but not the only future one.

## High-level plan

### 1. Persisted metrics store (separate from the destructive drain)

- New module `app/services/diagnostics/bg-task-metrics.ts` backed by AsyncStorage key `trixie:bg-task:metrics:<taskName>`.
- Per task, persist: `lastSuccessAt`, `lastSuccessDurationMs` (optional — see below), `lastSuccessSummary` (free-form `Record<string, number>` so each task can store its own counters — polled/updated/claimed/refunded for swap-poll, something else for notifications), `lastFailureAt`, `lastFailureMessage`, `totalRuns`, `totalSuccesses`, `totalFailures`.
- Generic API: `recordBgTaskRun(taskName, { status, durationMs?, summary?, errorMessage? })`, `readBgTaskMetrics(taskName)`, `clearBgTaskMetrics(taskName)`. The swap-poll integration is one caller; the push-notification task will be another.
- Write site for swap-poll: extend `RecordingSwapTaskQueue.pushResult` to call `recordBgTaskRun` using the `TaskResult` fields. Mapping: `status` is `result.status`, `lastSuccessAt`/`lastFailureAt` come from `result.executedAt`, `errorMessage` from `result.data?.error` (string captured by the processor on exception — there is no top-level `error` field), and `summary` from the numeric `result.data` counters (`polled`, `updated`, `claimed`, `refunded`, `errors`). Keep failure messages redacted via `redactString`.
- **Duration caveat:** `TaskResult` only carries `executedAt`, not a start time, and `defineExpoSwapBackgroundTask` from `@arkade-os/boltz-swap/expo/background` directly wires `TaskManager.defineTask` with no before/after hook. So `pushResult` cannot compute a real run duration. For v1, leave `durationMs` undefined and omit it from the UI when missing. Capturing true OS-run duration would require replacing the package wrapper with an app-owned `TaskManager.defineTask` shell — out of scope here, revisit if needed.

### 2. Config — separate `backgroundTasks` AppState slice (not inside `WalletBehavior`)

Resolution of the open question: **separate slice.** Reasons:

- `setWalletBehavior` (`useAppStore.ts:1255`) marks backup dirty, disposes Lightning, disposes the wallet, and persists. None of that is appropriate for a pure scheduler toggle.
- That same function shallow-merges (`{ ...current, ...behavior }`), so a nested `backgroundTasks` map would let any update accidentally clobber sibling flags. Avoidable only with deep-merge plumbing that no current caller needs.
- `parseWalletBehavior` in `app/services/backup/serializer.ts:172` only carries the two known fields across import/export. Putting the flag in `WalletBehavior` would silently drop it on restore unless the serializer is also extended, and we'd have to decide whether device-local scheduler preferences belong in wallet backups (they don't).

Shape:

- Add `backgroundTasks: { swapPoll: boolean }` as a top-level `AppState` slice with default `{ swapPoll: true }` in `DEFAULT_STATE`. Add a named type, e.g. `BackgroundTasks`, beside `WalletBehavior` in `app/store/types.ts`. Designed as a map so the push-notification flag drops in as `backgroundTasks.pushNotifications` later.
- **Storage migration is a no-op, but hydration still needs normalization.** `schemaVersion` does **not** need to bump: schema mismatch in `useAppStore.ts:623` currently wipes persisted state outright, which we want to avoid. `STORAGE_KEY` stays `app_state_v4`.
  - Add `const DEFAULT_BACKGROUND_TASKS: BackgroundTasks = { swapPoll: true }`.
  - Add `normalizeBackgroundTasks(raw): BackgroundTasks` that deep-merges/coerces per key, e.g. `swapPoll: raw?.swapPoll === false ? false : true`.
  - In `hydrate`, keep the existing `{ ...DEFAULT_STATE, ...parsed }` structure, but override with `backgroundTasks: normalizeBackgroundTasks(parsed.backgroundTasks)` just like `walletBehavior: normalizeWalletBehavior(parsed.walletBehavior)`.
  - This is required even without a schema bump: existing v4 payloads with no `backgroundTasks` get defaults, and future payloads like `{ swapPoll: false }` won't suppress newly-added defaults such as `pushNotifications: true`.
- **`persist()` whitelist must be extended.** `persist` in `useAppStore.ts:289` enumerates fields explicitly and would drop `backgroundTasks` otherwise. Add it to the persisted object alongside `walletBehavior` etc.
- New dedicated action `setBackgroundTaskEnabled(taskKey, enabled)` where `taskKey` is the slice key (`"swapPoll"`), **not** the OS task name (`trixie-boltz-swap-poll`). Keep a small in-module descriptor mapping `taskKey → { osTaskName, register, unregister }` so the action stays generic for the push-notification addition:
  - Updates only that key in the slice.
  - On flip-on: invokes the descriptor's `register` (e.g. `ensureSwapBackgroundRegistered()`).
  - On flip-off: invokes the descriptor's `unregister`.
  - Keep package-specific unregister details inside `app/services/arkade/swap-background.ts`: export an app-owned helper such as `unregisterSwapBackgroundTask()` that wraps `unregisterExpoSwapBackgroundTask(SWAP_BACKGROUND_TASK_NAME)`. The store descriptor should import that helper, not the package unregister function plus raw OS task name.
  - `await persist(get())`. **No** `markDirtyForBackup`, **no** `disposeLightning`, **no** `disposeWallet`.
- Backup serializer is left alone — the slice stays out of backups.
- **Gate without creating a service/store cycle.** `useAppStore.ts` already imports `lightning.ts` (and `swap-background.ts`), so importing `useAppStore` inside `lightning.ts` would close the cycle. Instead, pass the gate through Lightning service inputs alongside `metadata` and `behavior`:
  - Extend `EnsureLightningInput` (current signature in `lightning.ts:277`) with `swapBackgroundEnabled: boolean`.
  - Extend `resumeLightningSwaps` args too, because it calls `ensureLightning` internally.
  - Store-side callers pass `get().backgroundTasks.swapPoll` whenever they call `ensureLightning` or `resumeLightningSwaps`.
  - `buildInstance`/`ensureLightning` then conditionally call `ensureSwapBackgroundRegistered()` only when the flag is enabled. `seedSwapPollTask()` can remain harmless, but if we want "off" to be stricter, also skip seeding while disabled.
- Extend `clearSwapBackgroundState` and `resetWallet` to also wipe the metrics key (the slice itself resets via the normal `DEFAULT_STATE` reset).

### 3. UI: "Background tasks" section in `AdvancedScreen.tsx`

- Place it directly under "Wallet Behaviour" (the spot issue 10 calls out).
- Driven by a generic `BackgroundTaskRow` component that takes `{ taskName, displayName, description, enabled, onToggle }`; it reads metrics via a `useBackgroundTaskMetrics(taskName)` hook (polls AsyncStorage on `useFocusEffect`, since these update at OS cadence — not worth a live subscription).
- For v1 only swap-poll renders; push-notification adds a second `<BackgroundTaskRow>` when that milestone lands.
- Each row shows: name + short description, on/off toggle (reusing `BehaviorToggleRow`), last success (relative time + brief summary like "polled 4, claimed 1"), last failure (relative time + message), success/total counter, and last duration *when available* (hidden for swap-poll until we own the wrapper).

### 4. UX guardrail on the off-switch

- Disabling swap-poll means Lightning swaps stop progressing while the app is backgrounded — show that explicitly in a confirm dialog (same `Alert.alert` pattern as `confirmWalletBehavior`, but firing `setBackgroundTaskEnabled` instead), and tag the row "Recommended on" when off.

## Decided scope

- **No manual "Run now" button.** `BackgroundTask.triggerTaskWorkerForTestingAsync` only works on dev/emulator; not worth shipping.
- **No per-run history list.** Counts plus last-success/last-failure is enough. The existing `recent-results` shadow log stays capped at 50 and remains foreground-resume-only.
- **No true run-duration tracking in v1.** `durationMs` is optional in the metrics shape; the UI hides the field when missing. Revisit only if we replace the boltz-swap BG wrapper with an app-owned one.
- **Scaffolding is generic from day one** so the Push Notifications milestone adds a row, not a refactor.
- **Flag lives in its own `AppState.backgroundTasks` slice**, not in `WalletBehavior`. Keeps the scheduler toggle free of the wallet-restart / backup-dirty side effects and avoids the shallow-merge and serializer issues.
