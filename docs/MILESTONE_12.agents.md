# Milestone 12: In-app push notifications

**Status:** Delivered (commits `1071e22`, `2bb29a5`, `e26981f`, `49aeb8c`).

Goal: OS-level local notifications and in-app alerts for wallet activity, primarily Boltz swap status changes discovered by the background poll task, plus a Profile-driven preference surface.

The milestone proved:
- The app requests notification permissions opt-in (only when the user explicitly toggles the master switch in Profile).
- A local push notification fires when a swap is claimed or refunded while the app is in the background.
- A toast is shown when a swap status changes while the app is in the foreground (or when the foreground "drain" runs after a backgrounded period, only if the OS notification did not already surface the event).
- Tapping a notification opens the app and navigates to `ActivityDetails` if the payload carries an `activityId`, otherwise falls back to the `Activity` stack route.
- Notification preferences (global toggle + per-category Swaps / Payments) live in `ProfilePreferences`, with a permission-state indicator and an "Open Settings" link when the OS-level permission is denied.

## What shipped

### Dependencies & manifest
- `expo-notifications@~55.0.22` added to `package.json`.
- `app.json` registers the plugin with `icon: ./assets/images/android-icon-monochrome.png` and `color: #ff007f` so Android tray notifications carry the brand silhouette + tint.
- `POST_NOTIFICATIONS` is auto-injected by the plugin (no manual manifest edit required).

### Service layer (`app/services/notifications.ts`)
- `setNotificationHandler` registered at module scope so iOS foreground-scheduled notifications are presented (otherwise iOS suppresses them by default).
- `requestNotificationPermissions()` / `checkNotificationPermissions()` helpers.
- `scheduleLocalNotification({ title, body, data, channelId })` — immediate-delivery via `trigger: { channelId }` (the channel goes on the trigger, not on `content`).
- `ensureChannelsReady()` — lazy, memoized channel setup that `scheduleLocalNotification` awaits. Localizes the contract "if you can schedule, channels are ready" so the OS-scheduled headless JS context is forward-compatible with future channel additions. Rejections are caught and logged via `recordPersistedError`; Android falls back to the default channel if a named one is missing.
- Android channels: `default`, `swaps`, `payments` — each with distinct vibration patterns (single / double / pulsing triple) and a brand-pink `lightColor`.
- `shouldNotify(category)` reads the persisted prefs and applies strict opt-in semantics: missing / unparseable storage returns false.

### Store (`app/store/useAppStore.ts`, `app/store/types.ts`)
- `NotificationPreferences = { enabled, swaps, payments }` added to `AppState["preferences"]`.
- Default `enabled: false` (opt-in). Per-category defaults are `true` so flipping the master switch yields the full notification set without an extra step.
- `setNotificationPreferences(partial)` action.
- `normalizePreferences` defaults missing keys safely on hydration and on backup restore.
- The foreground incoming-funds listener gates its "Payment received" toast on `enabled && payments`.
- The persisted-state storage key is exported from `app/store/storage-keys.ts` so the notifications service can reference it without forming an `useAppStore → swap-background → notifications → useAppStore` cycle.

### Background integration (`app/services/arkade/swap-background.ts`)
- `RecordingSwapTaskQueue.pushResult` fires a local notification when the swap-poll task reports `claimed > 0` or `refunded > 0`. Claimed and refunded counts are coalesced into a single notification body when both occur in the same run.
- `RecordedSwapTaskResult.notified` is a new field set to `true` only when (1) the OS scheduling succeeded **and** (2) `getPermissionsAsync().status === "granted"` post-schedule. This avoids the case where iOS or Android silently drops the notification but the foreground drain still thinks the user has been informed.
- Notification-scheduling failures route through `recordPersistedError` so they surface in the support bundle.

### Foreground integration (`app/services/arkade/lightning.ts`)
- `resumeLightningSwaps` now takes `notificationPrefs: NotificationPreferences` and passes it to `drainBackgroundSwapPollResults`. Prefs are threaded as a parameter rather than read from the store to avoid the service ⇄ store import cycle.
- `drainBackgroundSwapPollResults` sums toast-eligible counts across all recorded results (skipping entries with `notified === true`) and emits at most one toast per category per resume pass, gated on `enabled && swaps`.

