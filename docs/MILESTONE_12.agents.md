# Milestone 12: In-app push notifications

Goal: Implement OS-level push notifications and in-app alerts for wallet activities, specifically for swap status updates occurring in the background.

This milestone should prove:
- The app requests and handles push notification permissions correctly (opt-in).
- A local push notification is shown when a swap is claimed or refunded while the app is in the background.
- A notification or toast is shown when a swap status changes while the app is in the foreground.
- Tapping a notification opens the app and navigates to the relevant Activity Detail screen.
- Notification preferences (global toggle, per-category toggles) are available in the Profile screen.

## Current State

### Permissions & Infrastructure
- `expo-notifications` is not installed in `package.json`.
- `app.json` lacks notification plugin configuration.
- No unified service exists for managing notification logic or permission requests.

### Background Task Integration
- `app/services/arkade/swap-background.ts` monitors Boltz swaps in the background and records results via `RecordingSwapTaskQueue.pushResult`.
- Current results only provide a summary (`claimed`, `refunded`, etc.) but don't trigger any user-facing alerts.
- The background task runs in a headless context where `expo-notifications` can still schedule local alerts.

### Navigation & Foreground Logic
- `RootStack.tsx` defines `ActivityDetails` route but has no logic to handle notification-based entry.
- `ToastProvider.tsx` provides basic success/error/info toasts, suitable for foreground real-time alerts.
- `useAppStore` lacks notification-specific preferences (e.g., `preferences.notifications.enabled`).

## Implementation Plan

### Phase 1: Infrastructure & Permissions
- [ ] **Dependencies**: Install `expo-notifications` and add it to `app.json` plugins.
- [ ] **Store**: Add `preferences.notifications` to `AppState` with toggles for `enabled`, `swaps`, and `payments`.
- [ ] **NotificationService**: Create `app/services/notifications.ts` to wrap `expo-notifications`.
  - Permission request/check helpers.
  - Local notification scheduling helper.
  - Notification channel setup (Android).
- [ ] **UI**: Add "Notifications" section to `ProfilePreferences.tsx`.

### Phase 2: Background Notification Logic
- [ ] **Task Hook**: Update `RecordingSwapTaskQueue.pushResult` in `swap-background.ts` to trigger notifications.
- [ ] **Logic**: If `claimed > 0` or `refunded > 0`, and notifications are enabled, schedule a local push.
- [ ] **Payload**: Ensure the notification payload includes `activityId` or `swapId` if possible for deep-linking. 
  - *Note: If the background task summary doesn't provide specific IDs, we may need to notify "A swap was updated" and let the user tap into the Activity list.*

### Phase 3: Foreground Experience & Deep Linking
- [ ] **Notification Listener**: Add a `useNotifications` hook (or update `AppStartupGate`) to listen for notification interactions.
- [ ] **Navigation**: Implement navigation logic to jump to `ActivityDetails` when a notification is tapped.
- [ ] **Real-time Alerts**: Update `drainSwapPollResults` (foreground-side) to show `showToast` messages for any updates discovered while the app was open.

### Phase 4: Polish & Testing
- [ ] **Content**: Refine notification titles and bodies (e.g., "Payment Received" vs "Swap Claimed").
- [ ] **Throttling**: Ensure we don't spam notifications if multiple swaps update simultaneously.
- [ ] **Android 13+**: Explicitly handle the POST_NOTIFICATIONS permission request flow.
- [ ] **Documentation**: Update `ROADMAP.md` and `ISSUES.md` if any limitations are found.

## Manual QA — Android 13+ (POST_NOTIFICATIONS)

`expo-notifications`' `requestPermissionsAsync` triggers the Android 13+
runtime prompt automatically, and the plugin auto-injects the
`POST_NOTIFICATIONS` permission into the manifest. No app-side code path
is Android-version-specific. These scenarios should be verified on a
physical Android 13+ device once per release:

1. **Fresh install, no prior permission.** Open the app, complete wallet
   setup, navigate to Profile → toggle "Enable Notifications" on. Expect
   the system prompt; whichever button the user taps, the toggle state
   matches the user's intent (stays on). If denied, the "Open Settings"
   row appears immediately below the toggle.
2. **Permission denied → re-prompt suppressed.** With the app already
   denied once, toggle off then on again. Expect no prompt (Android
   suppresses re-prompts after a denial); the "Open Settings" row stays
   visible. Tapping it opens system Settings for the app.
3. **Re-grant via Settings.** From the Settings notifications page,
   re-enable notifications, then switch back to the app. The "Open
   Settings" row disappears on focus (the `useFocusEffect` re-check).
4. **Channel-level disable.** With app-level notifications granted,
   disable the "Swaps" channel in system Settings. Trigger a background
   claim event. Expect: no tray notification (Android silently drops),
   but the foreground drain still shows a toast on app open because
   `RecordingSwapTaskQueue.pushResult` only sets `notified=true` when
   app-level permission is granted *and* leaves it false otherwise.
   *(Caveat: this branch does not currently detect channel-level disable
   — only app-level permission state.)*
5. **OS upgrade preserving denial.** Install on Android <13 (auto-granted),
   upgrade device to Android 13+. The app-level permission migrates as
   "granted" and notifications continue to fire.