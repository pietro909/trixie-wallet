# Milestone 28: HD Wallet Address Rotation & Recovery

**Status:** Planned (Corrected 2026-06-09: Split Create vs. Restore paths, added SDK recovery scan, and UI scan-state feedback).

## Goal

Enable privacy-preserving address rotation for HD wallets (mnemonics) by allowing users to choose between "Static" and "HD" mode during wallet creation or restoration. Ensure that restoration and backup imports for HD wallets correctly recover historical activity and rotated indices using the SDK's recovery scan.

## Context

The `@arkade-os/sdk` supports a `walletMode` parameter. For HD wallets, initializing with `walletMode: "hd"` enables address rotation. However, for existing wallets, merely initializing is not enough; the app must call `wallet.restore({ gapLimit })` to scan for used indices, VTXOs, and rotated contracts.

Currently, the app treats creation and restoration as symmetric, which misses the mandatory scan for recovered identities. This milestone corrects the flow to ensure data integrity during restoration and provides honest UI feedback while the scan is running.

## Product Rules

- **Mnemonic-only.** Address rotation and recovery scans are only available for `mnemonic` identities.
- **Setup-time Only.** The choice between Static/HD is made during Create/Restore and is immutable once persisted.
- **Default: Static.** The default choice matches current behavior (no rotation).
- **Recovery Scan (HD only).** When restoring a mnemonic in "HD" mode, a mandatory blockchain scan is performed with a `gapLimit: 20`.
- **UI Scan Transparency.** During the scan, the user must see that blockchain recovery is actively running. The installed SDK only exposes start/end state for `wallet.restore({ gapLimit })`, not per-index callbacks, and `gapLimit: 20` is a consecutive-unused window rather than a fixed total. Do not display fake index progress.
- **Persistence.** The chosen `walletMode` is stored in `ArkadeWalletMetadata` and carried in the encrypted backup.
- **Invalid Backup Data Hard-Stops.** Backup payloads are an external boundary, not trusted UI state. Invalid V4 `walletMode` combinations must fail parsing/import before any restore side effects are created.

## Implementation Plan

### 1. Store Types & Schema

In [`app/store/types.ts`](../app/store/types.ts):
- Add `walletMode: "static" | "hd"` (required) to `ArkadeWalletMetadata`.
- Add transient `restoreProgress: { status: "idle" } | { status: "restoring"; walletMode: "static" | "hd"; stage: "initializing" | "scanning" | "syncing"; startedAt: number }` to the Zustand `StoreState` beside `_syncState`, not to persisted `AppState`.
- Bump the `schemaVersion` literal `6 → 7`.

### 2. Runtime Integration (Split Flow)

In [`app/services/arkade/runtime.ts`](../app/services/arkade/runtime.ts):
- **Refactor `buildWallet`**: Update to accept `walletMode: "static" | "hd"` and forward it to `Wallet.create({ ..., walletMode })`.
- **Implement `restoreWalletInstance`**:
  ```ts
  export type RestoreStage = "initializing" | "scanning" | "syncing";

  export type RestoreWalletInput = CreateWalletInput & {
    gapLimit?: number;
    walletMode: "static" | "hd";
    onStage?: (stage: RestoreStage) => void;
  };

  export async function restoreWalletInstance(
    input: RestoreWalletInput,
  ): Promise<{ wallet: Wallet; snapshot: WalletSnapshot }> {
    input.onStage?.("initializing");
    const wallet = await buildWallet(..., input.walletMode);

    if (input.walletMode === "hd" && input.artifacts.identityKind === "mnemonic") {
      input.onStage?.("scanning");
      await wallet.restore({ gapLimit: input.gapLimit ?? 20 });
    }

    activeWalletId = input.walletId;
    activeBehaviorKey = behaviorKey(input.behavior);
    activeWalletMode = input.walletMode;
    activeWalletInstance = wallet;
    activeWalletPromise = Promise.resolve(wallet);
    await attachIncomingFundsSubscription(wallet);

    input.onStage?.("syncing");
    const snapshot = await snapshotWallet(wallet, input.arkServerUrl, {
      network: input.network,
    });
    return { wallet, snapshot };
  }
  ```
