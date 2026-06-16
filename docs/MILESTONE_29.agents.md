# Milestone 29: SDK Server Compatibility & Signer Rotation

**Status:** Revised draft (2026-06-16).

## Goal

Surface the SDK's server-compatibility signals in Trixie Wallet: mid-session
server-info refresh via digest negotiation, actionable "update required" UX
when arkd rejects an old client build, and signer-rotation status/migration
when the server deprecates a signer key.

This milestone should prove:

- The wallet store keeps its persisted `serverInfo` aligned with SDK
  `ArkInfo`, including `deprecatedSigners`.
- Digest mismatches refresh signer-dependent state and retry compatible SDK
  calls once, instead of surfacing as generic failures or false successes.
- Users can see when funds are under a deprecated signer, understand the
  deadline/recovery state, and start the SDK-supported migration path with one
  action.
- Server-required app updates interrupt generic error handling with a clear,
  global, non-dismissable update prompt.

## Context

The installed `@arkade-os/sdk` is `0.4.35`, which adds several compatibility
features the app currently does not expose at the product layer.

1. **Digest negotiation (`X-Digest` / `onServerInfoChanged`).**
   `RestArkProvider`/`ExpoArkProvider` cache the latest server-info digest from
   `getInfo()`, send it as `X-Digest` on arkd requests, refresh `ArkInfo` when
   arkd returns `DIGEST_MISMATCH`, fire `onServerInfoChanged(info)`, then throw
   `DigestMismatchError`. The SDK wallet subscribes internally and can rotate
   its own receive state, but Trixie Wallet does not mirror that fresh
   `ArkInfo` into `store.network.serverInfo` or refresh user-facing
   signer-rotation status.

2. **Build-version gate (`X-Build-Version` / `BUILD_VERSION_TOO_OLD`).**
   The SDK sends `X-Build-Version: 0.9.9` on arkd requests. If the server
   requires a newer client, arkd returns structured error
   `BUILD_VERSION_TOO_OLD` (code `48`). Today this can degrade into a generic
   toast or stored network error.

3. **Signer rotation (`ArkInfo.deprecatedSigners`).**
   `ArkInfo` now includes `deprecatedSigners`, and the SDK exposes low-level
   signer classification helpers plus high-level wallet APIs:
   `wallet.getVtxoManager().getDeprecatedSignerStatus()` and
   `wallet.getVtxoManager().migrateDeprecatedSignerVtxos()`. The low-level
   `Wallet.rotateServerSigner(newServerPubKey, checkpointTapscript)` method is
   internal to the SDK migration flow and must not be called directly from UI
   code.

## Product Rules

- **Persist the full advertised signer set.** `ArkadeServerInfo` must carry
  `deprecatedSigners`, with each `cutoffDate` serialized as a decimal string so
  `JSON.stringify`/`AsyncStorage` round-trips stay safe.
- **Derive wallet exposure through the SDK manager.** User-facing signer status
  must come from `getDeprecatedSignerStatus()`, not from reading contract
  `params.serverPubKey` in screens or storing sensitive contract params in
  Zustand. This preserves the Contract Manager rule that sensitive params stay
  behind `AuthGate`.
- **Keep signer status transient.** Store aggregated signer-rotation status in
  `StoreState`, not persisted `AppState`. Clear it on lock/reset and refresh it
  on unlock, wallet refresh, server-info change, and migration completion.
- **Use the public migration API.** One-tap migration calls
  `getVtxoManager().migrateDeprecatedSignerVtxos()`. Do not call
  `Wallet.rotateServerSigner()` directly.
- **Treat statuses differently.**
  - `MIGRATABLE`: soft advisory with cutoff date and a migrate action.
  - `DUE_NOW`: prominent, non-dismissable action-required banner with a migrate
    action.
  - `EXPIRED`: prominent recovery/wait guidance. Do not present migration as
    possible for expired-only funds; the SDK reports expired inputs and the
    recovery lifecycle separately.
  - `UNKNOWN_SIGNER`: diagnostic advisory only; no migration action.
- **Digest mismatch refreshes and retries.** On `DigestMismatchError`, update
  persisted `serverInfo`, refresh signer status, rebuild the failed operation,
  and retry once when the operation is safe to rebuild. Do not simply swallow
  the error; send/offboard flows must never return success without a tx id.
- **Update-required is global.** `BUILD_VERSION_TOO_OLD` sets a transient
  `_updateRequired` flag rendered by an app-level non-dismissable modal, not
  only by `WalletScreen`.
