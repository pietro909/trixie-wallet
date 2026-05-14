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

**Where:** `app/store/useAppStore.ts` (`hashPassword`) and `app/screens/ProfileLock.tsx` (6-char minimum at line 25)

Milestone 15 specified — and shipped — SHA-256 + per-wallet random salt for the unlock password. That's a strict upgrade over the previous 32-bit `simpleHash`, but SHA-256 is a fast hash, not a password-derived KDF. An attacker with read access to `app_state_v1` (the AsyncStorage blob) has both the hash and the salt and can brute-force the password offline at GPU speeds — order of 10–100 billion SHA-256/sec on consumer hardware. Combined with the 6-character minimum, a stolen `app_state_v1` file is effectively a stolen password for anything in the same character space.

### What it does *not* expose directly

The unlock password is not the encryption key for anything on disk:

- **The seed is in `expo-secure-store`** (iOS Keychain / Android Keystore — see `app/services/arkade/secret-store.ts`). It's gated by the OS-level keystore, not by the unlock hash. Cracking the SHA-256 hash does not let an attacker read the seed from `expo-secure-store`.
- **The encrypted backup bundle uses its own KDF chain.** `app/services/backup/crypto.ts` derives the AES-256-GCM key with PBKDF2-SHA256 at 200,000 iterations over a fresh 16-byte salt. The export flow (`ProfileBackup.tsx:174`) requires a separately-entered password with an 8-character minimum, distinct from the unlock password.

So the *direct* blast radius of cracking the unlock hash is impersonation inside a running app instance on a device the attacker controls: toggle settings, view balances and addresses, attempt biometrics-fallback unlocks. They cannot decrypt the seed or the backup envelope through this path alone.

### Where it actually matters: password reuse + a stolen backup

The realistic chained-attack scenario is **password reuse between the unlock password and the backup password**:

1. The user picks the same string for the unlock gate and the backup export (likely — both are "wallet password" in the same mental slot).
2. The attacker gets hold of *both* `app_state_v1` (exfiltrated from the device or a device-level backup) and an exported `.trixie.backup` envelope (recovered from cloud sync, email, AirDrop, file-sharing, etc.).
3. They use the weak SHA-256+salt hash as the cheap oracle to recover the password — a 6-char ASCII password falls in seconds to minutes.
4. They apply the recovered password against the backup envelope's PBKDF2-200k+AES-GCM. PBKDF2-200k buys ~200,000× slowdown per guess, which would have made a fresh dictionary attack on the envelope expensive — but only the *first* successful decryption costs that much, because the password came from the cheap side. Funds gone.

The unlock hash effectively shortens the attack on the backup from "exhaust the password space at 200k iterations per guess" to "exhaust the password space at one iteration per guess." Both surfaces share the user's password but not the iteration cost, and that asymmetry is the bug.

### Follow-up work

- Replace `hashPassword` with PBKDF2 / Argon2id / scrypt — same KDF family the backup uses, ideally at comparable cost (or higher, since the unlock hash only needs to be verified once per session). The simplest fix is to reuse `pbkdf2Async` from `@noble/hashes` as already imported by `backup/crypto.ts`.
- Raise the minimum password length above 6 (the 8-char minimum on the backup export is a reasonable floor; the two should not diverge).
- Surface the password-reuse risk in the export flow — e.g. a tooltip explaining that the backup password should be different from the unlock password, or a soft check that flags reuse.
- Consider whether the unlock password should be required to access locally sensitive UI flows (export, key reveal) on top of biometrics.

## 10. `markDirtyForBackup()` fires `persist()` without awaiting

**Status: OPEN**

**Where:** `app/store/useAppStore.ts` (`markDirtyForBackup`)

Milestone 15 made the user-driven store actions `await persist(get())` so they cannot return before the AsyncStorage write lands. `markDirtyForBackup()` is the one remaining exception: it flips `security.dirtyForBackup` and then calls `void persist(useAppStore.getState())`, deliberately not awaiting. It runs as a side-effect of the swap-event listener (`setSwapEventListener`) — not a user action — so there is no call site that could await it without changing the listener contract.

The race window is small (the flag will be re-set on the next swap event anyway), but a swap-event burst that lands moments before app termination could lose the dirty mark, leaving the Reset gate's "needs backup" warning silent until the next mutation.

A real fix would either (a) make the listener async and have the SwapManager await it, or (b) introduce a top-level persist queue that the app-lifecycle handler flushes before suspension (same mechanism that would close [#8](#8-preference-toggle-persistence-is-not-actually-awaited-at-the-call-site)).

