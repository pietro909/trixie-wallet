# Milestone 17: Activity Checkpoints

**Status:** Planned

## Goal
Keep large wallets fast to refresh by freezing a verified, local Activity prefix into an internal checkpoint. A checkpoint says: rows at or before the safe frontier are written in stone for this wallet/build; load them from local storage and derive only the live tail.

This milestone does **not** change the existing encrypted full-backup flow. Full reset and backup restore keep behaving exactly as they do today.

## Context
Milestone 13 already added the first useful cache layer:

- no-change off-chain send timestamps are cached in `arkade_tx_timestamps`;
- confirmed Arkade rows can be reused through `previousActivities`;
- pending/info rows are still recomputed.

That means an indexer-call-only checkpoint is not enough to justify this milestone. The useful version is a stronger local history boundary: frozen rows become an emission source, and the builder does not walk old wallet objects just to rediscover history that can no longer change.

The smaller `getActivityHistory` cleanup is tracked separately in [ISSUE_ACTIVITY_HISTORY_CLEANUP.md](./ISSUE_ACTIVITY_HISTORY_CLEANUP.md). That work can land before checkpoints and should benefit both today's full-history refresh path and this milestone's future live-tail path.

## This Milestone Should Prove
- The app can create a local **Activity checkpoint** for a settled historical prefix.
- Wallet refresh loads checkpointed Activity rows immediately and derives only the live tail.
- Checkpoint creation is blocked by any state whose future lifecycle can still rewrite historical attribution.
- Full backup, reset, and backup restore remain unchanged.
- A deleted/corrupted checkpoint only costs performance; it must not block fund recovery or normal history rebuild.

## Non-Goals
- No `BackupPayload` version bump.
- No history-only export/import artifact.
- No Trusted Restore / Verified Restore UX.
- No changes to `ProfileBackup.tsx` or `RestoreWallet.tsx` for checkpoint portability.
- No cloud transport.
- No broad `getActivityHistory` micro-optimization beyond what checkpoint/live-tail integration requires; see the cleanup issue above.

## Technical Analysis & Critical Areas

### 1. Local Checkpoint Storage
- **File**: add `app/services/arkade/activity-checkpoints.ts`.
- **Storage**: SQLite, scoped by `walletId`.
- **Rows**: store checkpoint metadata and sealed Activity rows as JSON.
- **Metadata** should include:
  - `walletId`
  - `network`
  - `builderVersion`
  - `createdAt`
  - `sealedThroughTimestamp`
  - `sealedActivityIds`

`builderVersion` is a hard invalidation knob. While the app is alpha, do not migrate checkpoint shapes; if the Activity builder semantics change, invalidate or wipe checkpoints.

### 2. Safe Frontier Calculation
A checkpoint is valid only for a contiguous historical prefix whose causal descendants are terminal. It is not simply all rows older than T.

Compute a proposed frontier from the earliest unresolved/live wallet object:

- non-terminal Boltz swaps block checkpoint creation;
- unsettled boarding deposits block checkpoint creation, because they can later become `Boarding settled`;
- live VTXOs at or before the proposed boundary block checkpointing beyond them, because auto-renewal can later spend them and create `VTXO renewed` even when the user has no new activity;
- recoverable/pending VTXO or swap recovery state blocks checkpointing until resolved;
- any SDK-exposed settlement/renewal in-flight state blocks checkpointing.

The checkpoint frontier should be no later than the earliest live/unresolved object timestamp minus one. If that leaves no meaningful historical prefix, do not offer checkpoint creation.

### 3. Terminal Row Compaction
- **File**: `app/services/arkade/activity-history.ts` plus the new checkpoint service.
- **Rule**: only checkpoint rows that are safe to reuse as authoritative local history.
- **Initial allowlist**:
  - Arkade rows with `status === "confirmed"` and matching the safe prefix;
  - terminal Lightning rows only when their swap status is final and no recovery action remains.
- **Hard exclusions**:
  - `pending`
  - `info`
  - refundable/action-required chain-swap rows
  - any row whose source object is at or after the frontier