- **Update `ensureWallet` & `createWalletInstance`**: Ensure they read/pass `walletMode` correctly.
- **Update the runtime cache key**: Include `walletMode` in the active wallet cache guard/key alongside `walletId` and `walletBehavior`, so a static runtime instance cannot satisfy an HD metadata request. `restoreWalletInstance` must set the same active cache fields as `createWalletInstance` (`activeWalletId`, behavior key, mode key, instance, and promise).

### 3. Store Actions

In [`app/store/useAppStore.ts`](../app/store/useAppStore.ts):
- **Update `restoreWallet`**:
  - Accept `walletMode` as an argument.
  - Set `restoreProgress` status to `"restoring"` with `stage: "initializing"` before calling `restoreWalletInstance`.
  - Pass an `onStage` callback that updates `restoreProgress.stage` for the real app-controlled phases: initialization, SDK scan, and post-scan snapshot sync.
  - Reset `restoreProgress` in a `finally` block.
- **Update `importBackup`**:
  - Use `restoreWalletInstance` instead of `createWalletInstance`.
  - Read `walletMode` from the V4 backup payload.
  - **Re-apply Labels**: Ensure the contract labeling loop runs *after* `restoreWalletInstance` returns, so it can target discovered contracts. Await the loop before returning from import; keep per-label failures best-effort and logged so an otherwise successful restore is not rolled back.

### 4. Backup Envelope

In [`app/services/backup/serializer.ts`](../app/services/backup/serializer.ts):
- Bump `PAYLOAD_VERSION` `3 → 4`.
- Define `BackupPayloadV4` with a required `walletMode` field.
- `parseWallet`: Default V1-V3 payloads to `"static"`; strictly validate V4 payloads.
- Reject V4 payloads with `walletMode: "hd"` unless both `wallet.identityKind` and `secret.kind` are `"mnemonic"`.
- Treat invalid V4 backup data as a hard stop: `parseBackupPayload` throws `PayloadParseError`, and `importBackup` must not save secrets, restore swap metadata, create a wallet runtime, or commit Zustand state after that failure.

### 5. UI Implementation

- **[`RestoreWallet.tsx`](../app/screens/RestoreWallet.tsx)** & **[`RestoreBackupPasswordScreen.tsx`](../app/screens/RestoreBackupPasswordScreen.tsx)**:
  - Subscribe to `restoreProgress` from the store.
  - Pass a dynamic message to `LoadingOverlay` based on `restoreProgress.stage`:
    - Static or pre-scan: `"Restoring wallet..."`
    - HD scan active: `"Scanning blockchain for rotated addresses. This can take a minute..."`
    - Post-scan snapshot: `"Syncing recovered balance..."`
- **Mode Selection**:
  - Add an "Address Rotation" checkbox to **[`LandingNoWallet.tsx`](../app/screens/LandingNoWallet.tsx)** and **[`RestoreWallet.tsx`](../app/screens/RestoreWallet.tsx)** for mnemonic flows.

### 6. Verification

- **HD Restore Scan**: Restore a seed with known activity on index > 0. Verify balance/activity recovery.
- **Backup Label Discovery**: Import a backup for an HD wallet. Verify labels are applied to contracts discovered during the scan.
- **Invalid Backup Hard Stop**: Import a V4 backup with `walletMode: "hd"` and a `singleKey` identity/secret. Verify parsing/import fails and no secret, swap metadata, runtime, or Zustand wallet state is written.
- **UI Scan Status**: Manually confirm the loading overlay switches through initializing, HD scan, and syncing messages at the real app-controlled phase boundaries, and clears when restore completes or fails.
- **Schema Wipe**: Verify existing installs hit the wipe-and-re-onboard modal.
