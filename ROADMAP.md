# Roadmap

This repository is an Expo-only, iOS/Android self-custodial Arkade wallet app. The initial build (wallet create/restore, lock/unlock with password + biometrics, theming, navigation, and baseline screens) was delivered on 2026-04-27; ongoing work is tracked as milestones below.

This is a living document: tick items off as they land.

Last updated: 2026-06-16 (Milestone 29: SDK Server Compatibility & Signer Rotation added)

## Milestones

- [x] Milestone 1: Direct Arkade SDK Wallet Prototype ([docs/MILESTONE_1.agents.md](./docs/MILESTONE_1.agents.md))
  - Wire `@arkade-os/sdk` into runtime wallet creation, persistence, and the core create/restore/lock/unlock/send/receive flows.
- [x] Milestone 2: Lightning Invoices With Boltz Swaps ([docs/MILESTONE_2.agents.md](./docs/MILESTONE_2.agents.md))
  - Add Lightning receive/send via Boltz swaps (foreground-first; background/resume comes later).
- [x] Milestone 3: Activities ([docs/MILESTONE_3.agents.md](./docs/MILESTONE_3.agents.md))
  - Make the app own its Activity model by deriving Activity rows via an app-level history builder (instead of SDK transaction history).
- [x] Milestone 4: Activity Details ([docs/MILESTONE_4.agents.md](./docs/MILESTONE_4.agents.md))
  - Add an Activity details/inspection screen with copyable fields and network-aware explorer links.
- [x] Milestone 5: Bitcoin On-Chain Send (Collaborative Exit) ([docs/MILESTONE_5.agents.md](./docs/MILESTONE_5.agents.md))
  - Implement on-chain send via collaborative exit (`Ramps.offboard`) with fee preview and a review/result flow.
- [x] Milestone 6: Backup and Reset Safety ([docs/MILESTONE_6.agents.md](./docs/MILESTONE_6.agents.md))
  - Define a versioned, encrypted local backup bundle format + restore path; gate reset behind backup/recovery safety.
- [x] Milestone 7: Logs Export ([docs/MILESTONE_7.agents.md](./docs/MILESTONE_7.agents.md))
  - Export a redacted support bundle (no secrets) suitable for debugging sends/restores/background work.
- [x] Milestone 8: Background Claim, Refund, and Resume ([docs/MILESTONE_8.agents.md](./docs/MILESTONE_8.agents.md))
  - Make pending Lightning/swap state resume idempotently across suspend/restart/unlock.
  - Successfully delivered after refactoring the `@arkade-os/boltz-swap` SDK to split background tasks into an opt-in entrypoint (`/expo/background`), resolving the bundling issue. OS background scheduling is now active.
- [x] Milestone 9: Disaster Recovery Tooling ([docs/MILESTONE_9.agents.md](./docs/MILESTONE_9.agents.md))
  - Add explicit recovery tools for claimable/refundable swaps and other dangling recoverable state.
  - Implementation complete, pending manual verification — see "Manual testing status" in [README.md](./README.md).
- [x] Milestone 10: Assets support ([docs/MILESTONE_10.agents.md](./docs/MILESTONE_10.agents.md))
  - Add support for custom assets within the Arkade ecosystem.
  - Implementation complete: activity rendering carries asset deltas, wallet screen lists asset balances, send/receive flows handle assets via BIP21 `assetid`, mint/reissue/burn screens implemented, asset metadata caching with TTL, icon approval gate, backup payload bumped to v2 to carry imported asset ids, recovery filter skips expected asset-bearing settlement rows.
- [x] Milestone 11: Transaction Visibility ([docs/MILESTONE_11.agents.md](./docs/MILESTONE_11.agents.md))
  - Surface pending swap state accurately in all views and add a paginated VTXO detail screen sourced from the SDK.
- [x] Milestone 12: In-app push notifications ([docs/MILESTONE_12.agents.md](./docs/MILESTONE_12.agents.md))
  - Implement in-app and push notifications for wallet activities and swap status updates.
- [x] Milestone 13: Activity Caching ([docs/MILESTONE_13.agents.md](./docs/MILESTONE_13.agents.md))
  - Introduce an append-friendly cache for derived Activity rows with boring, explicit invalidation.
- [x] Milestone 14: LNURL ([docs/MILESTONE_14.agents.md](./docs/MILESTONE_14.agents.md))
  - Add LNURL and Lightning Address parsing + invoice fetching, distinct from BOLT11 handling.
- [x] Milestone 15: Security & Reliability ([docs/MILESTONE_15.agents.md](./docs/MILESTONE_15.agents.md))
  - Harden the password gate (SHA-256 + salt), make all state mutations await persist, add a schema-version guard in hydrate(), and audit screen-level lock guards.
