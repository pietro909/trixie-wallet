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
