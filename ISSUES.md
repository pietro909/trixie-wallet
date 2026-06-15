# Issues

Open items and follow-ups that do not yet belong to a milestone. If an issue grows into a scoped implementation effort, move it into a dedicated milestone doc under `docs/`.

Last updated: 2026-06-15

Resolved scoped efforts move under `docs/` with a `# RESOLVED` prefix — see [docs/ISSUE_PUSH_NOTIFICATIONS_SEMANTIC.md](./docs/ISSUE_PUSH_NOTIFICATIONS_SEMANTIC.md) for the former Issue 1 (notification classification and copy) and [docs/ISSUE_BOLTZ_ENDPOINTS.md](./docs/ISSUE_BOLTZ_ENDPOINTS.md) / [docs/ISSUE_BOLTZ_LEGACY.md](./docs/ISSUE_BOLTZ_LEGACY.md) for the former Issues 5 and 6 (Boltz endpoint migration and chain-swap refund material guard).

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

## Issue 8: Handle Swaps From Legacy Boltz Endpoint

### Summary
Some historical Arkade swaps were created against the legacy Boltz endpoint `https://api.ark.boltz.exchange`. The wallet must continue to identify, restore, classify, and recover those swaps even though new mainnet swap traffic should use the primary Boltz endpoint `https://api.boltz.exchange`.

### Current Behavior
- Newer mainnet swaps are expected to live on the primary Boltz endpoint.
- Older swaps may only be known by the legacy Arkade-specific endpoint.
- A restored legacy chain swap can appear expired/refundable in local recovery state, but the actual refund may still fail if the corresponding Arkade VHTLC is not found or if required refund material is incomplete.
- Users can see confusing recovery rows unless the UI clearly distinguishes actionable legacy swaps from support-only historical records.

### Expected Behavior
- Swap restore and status refresh should check the primary endpoint first, then fall back to the legacy endpoint only for swap-not-found responses.
- Recovery should show a refund action for a legacy swap only when:
  - the legacy endpoint knows the swap,
  - local refund material is complete,
  - the reconstructed Arkade VHTLC exists and is unspent.
- If any of those checks fail, Recovery should not show a runnable refund button and should offer a support bundle instead.
- Activity Details should use the same readiness checks as Profile -> Recovery so both surfaces agree.

### Notes
This is related to Issue 5, but tracks the user-visible legacy-swap recovery behavior specifically: old Boltz records are not enough by themselves to prove that an Arkade refund is possible. The wallet must prove there is an unspent local VHTLC before presenting a refund action.