- **No broken store links.** If real App Store / Play Store URLs are unavailable
  in this milestone, omit the link button and show explicit update instructions.
  Do not hardcode `#`.
- **No schema migration.** Bump `schemaVersion` `7 -> 8` so alpha installs hit
  the wipe-and-re-onboard modal. Do not write a migration path.

## Implementation Plan

### 1. Types (`app/store/types.ts`)

- Add:
  ```ts
  export type PersistedDeprecatedSigner = {
    pubkey: string;
    cutoffDateSeconds: string;
  };
  ```
- Extend `ArkadeServerInfo`:
  ```ts
  deprecatedSigners: PersistedDeprecatedSigner[];
  ```
- Add transient signer-status types beside the existing transient types:
  ```ts
  export type SignerRotationSeverity =
    | "CURRENT"
    | "MIGRATABLE"
    | "DUE_NOW"
    | "EXPIRED"
    | "UNKNOWN_SIGNER";

  export type SignerRotationReport = {
    signerPubKey: string;
    status: SignerRotationSeverity;
    cutoffDateSeconds?: string;
    secondsUntilCutoff?: number;
    vtxoCount: number;
    totalValue: number;
    boardingCount: number;
    boardingValue: number;
    recoverableCount: number;
    recoverableValue: number;
    awaitingSweepCount: number;
    awaitingSweepValue: number;
    nextSweepEta?: number;
  };

  export type SignerRotationStatus = {
    worstStatus: SignerRotationSeverity;
    reports: SignerRotationReport[];
  };
  ```
- Add `signerRotationStatus: SignerRotationStatus | null` to `StoreState`, not
  `AppState`.
- Add `_updateRequired: boolean` and optionally `_signerMigrationInFlight:
  boolean` to `StoreState`, not `AppState`.
- Bump `AppState["schemaVersion"]`, `CURRENT_SCHEMA_VERSION`, and
  `DEFAULT_STATE.schemaVersion` from `7` to `8`.

### 2. Server Info Conversion (`app/services/arkade/runtime.ts`)

- Replace the local `fetchServerInfo` mapping with a single exported converter:
  ```ts
  export function arkInfoToServerInfo(info: ArkInfo): ArkadeServerInfo {
    return {
      network: info.network,
      version: info.version,
      signerPubkey: info.signerPubkey,
      forfeitAddress: info.forfeitAddress,
      dustSats: Number(info.dust),
      unilateralExitDelaySeconds: Number(info.unilateralExitDelay),
      txFeeRate: info.fees.txFeeRate,
      intentFee: {
        offchainInput: info.fees.intentFee.offchainInput,
        onchainInput: info.fees.intentFee.onchainInput,
        offchainOutput: info.fees.intentFee.offchainOutput,
        onchainOutput: info.fees.intentFee.onchainOutput,
      },
      deprecatedSigners: info.deprecatedSigners.map((s) => ({
        pubkey: s.pubkey,
        cutoffDateSeconds: s.cutoffDate.toString(),
      })),
    };
  }
  ```
- Use the converter in `fetchServerInfo`, `probeServer`, create/restore setup,
  and any raw server-info sync path.
- Keep `fetchRawServerInfo()` as a raw diagnostic helper; it can continue using
  `jsonifyDeep()`.

### 3. Runtime Listener Without Store Imports

- Create a runtime-level listener bridge:
  ```ts
  type ServerInfoChangedListener = (info: ArkadeServerInfo) => void | Promise<void>;

  export function setServerInfoChangedListener(
    listener: ServerInfoChangedListener | null,
  ): void;
  ```
- In `buildWallet`, construct the provider once:
  ```ts
  const arkProvider = new ExpoArkProvider(arkServerUrl);
  ```
  pass that instance to `Wallet.create`, and subscribe to
  `arkProvider.onServerInfoChanged`.
- The runtime listener should call `arkInfoToServerInfo(info)` and then the
  registered app listener. Catch and record listener errors; never throw back
  into the provider emit loop.
- Track the unsubscribe handle in runtime module state and dispose it from
  `disposeWallet()`. Lock does not dispose the wallet in this app, so lock should
  clear store-visible signer status but leave the runtime listener alone.
- Do not import `useAppStore` from `runtime.ts`; the store already imports
  runtime and should install the listener after store creation, mirroring the
  existing `setIncomingFundsListener` pattern.

### 4. Error Helpers (`app/services/arkade/errors.ts`)

- Import `DigestMismatchError` and `maybeArkError` from `@arkade-os/sdk` (the
  installed package exports both from its root).
