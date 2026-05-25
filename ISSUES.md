# Issues

Open items and follow-ups that do not yet belong to a milestone. If an issue grows into a scoped implementation effort, move it into a dedicated milestone doc under `docs/`.

Last updated: 2026-05-25

Resolved scoped efforts move under `docs/` with a `# RESOLVED` prefix — see [docs/ISSUE_PUSH_NOTIFICATIONS_SEMANTIC.md](./docs/ISSUE_PUSH_NOTIFICATIONS_SEMANTIC.md) for the former Issue 1 (notification classification and copy).

Issues promoted to scoped milestones move under `docs/MILESTONE_NN.agents.md` — see [docs/MILESTONE_26.agents.md](./docs/MILESTONE_26.agents.md) for the former Issue 2 (animation and loading feedback pass).

## Issue 1: Password Setup Is Too Slow

### Summary
Setting a password currently takes close to a minute, which is far too slow for an onboarding or security-setting flow.

### Current Behavior
- The password setup flow can take almost a minute before it completes.

### Expected Behavior
- Password setup should complete quickly enough that it feels immediate or near-immediate on a normal mobile device.
- Any intentionally expensive key-derivation work should still stay within a UX budget that does not make the app feel stalled.

### Open Questions
- Is the delay coming from PBKDF2 parameters, repeated persistence work, unnecessary serialization, or UI work being blocked on the main thread?
- Is the slowness uniform across platforms, or mostly visible on Android / lower-end devices?

### Notes
This should be treated as both a UX issue and a security-implementation review. If the current cost factor is justified, the UI still needs clearer progress feedback; if it is not justified, the derivation settings likely need tuning.

## Issue 3: `edgeToEdgeEnabled` in app.json Is Deprecated

### Summary
`npx expo prebuild` warns: `EDGE_TO_EDGE_PLUGIN: edgeToEdgeEnabled customization is no longer available — Android 16 makes edge-to-edge mandatory. Remove the edgeToEdgeEnabled entry from your app.json/app.config.js.`

### Current Behavior
- `app.json` sets `android.edgeToEdgeEnabled: true`.
- Prebuild emits the warning on every run; the setting is silently ignored.

### Expected Behavior
- Remove the `edgeToEdgeEnabled` key from `app.json` so prebuild runs clean. Behavior is unchanged because Android 16 enforces edge-to-edge unconditionally.

### Notes
Surfaced during the Milestone 25 prebuild that wired the new launcher icon. Drive-by fix, no migration needed. `RootStack.tsx`'s custom Android header already handles the edge-to-edge top inset via `useSafeAreaInsets()`, so removing the key doesn't break the header.

## Issue 4: iOS Native Project Not Yet Generated

### Summary
Only `android/` exists on disk; there is no `ios/` directory. Local iOS builds will fail until prebuild is run for the iOS platform.

### Current Behavior
- `pnpm ios` cannot build because `ios/` is missing.
- `app.json` already declares `ios.bundleIdentifier`, `ios.icon.{light,dark,tinted}`, and the iOS splash config, so prebuild has everything it needs.
- `/ios` and `/android` are both in `.gitignore` — native projects are expected to be regenerated, not tracked.

### Expected Behavior
- Run `npx expo prebuild --clean --platform ios` to generate `ios/` from `app.json`. This will create `Images.xcassets/AppIcon.appiconset/` with the light/dark/tinted iOS 18 icon variants from `assets/images/icon{,-dark,-tinted}.png` and wire the splash + notification configuration.
- EAS builds are unaffected because they run their own prebuild on the build server from `app.json`.

### Notes
Defer until iOS development or a TestFlight build is actually needed. The Milestone 25 wire-up of brand icons covers iOS in `app.json` already, so prebuild will pick them up correctly the first time it runs.
