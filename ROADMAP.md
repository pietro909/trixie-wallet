# Roadmap

This repository is an Expo-only, iOS/Android self-custodial Arkade wallet app. The initial build (wallet create/restore, lock/unlock with password + biometrics, theming, navigation, and baseline screens) was delivered on 2026-04-27; ongoing work is tracked as milestones below.

This is a living document: tick items off as they land.

Last updated: 2026-05-04

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
  - Implementation complete. OS background scheduling is deactivated pending [arkade-os/boltz-swap#136](https://github.com/arkade-os/boltz-swap/issues/136); re-enable by restoring the `ensureSwapBackgroundRegistered()` call removed in b0c830a.
- [x] Milestone 9: Disaster Recovery Tooling ([docs/MILESTONE_9.agents.md](./docs/MILESTONE_9.agents.md))
  - Add explicit recovery tools for claimable/refundable swaps and other dangling recoverable state.
  - Implementation complete, pending manual verification — see "Manual testing status" in [README.md](./README.md).
- [ ] Milestone 10: Activity Caching ([docs/MILESTONE_10.agents.md](./docs/MILESTONE_10.agents.md))
  - Introduce an append-friendly cache for derived Activity rows with boring, explicit invalidation.
- [ ] Milestone 11: LNURL ([docs/MILESTONE_11.agents.md](./docs/MILESTONE_11.agents.md))
  - Add LNURL and Lightning Address parsing + invoice fetching, distinct from BOLT11 handling.
- [ ] Milestone 12: Multiple Wallets and Labels ([docs/MILESTONE_12.agents.md](./docs/MILESTONE_12.agents.md))
  - Move from a single-wallet store model to multiple wallets with labels and isolated state.
- [ ] Milestone 13: Cloud Backup ([docs/MILESTONE_13.agents.md](./docs/MILESTONE_13.agents.md))
  - Add optional cloud transport for the encrypted backup bundle (transport only; format remains local-first).

## Relevant Documentation

- Product and implementation spec: [SPECS.md](./SPECS.md)
- Architecture and conventions: [CLAUDE.md](./CLAUDE.md)
- Open items and follow-ups: [ISSUES.md](./ISSUES.md)
- Agent guidance (how to work in this repo): [AGENTS.md](./AGENTS.md) and [FOUNDATION.md](./FOUNDATION.md)
- Milestone docs (source of truth for each milestone’s scope): [docs/](./docs/)
