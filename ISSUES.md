# Issues

Open items and follow-ups that do not yet belong to a milestone. Items that grew into milestones are tracked in their respective docs instead.

## 1. Dual app entry points — Expo Router vs. manual `App.tsx`

**Status: OPEN**

**Where:** `App.tsx` and `index.ts` at repo root, alongside `app/_layout.tsx`.

Both an Expo Router auto-entry (`app/_layout.tsx`) and a manual `App.tsx` / `index.ts` entry exist. `package.json` `main` points at `./index.ts`, so `App.tsx` wins and `app/_layout.tsx` is dead code. Either commit to Expo Router (drop `App.tsx`/`index.ts`, set `main` to `expo-router/entry`) or commit to the manual entry (delete `app/_layout.tsx`).


## 2. Android edge-to-edge: native-stack ignores `headerStatusBarHeight`

**Status: OPEN**

**Where:** `app/navigation/RootStack.tsx`

With `edgeToEdgeEnabled: true` (Android 15+ requirement), `@react-navigation/native-stack` does not apply the safe-area top inset to its native Toolbar — the toolbar renders flush against the status bar. **Workaround in place:** `RootStack.tsx` defines a custom `StackHeader` used only on Android via `Platform.OS` check. iOS keeps the native header. Worth re-evaluating once `react-native-screens` ships a fix; if it does, the custom path can be deleted.

## 3. Peer-dep noise from `@arkade-os/sdk`

**Status: OPEN**

**Where:** `pnpm install` warnings

`@arkade-os/sdk@0.4.20` declares peerDeps `expo-background-task@~1.0.10` and `expo-task-manager@~14.0.9`. These got renumbered to 55.x in Expo SDK 55, so pnpm warns on every install. Functionally fine; the SDK author needs to widen its peerDeps. Suppress via `pnpm.peerDependencyRules.allowedVersions` if it becomes annoying.

## 4. Assets selector backdrop animation

**Status: OPEN**

**Where:** `app/screens/send/SendAmountScreen.tsx`

If I tap on `Send -> Paste Ark address -> Continue -> Tap on "Bitcoin"` selector the assets picker slides up from the bottom together with the dark backdrop. The backdrop should slide though, just appear

## 5. Assets selector backdrop animation

**Status: OPEN**

**Where:** Background Tasks logs and error reporting

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

## 6. Swap notifications cannot deep-link to a specific Activity row

**Status: OPEN**

**Where:** `app/services/arkade/swap-background.ts` (`RecordingSwapTaskQueue.pushResult`)

The OS-scheduled swap-poll task (`@arkade-os/boltz-swap/expo/background`) emits `TaskResult.data` shaped as `{ polled, updated, claimed, refunded, errors }` — counts only, no claimed/refunded swap IDs. As a result, the local notification fired on claim/refund cannot include an `activityId`; tapping the notification falls back to the Activity list rather than opening the specific Activity Detail screen.

To deep-link properly, the upstream task would need to expose the list of swap IDs whose status transitioned during the run (e.g. `{ claimedIds: string[], refundedIds: string[] }`), or the foreground "drain" path would need to reconcile claimed swap IDs out of the SQLite swap repository before the user sees the notification. Either approach is more invasive than appropriate for Milestone 12; tracking here.