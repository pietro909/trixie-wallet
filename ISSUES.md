# Issues

Open items and follow-ups that do not yet belong to a milestone. Items that grew into milestones are tracked in their respective docs instead.

## 1. Background Tasks logs and error reporting

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

## 2. Preference toggle persistence is not actually awaited at the call site

**Status: OPEN**

**Where:** `app/screens/ProfilePreferences.tsx` (theme / fiat / bitcoin unit `Pressable`s, notification `Switch`es)

Handlers were updated during Milestone 15 to `onPress={async () => await setThemePref(opt.value)}` and `onValueChange={async (v) => await setNotificationPrefs(...)}` to match the project's "fully durable" persistence goal. In practice this is close to a no-op: `Pressable.onPress` and `Switch.onValueChange` call the handler synchronously and discard the returned promise. Nothing in React Native waits for the persist to land before the gesture is considered complete.

Durability of preference writes is still provided by the store action itself (`setTheme` / `setFiatCurrency` / `setBitcoinUnit` / `setNotificationPreferences` each `await persist(get())` internally). The remaining gap is the small race between the tap and `AsyncStorage.setItem` resolving — if the user immediately backgrounds or kills the app, the write may be lost.

A real fix would either (a) disable the control and show a spinner until the persist resolves, or (b) introduce a top-level persist queue that the app-lifecycle handler flushes before allowing suspension. Both are larger than warranted today; preference writes are cheap and the race window is sub-millisecond. Tracking so the M15 retrospective wording does not imply more than what's implemented.

## 3. Password gate hashes with SHA-256 instead of a KDF

**Status: RESOLVED (FOLLOW-UP REQUIRED)** — `hashPassword` now uses PBKDF2-SHA256 at 300k iterations, the unlock minimum was raised to 8 characters, and the backup export form carries a soft warning against password reuse. The remaining follow-up (require the unlock password on top of biometrics for sensitive UI flows) is out of scope for this fix and can be filed separately if wanted.

**Where:** `app/store/useAppStore.ts` (`hashPassword`) and `app/screens/ProfileLock.tsx` (6-char minimum at line 25)

### Follow-up work

- Replace `hashPassword` with PBKDF2 / Argon2id / scrypt — same KDF family the backup uses, ideally at comparable cost (or higher, since the unlock hash only needs to be verified once per session). The simplest fix is to reuse `pbkdf2Async` from `@noble/hashes` as already imported by `backup/crypto.ts`.
- Raise the minimum password length above 6 (the 8-char minimum on the backup export is a reasonable floor; the two should not diverge).
- Surface the password-reuse risk in the export flow — e.g. a tooltip explaining that the backup password should be different from the unlock password, or a soft check that flags reuse.
- Consider whether the unlock password should be required to access locally sensitive UI flows (export, key reveal) on top of biometrics.

## 4. `markDirtyForBackup()` fires `persist()` without awaiting

**Status: OPEN**

**Where:** `app/store/useAppStore.ts` (`markDirtyForBackup`)

Milestone 15 made the user-driven store actions `await persist(get())` so they cannot return before the AsyncStorage write lands. `markDirtyForBackup()` is the one remaining exception: it flips `security.dirtyForBackup` and then calls `void persist(useAppStore.getState())`, deliberately not awaiting. It runs as a side-effect of the swap-event listener (`setSwapEventListener`) — not a user action — so there is no call site that could await it without changing the listener contract.

The race window is small (the flag will be re-set on the next swap event anyway), but a swap-event burst that lands moments before app termination could lose the dirty mark, leaving the Reset gate's "needs backup" warning silent until the next mutation.

A real fix would either (a) make the listener async and have the SwapManager await it, or (b) introduce a top-level persist queue that the app-lifecycle handler flushes before allowing suspension (same mechanism that would close [#2](#2-preference-toggle-persistence-is-not-actually-awaited-at-the-call-site)).
