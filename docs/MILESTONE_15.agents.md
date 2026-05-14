# Milestone 15: Security & Reliability

Goal: harden the password gate and persistence layer before any public release.

This milestone should prove:

- The unlock password is hashed with SHA-256 and a per-wallet random salt, not
  the current 32-bit non-cryptographic hash.
- State writes are fully durable: lock, unlock, theme change, fiat change,
  password change, and biometrics toggle all `await persist()`.
- The store cannot silently load persisted state from a mismatched schema
  version without an explicit migration.
- Every screen that gates on the locked state reads `security.isLocked`, not
  the presence of `walletContainer`.

## Current State

- `simpleHash` in `app/store/useAppStore.ts:10-18` is a 32-bit Java-style
  hash with no salt — trivially collidable and not suitable as a password gate.
- Six store actions (`lockWallet`, `unlockWithPassword`, `setTheme`,
  `setFiatCurrency`, `setPassword`, `toggleBiometrics`) call `set(...)` then
  `persist(get())` without `await`. A fast lock-then-quit can lose the write.
- `hydrate()` casts parsed JSON straight to `AppState` with no schema version
  check. Fine for v1; breaks silently the moment `schemaVersion` is bumped.
- `lockWallet` only flips `security.isLocked`; `walletContainer` stays in the
  Zustand store. Screens that read `walletContainer` directly bypass the lock.

## Product Rules

- Never store or compare a password using a reversible or non-cryptographic
  encoding.
- Every state mutation must be fully persisted before the action returns.
- Reject or migrate persisted state whose `schemaVersion` does not match the
  current schema; never silently coerce.
- Locking must make wallet data inaccessible without re-entering credentials,
  regardless of which screen the user is on.

## Selected Direction

Replace `simpleHash` with `expo-crypto` SHA-256 hashing and a stored random
salt. Make the six async-unsafe actions `async` and `await persist(get())`.
Add a `schemaVersion` guard in `hydrate()` with a clear migration stub for
future bumps. Audit screen-level lock guards and update any that read
`walletContainer` directly rather than `security.isLocked`.

## Retrospective

- **Hardened Password Security**: Replaced the non-cryptographic `simpleHash`
  with a robust SHA-256 hashing scheme. Each wallet now generates a unique
  random salt at password creation, stored alongside the hash. This
  effectively mitigates rainbow table attacks and collision risks.
- **Durable Persistence**: All critical state mutations (`lockWallet`,
  `unlockWithPassword`, `setTheme`, `setFiatCurrency`, `setPassword`,
  `toggleBiometrics`) now properly `await` the `persist()` call. This ensures
  that the application does not return from an action until the changes are
  safely committed to disk, preventing state loss during rapid navigation or
  app termination.
- **Race Condition Mitigation**: Hardened the UI in `ProfileLock.tsx` and
  `ProfilePreferences.tsx` by explicitly awaiting async store actions. This
  eliminates a critical race condition where the wallet could be locked
  on-disk before the password hash was successfully persisted, preventing
  potential user lockout.
- **Schema Lifecycle Management**: Bumped `AppState` and `useAppStore` to
  `schemaVersion: 5`. Introduced a dedicated `migrate()` function in
  `useAppStore.ts` to handle version transitions. The migration from v4 to v5
  automatically clears legacy password hashes to prevent lock-outs while
  enforcing the new security standards.
- **Gated Access**: Confirmed `RootStack.tsx:233` is the single gate on
  `security.isLocked` — when locked, only the `Unlock` screen is rendered.
  The "audit `walletContainer` reads" sub-goal turned out to be vacuous: that
  field no longer exists in the store (the original milestone doc predates a
  prior refactor), so there were no screen-level reads to fix.
- **Cleanup**: Removed the legacy `simpleHash` utility entirely, ensuring all
  security-related hashing goes through `expo-crypto`.

