# Issues

Findings from a spec-compliance check of the Zustand store (`app/store/`) against `TASK.md`. Data model and action surface match the spec; items below are bugs and drift worth fixing.

## 1. `simpleHash` is not a cryptographic hash

**Where:** `app/store/useAppStore.ts:10-18`

A 32-bit non-cryptographic string hash (Java `String.hashCode` family) is used to "hash" the unlock password. Trivial collisions, no salt, reversible. Spec (§4) only requires a `passwordHash?: string` field and doesn't prescribe an algorithm, but for anything beyond a placeholder this needs SHA-256 (via `expo-crypto`) plus a stored random salt.

Note: the broader "wallet in plaintext AsyncStorage" model is spec-sanctioned (§1), so this is the password gate only.

## 2. Persistence races — six actions don't `await persist`

**Where:** `app/store/useAppStore.ts:89, 98, 129, 136, 143, 150`

`lockWallet`, `unlockWithPassword`, `setTheme`, `setFiatCurrency`, `setPassword`, `toggleBiometrics` all call `set(...)` then `persist(get())` without `await`. A fast lock-then-quit (or theme-change-then-quit) can lose the write. Only `createWallet`, `unlockWithBiometrics`, and `resetWallet` await correctly.

**Fix:** make the six actions `async` and `await persist(get())`.

## 3. `hydrate()` doesn't validate `schemaVersion`

**Where:** `app/store/useAppStore.ts:61-73`

Parsed JSON is cast straight to `AppState` with no version check. Fine for v1, but the moment `schemaVersion` is bumped, old persisted state will be loaded as if it were the new shape. Needs a guard / migration path before any schema change ships.

## 4. Locked state keeps wallet in memory

**Where:** `app/store/useAppStore.ts:85-90` (`lockWallet`)

`lockWallet` only flips `security.isLocked`; `walletContainer` stays in the Zustand store. Spec-acceptable (§6-D doesn't require wiping memory), but the `Unlock` screen must gate by `security.isLocked`, **not** by absence of `walletContainer` — otherwise the lock is a no-op for any screen that reads the container directly.

## 5. Dual app entry points — Expo Router vs. manual `App.tsx`

**Where:** untracked `App.tsx` and `index.ts` at repo root, alongside `app/_layout.tsx` (the Expo Router root layout documented in `CLAUDE.md`).

The project now has both an Expo Router auto-entry and a manual `App.tsx` / `index.ts` entry. One wins, the other becomes dead code. Needs a decision before more screens are wired up, and `CLAUDE.md` updated to match.
