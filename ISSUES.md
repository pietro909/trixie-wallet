# Issues

Items 1–5 came from a spec-compliance pass over the Zustand store and entry-point setup. Items 6–8 surfaced during the SDK 55 / pnpm / Biome / native-stack migrations. Nothing here is fixed yet.
Items from 9 onwards were raised during manual testing.

## 1. `simpleHash` is not a cryptographic hash

**Status: OPEN**

**Where:** `app/store/useAppStore.ts:10-18`

A 32-bit non-cryptographic string hash (Java `String.hashCode` family) is used to "hash" the unlock password. Trivial collisions, no salt, reversible. Spec (§4) only requires a `passwordHash?: string` field and doesn't prescribe an algorithm, but for anything beyond a placeholder this needs SHA-256 (via `expo-crypto`) plus a stored random salt.

Note: the broader "wallet in plaintext AsyncStorage" model is spec-sanctioned (§1), so this is the password gate only.

## 2. Persistence races — six actions don't `await persist`

**Status: OPEN**

**Where:** `app/store/useAppStore.ts` — `lockWallet`, `unlockWithPassword`, `setTheme`, `setFiatCurrency`, `setPassword`, `toggleBiometrics`

Each calls `set(...)` then `persist(get())` without `await`. A fast lock-then-quit (or theme-change-then-quit) can lose the write. Only `createWallet`, `unlockWithBiometrics`, and `resetWallet` await correctly.

**Fix:** make the six actions `async` and `await persist(get())`.

## 3. `hydrate()` doesn't validate `schemaVersion`

**Status: OPEN**

**Where:** `app/store/useAppStore.ts` — `hydrate()`

Parsed JSON is cast straight to `AppState` with no version check. Fine for v1, but the moment `schemaVersion` is bumped, old persisted state will be loaded as if it were the new shape. Needs a guard / migration path before any schema change ships.

## 4. Locked state keeps wallet in memory

**Status: OPEN**

**Where:** `app/store/useAppStore.ts` — `lockWallet`

`lockWallet` only flips `security.isLocked`; `walletContainer` stays in the Zustand store. Spec-acceptable (§6-D doesn't require wiping memory), but the `Unlock` screen must gate by `security.isLocked`, **not** by absence of `walletContainer` — otherwise the lock is a no-op for any screen that reads the container directly.

## 5. Dual app entry points — Expo Router vs. manual `App.tsx`

**Status: OPEN**

**Where:** `App.tsx` and `index.ts` at repo root, alongside `app/_layout.tsx`.

Both an Expo Router auto-entry (`app/_layout.tsx`) and a manual `App.tsx` / `index.ts` entry exist. `package.json` `main` points at `./index.ts`, so `App.tsx` wins and `app/_layout.tsx` is dead code. Either commit to Expo Router (drop `App.tsx`/`index.ts`, set `main` to `expo-router/entry`) or commit to the manual entry (delete `app/_layout.tsx`).

## 6. `handleCopy` doesn't actually copy on native

**Status: OPEN**

**Where:** `app/screens/ProfileBackup.tsx` — `handleCopy(_text, label)`

Shows a "copied" toast and triggers haptics, but never writes to the clipboard — the actual copy was previously gated behind `Platform.OS === "web"` and got removed during the web purge. The Biome auto-fix renamed the now-unused param to `_text`, which makes the bug less visible. **Fix:** install `expo-clipboard` and `await Clipboard.setStringAsync(text)`, then drop the underscore.

## 7. Stray debug `console.log` in `RootStack`

**Status: OPEN**

**Where:** `app/navigation/RootStack.tsx`

`console.log("RootStack: walletContainer", walletContainer)` runs on every render of the navigator. Useful during development; should be removed or gated behind `__DEV__` before any release.

## 8. Android edge-to-edge: native-stack ignores `headerStatusBarHeight`

**Status: OPEN**

**Where:** `app/navigation/RootStack.tsx`

With `edgeToEdgeEnabled: true` (Android 15+ requirement), `@react-navigation/native-stack` does not apply the safe-area top inset to its native Toolbar — the toolbar renders flush against the status bar. **Workaround in place:** `RootStack.tsx` defines a custom `StackHeader` used only on Android via `Platform.OS` check. iOS keeps the native header. Worth re-evaluating once `react-native-screens` ships a fix; if it does, the custom path can be deleted.

## 9. Peer-dep noise from `@arkade-os/sdk`

**Status: OPEN**

**Where:** `pnpm install` warnings

`@arkade-os/sdk@0.4.20` declares peerDeps `expo-background-task@~1.0.10` and `expo-task-manager@~14.0.9`. These got renumbered to 55.x in Expo SDK 55, so pnpm warns on every install. Functionally fine; the SDK author needs to widen its peerDeps. Suppress via `pnpm.peerDependencyRules.allowedVersions` if it becomes annoying.

## 10. Background tasks visibility and configuration

Status: CLOSED (commit eff3091e4b550c6b1fc1ded6603cb0ba92435a11)

**Where:** on the UI, possibly in "Wallet behavior"

As a user, I want to see the background tasks configured in the app with some metrics (ie: last successful run, last failed run, last run duration, etc.) and be able to turn off the background tasks.


## 11. Support mainnet (bitcoin)

**Status: OPEN**

**Where:** Restore wallet screen

As a user, I want to see a switch between mutinynet and mainnet when I restore a wallet. This information should be stored also in the backup file so that if I restore from a backup, the network will be automatically selected and the selector disabled.

But I'm creating a new wallet or restoring from a seed, I must be able to select the network I want to use.

The relevant URLs can be retrieved from the sister app `../wallet`


## 11. Background tasks visibility improvement

**Status: OPEN**

**Where:** on the UI (Advanced -> Background Tasks)

If a task has no recorded runs yet, the UI should still show an explicit empty state such as "Never run" for the metrics. Showing only the toggle makes the metrics feature look broken.

## 12. Pending swaps shows as if the amount is already received

**Status: OPEN**

**Where:** Home screen, Activity list, Activity detail

- In Activity Detail, a `lightning_swap` of type `reverse` is shown as Pending, but the payment shows inbound funds in green which obviously do not show up in the balance
- Under the section Technical the Raw Status shows `pending`
- Pending transactions should be highlighted in a different color to make them stand out
- Maybe add a section in the balance breakdown showing the pending amount?


## 13. Balance breakdown should offer a detailed view 

As a user, I want to see a detailed view of my balance.
It should show a raw, paginated, list of the VTXOs at my address.
I should be able to copy the single VTXO's entire JSON.
The Arkade Explorer is a good inspiration for this, although it must be designed to be used in a mobile context with good UX: https://explorer.mutinynet.arkade.sh/address/tark1qra883hysahlkt0ujcwhv0x2n278849c3m7t3a08l7fdc40f4f2nm3jd77mvuv3x8tycgmvcxvmyvu489t5e4xt5av6mh93pgdhyxr9k2rtqq0

Open to suggestions about how/where to show this detail.