- [x] Milestone 16: Mainnet Support ([docs/MILESTONE_16.agents.md](./docs/MILESTONE_16.agents.md))
  - Add a network selector (mutinynet / mainnet) to create and restore flows; encode the chosen network in the backup format.
- [ ] Milestone 17: Activity Checkpoints ([docs/MILESTONE_17.agents.md](./docs/MILESTONE_17.agents.md))
  - Freeze settled local Activity history behind safe checkpoints so large wallets refresh by deriving only the live tail.
- [ ] Milestone 18: Cloud Backup ([docs/MILESTONE_18.agents.md](./docs/MILESTONE_18.agents.md))
  - Add optional cloud transport for the encrypted backup bundle (transport only; format remains local-first).
- [ ] Milestone 19: Notification Deep-linking ([docs/MILESTONE_19.agents.md](./docs/MILESTONE_19.agents.md))
  - Enable OS notifications to deep-link directly to specific Activity rows by mapping background task results to activity IDs.
- [ ] Milestone 20: Non-default Wallet Behavior ([docs/MILESTONE_20.agents.md](./docs/MILESTONE_20.agents.md))
  - Formalize strategy and testing for disabling VTXO auto-renewal and delegated renewal, ensuring the SDK Settlement Manager respects these toggles safely.
- [ ] Milestone 21: VTXO List Grouped by Contract ([docs/MILESTONE_21.agents.md](./docs/MILESTONE_21.agents.md))
  - Restructure the VTXO list around its owning contracts: collapsible sections per contract showing type, state, copyable script/address, with empty contracts still visible.
- [ ] Milestone 22: Multiple Wallets and Labels ([docs/MILESTONE_22.agents.md](./docs/MILESTONE_22.agents.md))
  - Move from a single-wallet store model to multiple wallets with labels and isolated state.
- [x] Milestone 23: Thumb-Reachable Wallet Actions ([docs/MILESTONE_23.agents.md](./docs/MILESTONE_23.agents.md))
  - Move Wallet home Send / Receive into a bottom action dock above the tab bar, preserving premium mobile ergonomics and avoiding content occlusion.
- [x] Milestone 24: Contract Manager ([docs/MILESTONE_24.agents.md](./docs/MILESTONE_24.agents.md))
  - Replace AddressesScreen with a proper Profile → Contracts section: filterable list of all wallet contracts and a detail view with biometric-gated params and inline label editing.
- [x] Milestone 25: Brand Identity ([docs/MILESTONE_25.agents.md](./docs/MILESTONE_25.agents.md))
  - Replace placeholder Expo scaffold assets with production-quality branded images: app icon, Android adaptive icon layers, monochrome notification icon, and splash screen logo.
- [ ] Milestone 26: Loading Feedback & Sync Visibility ([docs/MILESTONE_26.agents.md](./docs/MILESTONE_26.agents.md))
  - Surface in-flight refresh state on Wallet and Activity (driver: ~3s cold-start gap), then a motion-polish pass on send/receive, then expressive loaders for backup and support-bundle export.
- [ ] Milestone 27: Localization & Internationalization (i18n) ([docs/MILESTONE_27.agents.md](./docs/MILESTONE_27.agents.md))
  - Remove hardcoded English strings, introduce a robust localization framework (i18next + expo-localization), and ensure locale-aware number/date formatting throughout the app.
- [ ] Milestone 28: HD Wallet Address Rotation ([docs/MILESTONE_28.agents.md](./docs/MILESTONE_28.agents.md))
  - Enable privacy-preserving address rotation for mnemonic-based wallets via `walletMode: "hd"`, allowing users to toggle between static and rotating addresses.
- [ ] Milestone 29: SDK Server Compatibility & Signer Rotation ([docs/MILESTONE_29.agents.md](./docs/MILESTONE_29.agents.md))
  - Wire up `onServerInfoChanged` for mid-session server info refresh, catch `BUILD_VERSION_TOO_OLD` with an actionable update prompt, and surface deprecated-signer vtxo classification with a one-tap migration flow.

## Relevant Documentation

- Product and implementation spec: [SPECS.md](./SPECS.md)
- Architecture and conventions: [CLAUDE.md](./CLAUDE.md)
- Open items and follow-ups: [ISSUES.md](./ISSUES.md)
- Agent guidance (how to work in this repo): [AGENTS.md](./AGENTS.md) and [FOUNDATION.md](./FOUNDATION.md)
- Milestone docs (source of truth for each milestone’s scope): [docs/](./docs/)