### Foreground toast surface (`app/components/ToastProvider.tsx`, `app/services/toast-emitter.ts`)
- A module-scope `toastEmitter` exposes `show(message, type)` and `addListener(fn)` for non-component services.
- `ToastProvider` attaches one listener and renders the animated banner; the React Context was removed. `useToast()` is now a thin shim that delegates to `toastEmitter.show`, so component and non-component callers converge on the same channel. All existing `useToast()` call sites continue to work unchanged.

### Navigation / hook (`app/hooks/useNotifications.ts`, `App.tsx`)
- `useNotifications` registers `addNotificationResponseReceivedListener` and routes taps:
  - If `data.activityId` is a string → `navigation.navigate("ActivityDetails", { activityId })`.
  - Otherwise → `navigation.navigate("Activity")` (top-level stack route, not a tab).
- The hook is hosted by a `NotificationsBridge` component placed **inside** `<NavigationContainer>` so `useNavigation()` resolves. Calling it from `AppContent` would crash at render (NavigationContainer context is provided to descendants only).
- The hook does **not** auto-request permissions on launch. Permissions are requested only when the user toggles the master switch on in Profile.

### Profile UI (`app/screens/ProfilePreferences.tsx`)
- "Notifications" section with master toggle and per-category toggles for Swaps and Payments.
- OS permission status is re-checked via `useFocusEffect` so returning from system Settings updates the warning row in real time.
- When `enabled === true` and OS permission is `denied`, a tappable warning row appears: "System permission is denied. Notifications won't be delivered until you allow them in Settings. → Open Settings". The toggle stays at the user's intent regardless of OS response.

### Backup envelope (`app/services/backup/serializer.ts`)
- `BackupPreferences = Omit<AppState["preferences"], "notifications">` — `notifications` are a device-local preference (parallel to `backgroundTasks`) and are stripped at serialization time, so restoring on a new device does not carry the old device's notification choices.

## Implementation checklist

### Phase 1: Infrastructure & Permissions
- [x] **Dependencies**: `expo-notifications` installed; plugin registered in `app.json` with brand icon + color.
- [x] **Store**: `preferences.notifications` added with default `enabled: false` (opt-in).
- [x] **NotificationService**: `app/services/notifications.ts` wraps permissions, channels (lazy via `ensureChannelsReady`), and scheduling.
- [x] **UI**: "Notifications" section in `ProfilePreferences.tsx` with master + per-category toggles and a permission-denied indicator.

### Phase 2: Background Notification Logic
- [x] **Task Hook**: `RecordingSwapTaskQueue.pushResult` triggers notifications.
- [x] **Logic**: Notifications fire when `claimed > 0` or `refunded > 0` and prefs allow.
- [ ] **Payload (deep-link by activityId)**: The upstream task data carries only counts (`{ polled, updated, claimed, refunded, errors }`) — no swap IDs. The notification payload deliberately omits `activityId`; the tap handler falls back to the Activity list. Tracked as **ISSUES.md #6** (per-row deep-link from background-fired notifications).

### Phase 3: Foreground Experience & Deep Linking
- [x] **Notification Listener**: `useNotifications` hook attaches `addNotificationResponseReceivedListener`.
- [x] **Navigation**: Tap routes to `ActivityDetails` when payload carries an id; falls back to the `Activity` stack route.
- [x] **Real-time Alerts**: `drainSwapPollResults` foreground path shows coalesced toasts for updates discovered after a background period, respecting prefs and the `notified` flag.

### Phase 4: Polish & Testing
- [x] **Content**: "Payment Received" / "Swap Refunded" / combined "Swap activity" titles.
- [x] **Throttling**: Claim + refund coalesced into one notification per run; drain emits at most one toast per category per resume pass.
- [x] **Android 13+**: No app-side code path is Android-version-specific; `expo-notifications` handles `POST_NOTIFICATIONS` automatically. Smoke-test checklist below.
- [x] **Documentation**: `ROADMAP.md` and `ISSUES.md` updated.

## Known limitations & follow-ups

