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

## 5. Background Tasks logs and error reporting

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

## 6. Lightning Address `destination` truncated by `shorten()` in `buildBareLnurl`

**Status: OPEN**

**Where:** `app/services/paymentParser.ts` (`buildBareLnurl`)

`detectBareType` recognises Lightning Addresses as `lnurl` type and routes them through `buildBareLnurl`, which sets `destination: shorten(lnurl, 14, 6)`. `shorten()` was built for opaque bech32 LNURL strings; on a human-readable address it produces middle-elided output like `alice+tag@su…ple.co` for `alice+tag@subdomain.example.co`. Addresses are usually short enough that the threshold (`<= head + tail + 3 = 23` chars) returns them verbatim, but longer ones get mangled.

Worth deciding the truncation rule across all the surfaces that render `destination` (SendInput card, SendAmount summary, SendReview, SendResult, post-fact activity rows) before changing it — naively skipping `shorten()` could overflow narrow Review rows. The fix is probably a separate `shortenAddress`/`shortenLnurl` split, gated on `LN_ADDRESS_RE.test(raw)`.

## 7. Swap notifications cannot deep-link to a specific Activity row

**Status: OPEN**

**Where:** `app/services/arkade/swap-background.ts` (`RecordingSwapTaskQueue.pushResult`)

The OS-scheduled swap-poll task (`@arkade-os/boltz-swap/expo/background`) emits `TaskResult.data` shaped as `{ polled, updated, claimed, refunded, errors }` — counts only, no claimed/refunded swap IDs. As a result, the local notification fired on claim/refund cannot include an `activityId`; tapping the notification falls back to the Activity list rather than opening the specific Activity Detail screen.

To deep-link properly, the upstream task would need to expose the list of swap IDs whose status transitioned during the run (e.g. `{ claimedIds: string[], refundedIds: string[] }`), or the foreground "drain" path would need to reconcile claimed swap IDs out of the SQLite swap repository before the user sees the notification. Either approach is more invasive than appropriate for Milestone 12; tracking here.

## 8. Preference toggle persistence is not actually awaited at the call site

**Status: OPEN**

**Where:** `app/screens/ProfilePreferences.tsx` (theme / fiat / bitcoin unit `Pressable`s, notification `Switch`es)

Handlers were updated during Milestone 15 to `onPress={async () => await setThemePref(opt.value)}` and `onValueChange={async (v) => await setNotificationPrefs(...)}` to match the project's "fully durable" persistence goal. In practice this is close to a no-op: `Pressable.onPress` and `Switch.onValueChange` call the handler synchronously and discard the returned promise. Nothing in React Native waits for the persist to land before the gesture is considered complete.

Durability of preference writes is still provided by the store action itself (`setTheme` / `setFiatCurrency` / `setBitcoinUnit` / `setNotificationPreferences` each `await persist(get())` internally). The remaining gap is the small race between the tap and `AsyncStorage.setItem` resolving — if the user immediately backgrounds or kills the app, the write may be lost.

A real fix would either (a) disable the control and show a spinner until the persist resolves, or (b) introduce a top-level persist queue that the app-lifecycle handler flushes before allowing suspension. Both are larger than warranted today; preference writes are cheap and the race window is sub-millisecond. Tracking so the M15 retrospective wording does not imply more than what's implemented.

## 9. Password gate hashes with SHA-256 instead of a KDF

**Status: OPEN**

**Where:** `app/store/useAppStore.ts` (`hashPassword`) and `app/screens/ProfileLock.tsx` (minimum length)

Milestone 15 specified — and shipped — SHA-256 + per-wallet salt for the unlock password. That's a strict upgrade over the previous 32-bit `simpleHash`, but SHA-256 is a fast hash, not a password-derived KDF. An attacker with read access to the persisted state file has both the hash and the salt, and can brute-force the password offline at GPU speeds. Combined with the 6-character minimum in `ProfileLock.tsx:25`, the gate is weak against any adversary who can exfiltrate `app_state_v1`.

The unlock password is a UI gate, not the encryption key for sensitive material (the seed and Lightning swap state are protected separately — see `app/services/backup/crypto.ts` and `app/services/arkade/secret-store.ts`). So a weak gate doesn't directly expose funds. The risk is more like: an attacker who has the file can determine the password, then use it to impersonate the user inside the running app (toggle settings, trigger unlocks via biometrics fallback, etc.).

Follow-up work for a future hardening pass:
- Replace `hashPassword` with PBKDF2 / Argon2id / scrypt via `expo-crypto`'s lower-level APIs or a vetted JS library.
- Raise the minimum password length (the 6-char floor is a placeholder).
- Consider whether the password should be required to access locally sensitive UI flows (export, key reveal) on top of biometrics.

## 10. Simplify `migrate()` to wipe-on-mismatch per alpha policy

**Status: OPEN**

**Where:** `app/store/useAppStore.ts` (`migrate`, `hydrate`) and `app/store/__tests__/useAppStore.test.ts`

Milestone 15 introduced a `schemaVersion` ladder (bumped 4 → 5) and a `migrate()` function in `hydrate()` to translate older persisted states forward. This predates the alpha policy now codified in `FOUNDATION.md` ("Project Status: Alpha"), which calls for wipe-on-mismatch instead of migrations while the project is in alpha.

Concrete cleanup when next touching this area:
- Drop `migrate()` entirely from `app/store/useAppStore.ts`.
- In `hydrate()`, replace the `storedVersion < CURRENT_SCHEMA_VERSION` migration branch with the same wipe path already used for `storedVersion > CURRENT_SCHEMA_VERSION` (remove `STORAGE_KEY`, clear legacy storage, set `_hydrated: true`, return).
- Remove the `migrate()` test cases from `app/store/__tests__/useAppStore.test.ts`. Keep the `hashPassword` and `generateSalt` cases.
- Leave `schemaVersion: 5` in place on `AppState` / `DEFAULT_STATE` — it still serves as the wipe-vs-load gate, just without a forward-migration ladder hanging off it.

Defer the actual cleanup to whenever the next change in `useAppStore.ts` makes it convenient; no need to schedule it as standalone work.