- Add recursive guards that inspect wrapped `ArkadeError.cause` values:
  ```ts
  export function isDigestMismatchError(e: unknown): boolean;
  export function isBuildVersionTooOldError(e: unknown): boolean;
  ```
- `isBuildVersionTooOldError` should accept either
  `maybeArkError(e)?.name === "BUILD_VERSION_TOO_OLD"` or code `48`, and should
  also inspect causes.
- Add a small compatibility handler used by store actions before wrapping errors
  into generic `ArkadeError`s:
  ```ts
  export type CompatibilityAction =
    | { kind: "digest_mismatch" }
    | { kind: "update_required" }
    | null;
  ```
  Exact shape is flexible; the key requirement is that update-required and
  digest-mismatch handling happen before generic toasts/messages are produced.

### 5. Store Actions (`app/store/useAppStore.ts`)

- Add actions:
  ```ts
  updateServerInfo(info: ArkadeServerInfo): Promise<void>;
  setUpdateRequired(required: boolean): void;
  refreshSignerRotationStatus(): Promise<void>;
  migrateDeprecatedSigners(): Promise<DeprecatedSignerMigrationReport>;
  ```
- `updateServerInfo`:
  - Merge into `state.network.serverInfo`.
  - Update `detectedNetwork`, `status: "online"`, and clear `lastError`.
  - Persist, because `serverInfo` is part of `AppState`.
- `refreshSignerRotationStatus`:
  - Return early when no wallet or locked.
  - Use `ensureWallet({ metadata, behavior })`.
  - Call `const manager = await wallet.getVtxoManager()`.
  - Call `manager.getDeprecatedSignerStatus()`.
  - Convert bigint cutoff fields to strings and aggregate `worstStatus` using
    severity order:
    `DUE_NOW > EXPIRED > MIGRATABLE > UNKNOWN_SIGNER > CURRENT`.
    `DUE_NOW` outranks `EXPIRED` because it is still actionable.
  - Store `null` when every report is `CURRENT` or the SDK returns no reports.
  - Record failures but do not fail ordinary `refreshWallet`; signer status is
    advisory unless the user explicitly tapped migration.
- `migrateDeprecatedSigners`:
  - Guard no wallet / locked like other runtime-backed actions.
  - Set `_signerMigrationInFlight` if added.
  - Call `manager.migrateDeprecatedSignerVtxos()`.
  - Await `refreshWallet()` and `refreshSignerRotationStatus()` after the report.
  - Return the report so the UI can summarize migrated/skipped/expired inputs.
  - Clear the in-flight flag in `finally`.
- Wire `refreshSignerRotationStatus()` after successful wallet refresh, create,
  restore, unlock, and server-info change. It should not create a recursive
  refresh loop.
- Clear `signerRotationStatus` on lock, reset, schema wipe, and wallet switch
  boundaries. Keep `_updateRequired` until app restart or an explicit
  `setUpdateRequired(false)` in tests/dev flows.
- Install the runtime listener after `useAppStore` is created:
  ```ts
  setServerInfoChangedListener((info) => {
    const store = useAppStore.getState();
    void store.updateServerInfo(info)
      .then(() => store.refreshSignerRotationStatus())
      .catch((e) => recordError(...));
  });
  ```

### 6. Digest Retry Call Sites

- Add a small retry helper near the store/runtime boundary:
  ```ts
  async function withDigestRetry<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (e) {
      if (!isDigestMismatchError(e)) throw e;
      await useAppStore.getState().refreshSignerRotationStatus().catch(...);
      return run();
    }
  }
  ```
  The implementation may live in the store or a service helper; avoid a runtime
  -> store import cycle.
- Use it around SDK calls whose request can be rebuilt safely after a fresh
  `ArkInfo`, especially:
  - `refreshWalletSnapshot`
  - `wallet.send`
  - `Ramps(wallet).offboard`
  - asset issue/reissue/burn/send calls
  - VTXO manager migration
- Do not use it to hide repeated digest failures. Retry once, then surface the
  real error.
- When `isBuildVersionTooOldError(e)` is detected in these same paths, set
  `_updateRequired: true` and suppress generic toast/error copy where possible.
  If the calling action must reject, reject with a stable `ArkadeError` message
  that tells the screen not to show a second generic error.

### 7. UI: Signer Rotation Banner (`app/screens/WalletScreen.tsx`)

- Render a `SignerRotationBanner` directly below the balance card and above
  Recent Activity so critical signer state is visible immediately on Wallet
  open.
- Subscribe to `signerRotationStatus`, `_signerMigrationInFlight` (if added),
  and `migrateDeprecatedSigners`.