### Deferred to upstream / future work
- **Per-row deep linking from background-fired notifications** (ISSUES.md #6). The upstream `@arkade-os/boltz-swap/expo/background` task emits aggregate counts only. Resolving this requires either an upstream change (expose `claimedIds` / `refundedIds` in `TaskResult.data`) or a foreground reconciliation step that maps swap IDs to activity rows before showing the notification. Not addressed in this milestone.
- **Channel-level disable detection** (Android only). When the user disables a specific notification channel in system Settings (while keeping app-level notifications granted), `pushResult` still treats the result as "notified" because `getPermissionsAsync().status === "granted"` returns the app-level status. The notification is silently dropped by Android and the foreground drain also skips the toast (since `notified === true`). Users get zero feedback in this rare edge case. A fix would call `getNotificationChannelAsync(channelId)` and check the channel's `importance !== AndroidImportance.NONE` before setting `notified = true`. Acceptable for v1.
- **Channel-property updates across app upgrades**. Once a channel exists, user customizations win — code-side changes to `vibrationPattern` / `importance` / etc. are silently ignored on existing installs. Affects only fresh installs / cleared data. Document and pick channel properties carefully upfront.
- **iOS notification permission granularity**. `requestPermissionsAsync` requests alerts + sounds + badges. If a user grants alerts only (rare), our overall `status` check reports `granted`. Acceptable for the milestone's use case (banner + sound, no badge).

### Style choices worth flagging for future-me
- The `notifications` service is intentionally importable from the headless JS context (no React, no theme, no store dependencies beyond the storage key). Anything added here should preserve that property.
- `notificationPrefs` is threaded through `resumeLightningSwaps` as a parameter — do not import `useAppStore` from `lightning.ts` (the store already imports `lightning.ts`, so any back-import would form a cycle).
- The `notified` flag's truthfulness is critical to avoid the double-notification problem (#7 in the review). If you add new code paths that schedule notifications, update the flag invariant: `notified=true` ⇔ "we believe the user has seen this in the OS tray".

## Manual QA — Android 13+ (POST_NOTIFICATIONS)

`expo-notifications`' `requestPermissionsAsync` triggers the Android 13+ runtime prompt automatically, and the plugin auto-injects the `POST_NOTIFICATIONS` permission into the manifest. No app-side code path is Android-version-specific. These scenarios should be verified on a physical Android 13+ device once per release:

1. **Fresh install, no prior permission.** Open the app, complete wallet setup, navigate to Profile → toggle "Enable Notifications" on. Expect the system prompt; whichever button the user taps, the toggle state matches the user's intent (stays on). If denied, the "Open Settings" row appears immediately below the toggle.
2. **Permission denied → re-prompt suppressed.** With the app already denied once, toggle off then on again. Expect no prompt (Android suppresses re-prompts after a denial); the "Open Settings" row stays visible. Tapping it opens system Settings for the app.
3. **Re-grant via Settings.** From the Settings notifications page, re-enable notifications, then switch back to the app. The "Open Settings" row disappears on focus (the `useFocusEffect` re-check).
4. **Channel-level disable.** With app-level notifications granted, disable the "Swaps" channel in system Settings. Trigger a background claim event. Expect: no tray notification (Android silently drops). *Caveat:* `pushResult` currently sets `notified=true` based on app-level permission only, so the foreground drain will skip its toast too — see "Known limitations" above.
5. **OS upgrade preserving denial.** Install on Android <13 (auto-granted), upgrade device to Android 13+. The app-level permission migrates as "granted" and notifications continue to fire.

## Commit history

| Commit | Summary |
| --- | --- |
| `1071e22` | feat: Milestone 12 — in-app push notifications (initial implementation + critical-bug fixes from review batch CR-1..CR-3 and high-priority #4) |
| `2bb29a5` | fix: Milestone 12 notification UX (review batch A — #5 opt-in, #7 no-double, #8 toast prefs, #18 coalesce) |
| `e26981f` | fix: Milestone 12 cross-context robustness (review batch B — #6 lazy channels, #15 logged errors, A2 notified-flag truthfulness, Android 13+ QA doc) |
| `49aeb8c` | chore: Milestone 12 polish (review batch C — #9 single toast path, #12 brand color, #13 vibration patterns, #14 plugin manifest config) |
