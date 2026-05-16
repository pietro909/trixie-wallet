# Milestone 18: Portable History Milestones

**Status:** Planned

## Goal
Build a self-custodial wallet that remains fast to restore and usable at scale by periodically sealing authenticated history milestones. These milestones serve as an encrypted, portable source of truth for wallet history, derivation progress, and event attribution, allowing for a "Fast Trust" restore path without exposing private spend keys.

## Context
Currently, Milestone 6 provides a full wallet backup (including the secret). As the wallet accumulates activity, re-deriving history from the network on a new device becomes a performance bottleneck. This milestone shifts the trust model: the seed remains the source of truth for *funds*, while an encrypted milestone bundle becomes a portable source of truth for *history*.

## This milestone should prove:
- A user can export a "History Milestone" that excludes the private secret (Mnemonic/PrivateKey).
- The wallet can distinguish between "Verified Restore" (re-sync from network) and "Trusted Restore" (authoritative history from milestone).
- Milestone generation correctly gates on resolved states (e.g., no pending Boltz swaps).
- Restore remains functional with a seed phrase alone (fallback path).

## Technical Analysis & Critical Areas

### 1. Payload Evolution (v3)
The backup format must transition from a "Full Identity Snapshot" to a "History Milestone." 
- **File**: `app/services/backup/serializer.ts`
- **Change**: Introduce `BackupPayloadV3`. This version explicitly omits the `secret` field and adds `historySnapshot` (compacted activities) and `syncWatermark` (SDK-specific sync indices).

### 2. History Compaction Logic
- **File**: `app/services/arkade/activity-history.ts`
- **Logic**: Leverage the existing `previousActivities` cache logic to "seal" terminal rows (Confirmed/Refunded). The compactor must ensure no "Pending" or "Info" rows are authoritative in the bundle.

### 3. Dual-Mode Restore
- **File**: `app/store/useAppStore.ts`
- **Action**: Update `importBackup` to support a "Merge" state. If a wallet identity is already established via seed, the milestone provides the historical context and balance snapshots to avoid a full scan.

### 4. Safety Gating
- **File**: `app/services/arkade/lightning.ts`
- **Constraint**: Milestone creation must be blocked if `isSwapNonTerminal()` is true. Checkpointing across a Boltz recovery boundary risks state divergence on the new device.

## Implementation Phasing

### Phase 1: Format & Compactor Foundations
- Define `BackupPayloadV3` and the version-gated parser.
- Implement `app/services/backup/compactor.ts` to extract terminal activity rows and timestamps.
- **Checkpoint**: Unit tests confirm v3 payloads can be parsed without a secret.

### Phase 2: Trusted Restore Path
- Implement the "Trusted Restore" logic in the store.
- Update `app/services/arkade/activity-history.ts` to prioritize imported milestone rows during the first post-restore refresh.
- **Checkpoint**: Manual verification that an empty wallet can be "hydrated" with history from a file.

### Phase 3: UX & Safety Gating
- Rework `ProfileBackup.tsx` to offer "Save History Milestone" as a privacy-sensitive, non-spendable export.
- Implement the "Mode Selection" UI in `RestoreWallet.tsx` (Verified vs. Trusted).
- **Checkpoint**: UI correctly blocks milestone creation during an active submarine swap.

## Product Rules
- **Privacy First**: The milestone reveals address attribution and behavior; it must warn users about storage choice (local vs. cloud).
- **No Spend Keys**: v3 Milestones must never contain the seed or private keys.
- **Resilience**: A corrupted or missing milestone must never block fund recovery via seed.

## Out of Scope
- Automatic milestone scheduling (deferred).
- Cloud transport (Milestone 19).
- Cross-wallet milestone merging (deferred).
