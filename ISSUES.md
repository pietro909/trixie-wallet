# Issues

Open items and follow-ups that do not yet belong to a milestone. If an issue grows into a scoped implementation effort, move it into a dedicated milestone doc under `docs/`.

Last updated: 2026-05-27

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

## Issue 5: Boltz Endpoint Migration and Legacy Recovery

### Summary
Mainnet Arkade swaps now live on the primary Boltz API at `https://api.boltz.exchange`, but the wallet still pins mainnet Lightning/Boltz traffic to the legacy Arkade-specific endpoint `https://api.ark.boltz.exchange`.

### Current Behavior
- New mainnet Boltz providers are constructed with the legacy endpoint from `app/services/arkade/lightning.ts`.
- Existing historical swaps may only be discoverable on the legacy endpoint.
- Newer Arkade swaps should use the primary Boltz endpoint.
- Recovery can show an actionable chain-swap refund row even when the local/restored swap data is missing fields needed by the SDK refund path.

### Expected Behavior
- New swap creation, fee quotes, limits, and foreground WebSocket management use `https://api.boltz.exchange` on mainnet.
- Historical swap status, restore, and recovery actions fall back to `https://api.ark.boltz.exchange` only when the primary endpoint returns a swap-not-found response.
- Recovery does not present an actionable refund button unless the selected endpoint and local swap material are sufficient to execute the refund.

### Plan
Detailed plan: [docs/ISSUE_BOLTZ_ENDPOINTS.md](./docs/ISSUE_BOLTZ_ENDPOINTS.md).

## Issue 6: Restored Chain Swaps Missing Refund Timeouts

### Summary
Restored ARK->BTC chain swaps can be rebuilt with enough status data to appear refundable, but without the full VHTLC timeout set needed to execute `refundArk()`.

### Current Behavior
- A restored swap can have status `swap.expired`, causing Recovery to show "Bitcoin send - refund available".
- The restored local swap object may only contain `response.lockupDetails.timeoutBlockHeight`.
- The SDK refund path requires `response.lockupDetails.timeouts`.
- Tapping "Refund Arkade lockup" then fails with an error such as `Swap L4Kx9HZscpJ9: missing timeouts in lockup details`.

### Expected Behavior
- Restored chain swaps include `response.lockupDetails.timeouts` whenever the Boltz restore response has enough data to derive it.
- If the full timeout set cannot be restored, Recovery and Activity Details must treat the row as support-only instead of actionable.
- The UI must not show a runnable refund button for a swap whose local material cannot build the Arkade refund transaction.

### Notes
This is related to Issue 5 but distinct: endpoint fallback decides where the swap exists; this issue decides whether the restored local swap object has enough data to refund. The preferred fix is in `@arkade-os/boltz-swap` restore logic, with the wallet keeping a defensive material guard.

## Issue 7: Expose Wallet Public Keys for Debugging

### Summary
The app persists the wallet's compressed public key as `wallet.publicKeyHex`, but there is no dedicated advanced/debug surface that clearly shows both the compressed key and its x-only form. The x-only public key is useful when comparing wallet identity against Taproot-oriented protocol logs, SDK output, server traces, and support/debug tooling.

### Current Behavior
- `ProfileBackup` shows `Public key (compressed)` under Identifiers, alongside the Arkade address.
- The key is not surfaced in `AdvancedScreen`, even though that screen already contains server and support/debug details.
- The x-only public key is not displayed anywhere.
- Debugging often requires manually deriving the x-only key outside the app by stripping the leading compressed-key parity byte from a 33-byte SEC public key.

### Expected Behavior
- Add an advanced wallet identity section that shows:
  - `Public key (compressed)` using the existing 33-byte SEC hex value.
  - `Public key (x-only)` using the 32-byte x coordinate.
- Both values should be selectable and copyable.
- The x-only value should be derived, not persisted as new wallet state. For a valid compressed key beginning with `02` or `03`, derive it with `wallet.publicKeyHex.slice(2)`.
- Validate before deriving: only produce the x-only value when the compressed key is 66 hex characters and starts with `02` or `03`; otherwise show an unavailable/error state rather than silently displaying a malformed value.
- Keep this out of first-run, receive, and main wallet balance surfaces. It belongs in an advanced/debug context, not normal user workflow.

### Privacy and Safety Notes
- These are public keys, not spend keys, but they are still privacy-sensitive identifiers. They can link app state, support logs, addresses, swaps, and protocol traces to the same wallet identity.
- Do not include these values in support bundles unless the user explicitly requests identity material or the bundle makes the inclusion obvious.
- If included in any diagnostics path, prefer redaction or an explicit opt-in, consistent with the current support-bundle posture around share-safe data.

### Implementation Notes
- `wallet.publicKeyHex` is already persisted on `ArkadeWalletMetadata` and refreshed through `snapshotWallet()`, which reads `wallet.identity.compressedPublicKey()`.
- No schema change is required if the x-only key is computed at render time.
- The smallest useful UI change is to extend the existing `ProfileBackup` Identifiers section with `Public key (x-only)`.
- A stronger debugging-oriented change is to also add a wallet identity block to `AdvancedScreen`, near the existing server details and support bundle controls.

