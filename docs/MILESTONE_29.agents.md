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
- **Do not collapse migration reports.** `DeprecatedSignerMigrationReport` has
  independent `vtxos` and `boarding` legs plus top-level `rotated`,
  `skipped?`, `expired[]`, and `signers[]`. Interpret per-leg `txid`,
  `migrated`, `skipped`, `deferred`, `oversized`, and `error` fields explicitly
  instead of reducing the report to one success/skip/error state. Partial
  success, retryable leftovers, oversized funds, expired-only funds, and hard
  errors must remain distinguishable.
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
    canMigrate: boolean;
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
    hasMigratableFunds: boolean;
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

  export function waitForServerInfoChangedListener(): Promise<void>;
  ```
- In `buildWallet`, construct the provider once:
  ```ts
  const arkProvider = new ExpoArkProvider(arkServerUrl);
  ```
  pass that same instance to `Wallet.create`, and expose it to the active-wallet
  caller. Do not subscribe inside `buildWallet`.
- Add `attachServerInfoSubscription(provider)` / `detachServerInfoSubscription()`
  in `runtime.ts`, mirroring `attachIncomingFundsSubscription`:
  - detach the prior server-info subscription before attaching a new one.
  - subscribe to `provider.onServerInfoChanged`.
  - call `arkInfoToServerInfo(info)` and then the registered app listener.
  - chain any listener promise in runtime module state and expose the current
    chain through `waitForServerInfoChangedListener()`. The SDK calls
    `onServerInfoChanged` listeners synchronously and does **not** await returned
    promises before throwing `DigestMismatchError`, so digest retry code needs an
    explicit app-side barrier before it re-runs an operation.
  - catch and record listener errors inside the chain; never throw back into the
    provider emit loop. The wait helper should resolve after the listener work is
    handled/logged, not reject and mask the original digest retry.
- Call `attachServerInfoSubscription(arkProvider)` alongside
  `attachIncomingFundsSubscription(wallet)` in every active-wallet creation path
  (`ensureWallet` rebuild, `createWalletInstance`, and
  `restoreWalletInstance`). Those paths do not all call `disposeWallet()` first,
  so attach must be detach-before-attach to prevent duplicate listeners.
- Track the unsubscribe handle in runtime module state and dispose it from both
  `disposeWallet()` and the next re-attach. Lock does not dispose the wallet in
  this app, so lock should clear store-visible signer status but leave the
  runtime listener alone.
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
  - Return early when no wallet or locked. The locked check must branch on
    `state.security.isLocked`, not wallet availability, because lock keeps the
    SDK wallet alive in memory.
  - Use `ensureWallet({ metadata, behavior })` only after the locked check.
  - Call `const manager = await wallet.getVtxoManager()`.
  - Call `manager.getDeprecatedSignerStatus()`.
  - Convert bigint cutoff fields to strings and aggregate `worstStatus` using
    the product severity order:
    `DUE_NOW > EXPIRED > MIGRATABLE > UNKNOWN_SIGNER > CURRENT`.
    This intentionally prioritizes actionability: `DUE_NOW` has a cooperative
    migration action, while `EXPIRED` is serious but recovery/wait guidance.
    If both are present, show the DUE_NOW action and mention expired funds in
    supporting copy.
  - Derive report-level `canMigrate` and aggregate `hasMigratableFunds` with
    the SDK's exported `isCooperativelyMigratable(status)` helper, not a
    hardcoded `MIGRATABLE || DUE_NOW` check.
  - Store `null` when every report is `CURRENT` or the SDK returns no reports.
  - Coalesce signer-status refreshes with an in-flight promise or short debounce
    (250ms is enough) so normal wallet refreshes and digest-mismatch listener
    callbacks do not thrash SDK work. The action must be idempotent and
    non-fatal.
  - Record failures but do not fail ordinary `refreshWallet`; signer status is
    advisory unless the user explicitly tapped migration.
- `migrateDeprecatedSigners`:
  - Guard no wallet / locked like other runtime-backed actions.
  - Set `_signerMigrationInFlight` if added.
  - Call `manager.migrateDeprecatedSignerVtxos()`.
  - Await `refreshWallet()` and `refreshSignerRotationStatus()` after the report.
  - Return the report so the UI can summarize migrated/skipped/expired inputs.
  - Clear the in-flight flag in `finally`.
- Add a pure `summarizeMigrationReport(report)` helper, exported from the store
  or an adjacent service, so UI copy does not inspect the SDK report shape
  directly. Use a flat summary struct, not a single-kind discriminated union, so
  one SDK report can preserve simultaneous conditions across both legs:
  ```ts
  type SignerMigrationSummary = {
    migratedCount: number;
    deferredCount: number;
    oversizedCount: number;
    expiredCount: number;
    txids: string[];
    legSkips: Array<{
      leg: "vtxos" | "boarding";
      reason: "below-dust" | "oversized-only";
    }>;
    globalSkip?: "no-deprecated-vtxos" | "unknown-wallet-signer";
    errors: Array<{ leg: "vtxos" | "boarding" | "top_level"; message: string }>;
    hasPartialProgress: boolean;
    hasRetryableRemainder: boolean;
    needsUnilateralExit: boolean;
    hasErrors: boolean;
  };
  ```
  The helper must inspect both `vtxos` and `boarding` legs, aggregate their
  counts, keep every leg `txid`, preserve each leg `skipped` reason, and
  preserve top-level `skipped` and `expired[]`. A leg `skipped` is a reason
  enum (`"below-dust" | "oversized-only"`), not an input count; do not invent a
  skipped count. A leg error is not a plain failure when the other leg migrated
  funds; keep both the error and migrated counts/txids so the UI can explain
  partial progress. `deferred` means caps left funds behind and the user may
  need to run migration again. `oversized` means funds cannot migrate
  cooperatively and need unilateral exit/recovery guidance, not a generic
  skipped message. `expired[]` with no movable inputs maps to wait/recovery
  guidance, not success. Top-level `skipped: "unknown-wallet-signer"` is a
  refusal to rotate and needs distinct copy; `"no-deprecated-vtxos"` is a
  no-op/no-action outcome.
- Wire `refreshSignerRotationStatus()` after successful wallet refresh, create,
  restore, unlock, and server-info change. It should not create a recursive
  refresh loop. Because `getDeprecatedSignerStatus()` may do SDK/network work,
  route these triggers through the coalesced refresh helper rather than starting
  independent concurrent calls.
- Clear `signerRotationStatus` on lock, reset, schema wipe, and wallet switch
  boundaries. Keep `_updateRequired` until app restart or an explicit
  `setUpdateRequired(false)` in tests/dev flows.
- Install the runtime listener after `useAppStore` is created:
  ```ts
  setServerInfoChangedListener((info) => {
    const store = useAppStore.getState();
    return store.updateServerInfo(info)
      .then(() => store.refreshSignerRotationStatus())
      .catch((e) => recordError(...));
  });
  ```
  The listener must return the promise chain. Do not prefix it with `void`; the
  runtime wait helper depends on this promise to know when persisted `serverInfo`
  and transient signer status have caught up with the SDK event.

### 6. Digest Retry Call Sites

- Add a store-local retry helper near the store/runtime boundary. It must accept
  an attempt-aware callback/factory, not a pre-built promise, so every retry can
  re-read Zustand state, re-acquire the public SDK wallet/manager, and rebuild
  SDK request inputs after fresh `ArkInfo` is applied:
  ```ts
  async function withDigestRetry<T>(
    run: (attempt: "initial" | "retry") => Promise<T>,
  ): Promise<T> {
    try {
      return await run("initial");
    } catch (e) {
      if (!isDigestMismatchError(e)) throw e;
      await waitForServerInfoChangedListener();
      await rebuildActiveWalletAfterDigestMismatch();
      await useAppStore.getState().refreshSignerRotationStatus().catch(...);
      return run("retry");
    }
  }
  ```
  The implementation may live in the store or a service helper; avoid a runtime
  -> store import cycle.
- Add `rebuildActiveWalletAfterDigestMismatch()` as a store-local helper for
  wallet-backed retry paths:
  - Snapshot `wallet`, `walletBehavior`, and `security.isLocked` before awaiting.
  - If there is no wallet or the app is locked, do nothing.
  - Dispose Lightning before disposing the SDK wallet, because the Lightning
    instance owns a wallet reference.
  - Call `disposeWallet()`, then `ensureWallet({ metadata, behavior })` if the
    same wallet is still current and unlocked.
  - Re-create Lightning lazily through existing `maybeEnsureLightning` /
    `refreshWallet` paths after the retry. Do not reach into SDK-private fields
    such as `_serverInfoInFlight`; force-rebuilding uses only public runtime
    APIs and avoids racing the SDK's own async server-info listener.
- Retry callbacks must not close over stale server-dependent values. On the
  second attempt, rebuild inside the callback:
  - read `get().network.serverInfo` fresh before `Ramps(wallet).offboard`;
  - call `ensureWallet({ metadata, behavior })` again and construct a new
    `Ramps(wallet)`;
  - call `wallet.getVtxoManager()` again before signer migration;
  - call `wallet.assetManager.*` from the reacquired wallet;
  - recompute fee previews or validations that depended on the old
    `serverInfo`.
- Use it around SDK calls whose request can be rebuilt safely after a fresh
  `ArkInfo`, especially:
  - `refreshWalletSnapshot`
  - `wallet.send`
  - `Ramps(wallet).offboard`
  - asset issue/reissue/burn/send calls
  - VTXO manager migration
- Do not use it to hide repeated digest failures. Retry once, then surface the
  real error.
- Expect one `DigestMismatchError` to trigger both the provider listener
  (`updateServerInfo` + coalesced `refreshSignerRotationStatus`) and the
  retry helper catch path. The retry helper must await
  `waitForServerInfoChangedListener()` before rebuilding so it does not race
  the async store listener. This is acceptable only if signer-status refresh is
  coalesced/idempotent. `updateServerInfo` should be the only path that writes
  refreshed `serverInfo` to persistence for that mismatch; the retry helper
  should not perform a second server-info persist write.
- When `isBuildVersionTooOldError(e)` is detected in these same paths, set
  `_updateRequired: true` and suppress generic toast/error copy where possible.
  If the calling action must reject, reject with a stable `ArkadeError` message
  that tells the screen not to show a second generic error.
- Run the same build-version compatibility handling around onboarding and setup
  paths before generic network/server errors are shown:
  - `probeServer` / `fetchServerInfo` / `provider.getInfo()`
  - create-wallet setup
  - restore-wallet setup
  If arkd gates `getInfo()` with `BUILD_VERSION_TOO_OLD`, onboarding should set
  `_updateRequired: true` and show the global modal instead of only surfacing
  "server unreachable". Keep the runtime -> store boundary clean by preserving
  causes in `toArkadeError` and performing store mutations in store actions.

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
- Show the migrate action when `signerRotationStatus.hasMigratableFunds` is
  true, derived via the SDK `isCooperativelyMigratable(status)` helper.
- Use a button-level or inline busy state while migration runs. A blocking
  overlay is acceptable only while an active settlement/migration request is in
  flight and must use honest copy such as "Migrating funds...".
- After migration, call `summarizeMigrationReport(report)` and key the UI
  message off the flat summary after refreshing wallet/signer status. The
  summary preserves co-occurring conditions; when a single toast headline is
  needed, choose the most important visible condition in this order:
  `hasErrors` > `needsUnilateralExit` > `hasRetryableRemainder` >
  `expiredCount > 0` > `migratedCount > 0` >
  `globalSkip === "unknown-wallet-signer"` > `globalSkip`/`legSkips`.
  - `hasErrors`: show the error and include partial-progress copy when
    `migratedCount > 0`; keep the banner.
  - `needsUnilateralExit`: explain that some funds exceed cooperative
    migration limits and need unilateral exit/recovery guidance; do not show
    plain success.
  - `hasRetryableRemainder`: explain that some funds moved and more remain;
    keep the banner if refreshed status still reports `MIGRATABLE`/`DUE_NOW`,
    with copy that the user can tap migrate again.
  - `expiredCount > 0` with no movable inputs: show recovery/wait guidance,
    not success.
  - `migratedCount > 0` with no higher-priority conditions: show success and
    let refreshed status remove or downgrade the banner.
  - `globalSkip === "unknown-wallet-signer"`: explain that the SDK refused to
    rotate because the wallet signer is unknown, and point to diagnostics/support
    instead of implying success.
  - Other `globalSkip` or `legSkips` with no moved funds: show a clear
    "nothing to migrate right now" message, using the skip reason when useful
    (for example below-dust or oversized-only).
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
  product severity order, especially `DUE_NOW` outranking `EXPIRED` for
  actionability. `canMigrate` / `hasMigratableFunds` come from
  `isCooperativelyMigratable(status)`, and all-current/no reports produce
  `null`.
- **Locked gating:** `refreshSignerRotationStatus` returns before
  `ensureWallet` when `security.isLocked` is true, even if a live SDK wallet
  remains cached.
- **Signer-status coalescing:** duplicate triggers from wallet refresh plus
  `onServerInfoChanged` / digest retry share one in-flight signer-status
  refresh and do not perform duplicate `serverInfo` persist writes.
- **Digest retry barrier:** mocked provider emits fresh server info, starts a
  delayed app listener promise, then throws `DigestMismatchError`. Assert the
  retry helper does not invoke the retry callback until the listener promise has
  updated/persisted `network.serverInfo` and the wallet rebuild helper has run.
  Include an offboard-style test where the first attempt saw old fee/server info
  and the retry callback re-reads the fresh `serverInfo` before constructing
  `Ramps(wallet)`.
- **Digest wallet rebuild:** after a digest mismatch, wallet-backed retry paths
  dispose Lightning before the SDK wallet, re-acquire the wallet through
  `ensureWallet({ metadata, behavior })`, and no-op when there is no wallet or
  the app is locked. Tests must not rely on SDK-private fields such as
  `_serverInfoInFlight`.
- **Migration summary:** `summarizeMigrationReport` covers both `vtxos` and
  `boarding` legs, including full migration, one-leg partial success with the
  other leg erroring, `deferred` retryable leftovers, `oversized` unilateral-exit
  guidance, leg `skipped` reasons, global `skipped` reasons, and expired-only
  wait/recovery. Include a mixed report test where one pass has migrated inputs,
  deferred inputs, oversized inputs, a leg skip reason, a leg error, global
  `skipped: "unknown-wallet-signer"`, and top-level `expired[]`; the flat
  summary must preserve every count/flag/reason at once. Add no-move tests for
  `globalSkip` and leg-only `legSkips` so the UI always produces a clear
  message after a tap.
- **Migration action:** mocked `getVtxoManager().migrateDeprecatedSignerVtxos()`
  is called, followed by wallet refresh and signer-status refresh. Deferred,
  oversized, expired-only, and partial-error reports do not produce a false
  "migrated" success state.
- **Update-required onboarding:** mocked `BUILD_VERSION_TOO_OLD` from
  `probeServer` / `fetchServerInfo` setup paths sets `_updateRequired` and avoids
  a generic server-unreachable-only result.
- **Transient persistence:** `_updateRequired`, `_signerMigrationInFlight`, and
  `signerRotationStatus` are excluded from `persist()`.
- **Schema wipe:** persisted schema `7` hits the mismatch modal under
  `CURRENT_SCHEMA_VERSION = 8`.
- **Schema fixtures:** update the existing
  `app/store/__tests__/useAppStore.test.ts` "hydrates normally when stored
  version matches" fixture from `schemaVersion: 7` to `8`, keep schema `7`
  only in the stale-version mismatch assertion, and review the adjacent
  older/newer hydrate fixtures while making the bump.

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