Do not use the existing `previousActivities` cache as the checkpoint model directly. `previousActivities` is a reuse optimization keyed by rows the current SDK-derived history already emits; checkpoints must be a local emission source for the frozen prefix.

### 4. Refresh Integration
- **File**: `app/services/arkade/activity-history.ts` and/or `app/services/arkade/runtime.ts`.
- **Change**: load checkpointed rows first, then derive the live tail after the checkpoint frontier.
- The final Activity list is `checkpointRows + liveTailRows`, deduped by `activity.id` and sorted by timestamp.
- Pending rows must always come from the live derivation path.
- If checkpoint read fails, log the error and fall back to the current full rebuild path.
- Keep any builder-internal cleanup from [ISSUE_ACTIVITY_HISTORY_CLEANUP.md](./ISSUE_ACTIVITY_HISTORY_CLEANUP.md) reusable by the live-tail path instead of coupling it to checkpoint storage.

The milestone is only worthwhile if old SDK/indexer work is actually skipped. Merely avoiding timestamp indexer calls duplicates Milestone 13 and should not be considered complete.

### 5. UX Prompting
- **File**: likely `ProfileBackup.tsx` is the wrong home because checkpoints are not backups. Prefer a lightweight prompt from Activity/Profile maintenance surfaces.
- Trigger only when useful, for example:
  - Activity count above a threshold;
  - refresh duration above a threshold;
  - many no-change off-chain sends;
  - a large settled prefix exists before the safe frontier.
- Copy should call this an **Activity checkpoint**, not a backup, restore, milestone file, or portable export.

Example posture: "Your Activity history is large enough to checkpoint. This keeps older settled history local and makes refreshes faster. Full backups are unchanged."

## Implementation Phasing

### Phase 1: Checkpoint Model & Safety Frontier
- Implement `activity-checkpoints.ts` with read/write/delete helpers.
- Add pure frontier helpers and tests for:
  - no live state -> checkpoint allowed;
  - non-terminal swap -> blocked;
  - unsettled boarding -> blocked;
  - live VTXO before/at boundary -> frontier moves earlier or blocks;
  - recoverable/action-required state -> blocked.
- **Checkpoint**: tests prove no pending/info/action-required rows are written.

### Phase 2: Compaction
- Add compaction logic that writes terminal Activity rows up to the safe frontier.
- Persist checkpoint metadata including `builderVersion` and sealed ids.
- Add invalidation/wipe behavior for builder-version mismatch and wallet reset.
- **Checkpoint**: unit tests round-trip checkpoint rows and verify corrupted/mismatched checkpoints fall back cleanly.

### Phase 3: Refresh Path
- Update refresh/history building so checkpoint rows are emitted locally and only the live tail is derived.
- Deduplicate checkpoint/live rows by `activity.id`.
- Keep `previousActivities` for the live tail where it still helps.
- **Checkpoint**: tests prove historical rows are loaded without invoking old timestamp/indexer work and pending rows still transition through live derivation.

### Phase 4: Product Surface
- Add a gated user action or prompt for creating an Activity checkpoint.
- Surface blocked reasons when creation is unsafe: pending swap, unsettled boarding, live VTXO frontier, recovery action required.
- **Checkpoint**: manual verification on a wallet with a large settled prefix shows faster refresh and unchanged full-backup/reset behavior.

## Product Rules
- **Local Only**: checkpoints are internal app performance state, not a backup or restore artifact.
- **No Spend Keys**: checkpoints never contain mnemonic, private key, preimages, or other spend/claim secrets.
- **Conservative Frontier**: if safety is uncertain, do not checkpoint.
- **Recoverable Fallback**: checkpoint failure must fall back to current full history rebuild.
- **Alpha Simplicity**: no checkpoint migrations; invalidate on builder/checkpoint shape changes.

## Out of Scope
- Exporting Activity checkpoints.
- Cloud transport.
- Trusted Restore / Fast Trust restore.
- Cross-wallet checkpoint merging.
- Automatic background checkpoint scheduling.