- Copy rules:
  - `MIGRATABLE`: "Server key rotation pending. Migrate before {date}."
  - `DUE_NOW`: "Action required. Migrate wallet funds to the updated server
    key."
  - `EXPIRED`: "Signer cutoff passed. Some funds are waiting for sweep/recovery."
  - `UNKNOWN_SIGNER`: "Some funds use an unknown server key. Export a support
    bundle if this persists."
- Show the migrate action only when any report has status `MIGRATABLE` or
  `DUE_NOW`.
- Use a button-level or inline busy state while migration runs. A blocking
  overlay is acceptable only while an active settlement/migration request is in
  flight and must use honest copy such as "Migrating funds...".
- After migration:
  - success with migrated inputs: show a success toast and let the refreshed
    status remove or downgrade the banner.
  - skipped/expired-only report: show an explanatory toast/message, not success.
  - error: show the error, keep the banner.
- Make the banner accessible with `accessibilityRole="alert"` for `DUE_NOW` and
  `EXPIRED`; use a polite live region for `MIGRATABLE`.

### 8. UI: Update Required Modal

- Add an app-level `UpdateRequiredModal` mounted near the root navigation tree
  so it can appear during onboarding, wallet refresh, send, receive, or Profile
  flows.
- Subscribe to `_updateRequired`.
- Render a non-dismissable modal:
  "A server update requires a newer version of Trixie Wallet. Update the app to
  continue."
- If valid store URLs are available, show one primary "Update" action using
  `Linking.openURL`.
- If valid store URLs are not available in this milestone, show no broken
  external action; show concise instructions to update from the installed app
  source.

## Verification

### Automated

- **Server-info conversion:** `arkInfoToServerInfo` maps `dust`,
  `unilateralExitDelay`, `fees`, and serializes every
  `deprecatedSigners[].cutoffDate` as a decimal string.
- **Error guards:** `isDigestMismatchError` and
  `isBuildVersionTooOldError` detect direct SDK errors and errors wrapped in
  `ArkadeError.cause`.
- **Signer aggregation:** mixed SDK reports aggregate to the expected
  `worstStatus`, especially `DUE_NOW` outranking `EXPIRED`, and all-current/no
  reports produce `null`.
- **Migration action:** mocked `getVtxoManager().migrateDeprecatedSignerVtxos()`
  is called, followed by wallet refresh and signer-status refresh. Expired-only
  reports do not produce a false "migrated" success state.
- **Transient persistence:** `_updateRequired`, `_signerMigrationInFlight`, and
  `signerRotationStatus` are excluded from `persist()`.
- **Schema wipe:** persisted schema `7` hits the mismatch modal under
  `CURRENT_SCHEMA_VERSION = 8`.

### Manual / Integration

- **Digest resync:** Use a mocked provider or local arkd setup to trigger
  `DIGEST_MISMATCH`. Verify `store.network.serverInfo.signerPubkey` updates,
  signer status refreshes, and the original operation retries once without a
  generic toast.
- **Update-required modal:** Mock arkd error code `48` /
  `BUILD_VERSION_TOO_OLD`; verify the global non-dismissable modal appears and
  the original screen does not also show a generic error toast.
- **Signer status - current:** Fresh wallet with no deprecated signer reports;
  no banner appears.
- **Signer status - migratable:** Wallet with deprecated signer and future
  cutoff; advisory banner appears with a formatted cutoff and migrate action.
- **Signer status - due now:** Deprecated signer with cutoff `0`; action-required
  banner appears and cannot be dismissed.
- **Signer status - expired:** Cutoff in the past; recovery/wait banner appears.
  If no migratable/due-now reports exist, no migration action is shown.
- **Migration:** Tap migrate on a `DUE_NOW`/`MIGRATABLE` banner. Verify SDK
  migration runs, refreshed status removes/downgrades the banner, and skipped or
  expired inputs are explained.
- **Round-trip:** Create or restore against a server with deprecated signers;
  lock, restart, unlock; verify persisted `serverInfo.deprecatedSigners` survives
  with string cutoff values and transient signer status refreshes after unlock.

## Out of Scope

- Per-vtxo signer status in Contract Manager or VTXO detail screens.
- Recovery UX for `UNKNOWN_SIGNER` beyond diagnostics/support-bundle guidance.
- Full app-store listing metadata or release-channel management.
- Changing the SDK's hardcoded `X-Build-Version` value.
- Localizing the new copy through a full i18n pass; this milestone may use the
  app's current hardcoded-string pattern until Milestone 27 lands.
