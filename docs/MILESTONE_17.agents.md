# Milestone 17: Cached Wallet Profiles and Labels

Goal: keep Trixie Wallet a single-wallet runtime while allowing the device to
store multiple cached wallet profiles that can be switched quickly by label.

The motivating use case is demo / testing ergonomics: a user can keep, for
example, one Mutinynet profile and one Bitcoin mainnet profile, then switch
between them without resetting the app or doing a hard restore every time.

This milestone should prove:

- A user can create, restore, label, and switch between cached wallet profiles.
- Exactly one wallet runtime is active at a time.
- Inactive profiles are durable local snapshots, not live accounts.
- Switching resurrects the target profile's existing secret and local repos,
  without chain re-scan beyond the normal active-wallet resume.
- Background swap work, foreground listeners, claim/refund attempts, and
  notifications are scoped to the active profile only.
- Inactive profiles can have pending swap material, but monitoring is paused
  until that profile is opened again.
- Reset supports two explicit paths: reset the active profile only, or full app
  reset that wipes every profile.
- Backup and import operate on one profile at a time.
- Different profiles may use different networks.

## Current State

- `app/store/types.ts:187` models a single `wallet:
  ArkadeWalletMetadata | null`. `app/store/useAppStore.ts:316-339`
  persists that one record alongside one `network` slice, one
  `walletBehavior` slice, one `assets.importedAssetIds` slice, and one
  `security` slice with app-wide `lastBackupAt` / `dirtyForBackup`.
- `createWallet`, `restoreWallet`, and `importBackup` reject when a wallet
  already exists. `setArkadeNetwork` refuses to change the network once a
  wallet exists.
- The lower storage layers already have useful profile boundaries:
  - SecureStore secrets use `trixie_wallet_secret_{walletId}`.
  - SDK repos are prefixed `ark_{walletId}_`.
  - `trixie_swap_meta` has `wallet_id` on every app-owned swap metadata row.
- The runtime is single-active today:
  - `runtime.ts` has module-level wallet instance state.
  - `lightning.ts` has one active Lightning instance, one WebSocket
    subscription set, and one set of module-level caches.
- The Boltz SDK table `boltz_swaps` is central and has no `wallet_id`.
  Ownership is known only through the app-owned `trixie_swap_meta` table.
- The OS background swap poll task is central. It reads one
  `trixie:boltz-swap-queue:active-wallet` value to decide which wallet
  context to run.
- The backup format already carries one wallet per envelope at
  `PAYLOAD_VERSION = 2`.
- Many screens and services read `state.wallet`, `state.network`,
  `state.walletBehavior`, `state.assets.importedAssetIds`, or
  `state.security.lastBackupAt` directly.
- `CURRENT_SCHEMA_VERSION` is `6`. The persisted shape change in this
  milestone bumps it to `7`.

## Product Rules

- **Single-wallet runtime.** Trixie remains a single-wallet app at runtime.
  There is one active wallet instance, one active Lightning service, one
  incoming-funds listener, and one background poll target.
- **Profiles are cached dormant wallets.** Inactive profiles are local
  snapshots: metadata, secret, SDK repos, swap metadata, labels, network, and
  backup state. They are not polled or refreshed while inactive.
- **Active-only swap management.** Pending swaps for inactive profiles are
  durable but paused. They are resumed when the user switches back to that
  profile.
- **No cross-profile wallet-context execution.** The app must not claim,
  refund, restore, or refresh swaps for a dormant profile under the active
  profile's wallet context.
- **Network is intrinsic to the profile.** Each profile pins its network and
  Ark server URL. There is no app-wide network slice.
- **App-wide lock.** Password and biometrics remain device-scoped. Unlocking
  opens the last active profile directly.
- **Labels are user-owned metadata.** Renaming a profile does not touch the
  secret store.
- **Per-profile backup.** One `.trixiebackup` file holds one profile. Import
  appends a profile and switches to it, rather than replacing another profile.
- **Reset is active-or-all only.** Dormant profiles are switch targets, not
  directly resettable records. To delete a dormant profile, the user switches
  into it and uses "Reset active wallet". "Full reset" is the only path that
  deletes inactive profiles without opening them first.
- **No backwards compatibility.** Per `FOUNDATION.md`, schema version `6 -> 7`
  triggers the wipe-on-mismatch modal. No migration ladder.

## Selected Direction

Replace the single `wallet` field with:

- `wallets: ArkadeWalletMetadata[]`
- `activeWalletId: string | null`

Extend `ArkadeWalletMetadata` so a stored profile is a complete dormant
snapshot, not just display metadata. Move conceptually per-profile state into
that profile object:

- `behavior`
- `importedAssetIds`
- `lastBackupAt`
- `dirtyForBackup`
- server probe state: `detectedNetwork`, `serverInfo`, `serverStatus`,
  `serverLastError`

Keep the existing wallet identity / balance fields on `ArkadeWalletMetadata`:
`id`, `label`, `identityKind`, `publicKeyHex`, `arkServerUrl`, `esploraUrl`,
`network`, addresses, balances, activities, backup summary, and Lightning
restore / resume summaries.

Keep device-scoped state outside profiles:

- `security.isLocked`, `passwordHash`, `passwordSalt`, `biometricsEnabled`
- `preferences` such as theme, fiat currency, bitcoin unit, notifications
- `backgroundTasks` user preferences

Add a `WalletPicker` screen for switching between cached profiles. Rows show
label, network badge, short id, balance, and whether the balance is live or
last-known. `+ Add Wallet` enters the create / restore flows under dedicated
route names.

Switching does not make the app a multi-wallet daemon. It tears down the active
runtime, selects another cached profile, and rebuilds the single active runtime
against that profile's local data.

## Implementation Plan

### 1. Store and Persistence

- Bump `CURRENT_SCHEMA_VERSION` and `AppState.schemaVersion` to `7`.
- Add `"switch"` to `LightningResumeTrigger`; switch-specific resume summaries
  should be stored on the target profile only.
- Persist:
  - `wallets: ArkadeWalletMetadata[]`
  - `activeWalletId: string | null`
  - device-scoped `security`, `preferences`, and `backgroundTasks`
- Remove:
  - `AppState.wallet`
  - `AppState.network`
  - `AppState.walletBehavior`
  - `AppState.assets.importedAssetIds`
  - `security.lastBackupAt`
  - `security.dirtyForBackup`
- Do not introduce a separate active-profile slice. The active profile is
  always the `wallets` entry whose `id === activeWalletId`; updates replace
  that array entry.
- Keep `activeWalletId = null` representable even when `wallets.length > 0`.
  This is the recovery state used when the app cannot rebuild or select a
  profile runtime. A merely missing persisted id is repaired during hydrate by
  falling back to the first profile.

Target state shape:

```ts
type AppState = {
  schemaVersion: 7;
  wallets: ArkadeWalletMetadata[];
  activeWalletId: string | null;
  backgroundTasks: BackgroundTasks;
  preferences: {
    theme: ThemePref;
    fiatCurrency: FiatCurrency;
    bitcoinUnit: BitcoinUnit;
    notifications: NotificationPreferences;
  };
  security: {
    isLocked: boolean;
    passwordHash?: string;
    passwordSalt?: string;
    biometricsEnabled: boolean;
  };
};

type ArkadeWalletMetadata = ExistingArkadeWalletMetadataFields & {
  behavior: WalletBehavior;
  importedAssetIds: string[];
  lastBackupAt?: number;
  dirtyForBackup?: boolean;
  detectedNetwork: string | null;
  serverInfo: ArkadeServerInfo | null;
  serverStatus: ServerStatus;
  serverLastError: string | null;
};
```

- Do not persist compatibility shims for the old top-level fields. Per
  `FOUNDATION.md`, a v6 payload reaches the schema-mismatch modal and is wiped
  only after user confirmation.
- Add selectors:
  - `useActiveWallet()`
  - `getActiveWallet()`
  - `useActiveWalletBehavior()`
  - `getActiveWalletBehavior()`
  - `updateWalletProfile(walletId, updater)` or an equivalent internal helper
    so actions do not hand-roll array replacement
  - `hasActiveWalletOperation`
- Add actions:
  - `switchWallet(walletId: string): Promise<void>`
  - `renameWallet(walletId: string, label: string): Promise<void>`
  - `resetActiveWallet(expectedWalletId: string): Promise<void>`
  - `fullReset(): Promise<void>`
  - `exportBackup(walletId, password)`
  - `markBackupCompleted(walletId, createdAt)`
  - `markDirtyForBackup(walletId)`
  - `getBackupHealth(walletId)`
  - `getPendingSwapCountForWallet(walletId)`
- Change signatures:
  - `createWallet(kind, network)` appends a profile and makes it active
  - `restoreWallet(input, network)` appends a profile and makes it active
  - `importBackup(envelope, password)`
- Remove `setArkadeNetwork`. The selected network is local screen state until
  create / restore commits a profile.
- `refreshServer()` becomes profile-targeted or active-profile-only; it must
  write probe state into the profile, never an app-wide network slice.
- `setWalletBehavior()` becomes active-profile behavior update. It writes
  `activeWallet.behavior`, marks only that profile dirty for backup, and still
  disposes the active runtime because behavior affects wallet construction.
- `importAsset()` / `forgetAsset()` write the active profile's
  `importedAssetIds` and mark only that profile dirty.
- `markDirtyForBackup(walletId)` and swap-event dirtiness must identify the
  wallet they are dirtying. Until Batch 3 adds event attribution for swap
  callbacks, only mark the current active profile when the event belongs to
  the active runtime generation.

#### Labels

- Creation and seed / nsec / hex restore default to `"Wallet {n}"`, where
  `n = wallets.length + 1` at the time the profile is added.
- Backup import preserves `payload.wallet.label` after validation.
- Label validation:
  - trim whitespace
  - reject empty labels
  - max 32 graphemes
  - uniqueness is not enforced; the picker shows short id for disambiguation

#### Hydrate

- If `activeWalletId` is not found in `wallets`, fall back to the first
  profile.
- If there are no profiles, leave `activeWalletId = null`.
- Normalize every hydrated profile:
  - missing `behavior` gets `DEFAULT_WALLET_BEHAVIOR`
  - missing `importedAssetIds` gets `[]`
  - missing server probe fields get idle/null defaults
  - missing `assetBalances` gets `[]`
- Persist the normalized fallback if `activeWalletId` was repaired during
  hydrate.
- If there is an active profile and the app is unlocked, schedule the normal
  active-wallet Lightning resume for that profile only.

### 2. Runtime Ownership and Switch Safety

The app must not switch away while a foreground action still owns the active
runtime.

#### Foreground Operation Gate

Add a central, non-persisted gate in the store:

- `activeWalletOperations: Record<string, { kind: string; walletId: string }>`
  or an equivalent refcount keyed by opaque token
- `beginWalletOperation(kind, walletId = activeWalletId): token`
- `finishWalletOperation(token)`
- `withActiveWalletOperation(kind, fn)` helper for store actions
- derived selector `hasActiveWalletOperation`

Every wallet-affecting foreground action enters the gate before touching the
runtime and clears it in `finally`, after post-action `refreshWallet()` and
`persist()` finish.

The token records the wallet id captured at operation start. After every await
that touches the runtime, the action must re-check that the captured id is
still active before writing profile state. If the active id changed, drop the
write and return / throw a stale-operation error as appropriate.

Covered operations:

- `sendArkade`
- `sendLightning`
- `sendOnchain`
- `sendChainSwap`
- Lightning invoice / receive swap creation, including LNURL on-demand invoice
  handlers
- `runRecoveryAction`
- `importAsset`
- `forgetAsset`
- `issueAsset`
- `reissueAsset`
- `burnAsset`
- `setWalletBehavior`
- create / restore / backup-import flows
- active-profile reset
- pull-to-refresh when it uses the active runtime and persists metadata

Full reset does not enter the normal wallet operation gate as a wallet action,
but its UI is disabled while this gate is busy. Once confirmed, full reset
sets its own full-reset-in-progress flag and invalidates the runtime generation
before wiping storage.

Move direct runtime-owning screen calls behind store/service wrappers that
enter the same gate:

- `ReceiveLightningAmountScreen`: invoice creation becomes a store action, not
  a direct `ensureLightning()` + `createLightningInvoice()` + metadata write.
- `ReceiveQRScreen`: LNURL invoice callback uses the gated receive-invoice
  action and carries the captured active wallet id.
- `SendReviewScreen`: fee preview / VTXO loading through `ensureWallet()` uses
  a gated read-only preview helper, or is explicitly cancelled if the active
  wallet changes before the preview resolves.
- Any future screen-level `ensureWallet()`, `ensureLightning()`, `getWallet()`,
  or `getLightning()` use must either move into the store or call a shared
  guarded runtime helper.

`switchWallet(targetId)` checks the gate first. If busy, it throws:

```ts
new ArkadeError(
  "wallet_busy",
  "Finish the current wallet action before switching",
)
```

The UI disables runtime-disposing entry points while busy:

- WalletPicker switch rows
- WalletScreen switch affordance
- `+ Add Wallet`
- active-profile reset
- full reset
- create / restore / import routes that would activate a new profile

There is no dormant-profile reset affordance.

This gate protects user-initiated foreground races. It does not replace event
attribution or runtime generation checks for late callbacks.

#### Runtime Generation

Add a non-persisted runtime generation counter:

- `activeRuntimeGeneration: number`
- increment it before disposing the current runtime
- capture `{ walletId, generation }` in resume, refresh, incoming-funds, and
  swap-event callbacks
- before writing profile state after async work, verify both wallet id and
  generation still match the current active runtime

This guards late callbacks from the old runtime after switch teardown:

- delayed `refreshWallet()` loops
- `scheduleLightningResume(...)`
- swap event debounce timer
- incoming-funds debounce timer
- LNURL invoice callback
- background / foreground app-state resume callback

Add explicit timer cleanup helpers:

- `clearSwapEventRefreshTimer()`
- `clearIncomingFundsRefreshTimer()`
- clear `refreshInFlight` / `refreshPending` only by invalidating generation;
  do not try to cancel promises that cannot be cancelled

#### Resume In-Flight Scope

`lightningResumeInFlight` becomes:

```ts
{ walletId: string; generation: number; promise: Promise<void> } | null
```

Only reuse the promise when both wallet id and generation match the current
active profile. Clear it on runtime teardown and when switch starts.

`resumeLightning(trigger)` captures the active profile and generation at the
start. It must write `lightningResume` only if the same profile/generation is
still active after `resumeLightningSwaps()` and the post-resume
`refreshWallet()` complete.

### 3. Swap Storage and Active-Profile Scoping

Physical storage remains central:

- `boltz_swaps` is owned by `@arkade-os/boltz-swap` and has no `wallet_id`.
- `trixie_swap_meta.wallet_id` is the authoritative ownership map.

#### Ownership Metadata

Reshape app-owned swap metadata so ownership can be recorded before all
projection details are known.

- `trixie_swap_meta.swap_id` remains the primary key.
- `trixie_swap_meta.wallet_id` is required and immutable after insertion.
- Direction / flow / amount / linkage fields may be nullable or completed in a
  follow-up update. Ownership must not depend on those projection fields being
  available.
- Add `claimSwapOwnership({ walletId, swapId, source })`:
  - insert a minimal ownership row if none exists
  - no-op when the existing owner is the same wallet
  - throw / record `swap_owner_conflict` when the existing owner is a different
    wallet
- Change `recordSwapMetadata(...)` into an ownership-preserving upsert:
  - it must never change `wallet_id` for an existing `swap_id`
  - it fills or updates direction / flow / amount / linkage fields
  - it preserves sticky LNURL flow resolution
- Consumers must tolerate incomplete projection metadata on an owned row:
  - Activity mapping may fall back to fields on the Boltz swap object
  - missing flow means generic Lightning / Bitcoin copy, not LNURL-specific copy
  - backup / diagnostics may export or count ownership rows whose optional
    projection fields are still null
- `linkSwapToWalletTx(...)` must be wallet-scoped:
  - include `walletId`
  - update only `WHERE swap_id = ? AND wallet_id = ?`
  - treat zero updated rows as a stale / wrong-profile linkage failure

This removes the creation-time gap where the Boltz SDK has saved a row in
`boltz_swaps` but app metadata has not yet been written.

#### Scoped Repository

The active runtime must see a profile-scoped swap repository view:

- Add `createWalletScopedSwapRepository(walletId)`.
- It wraps the central `SQLiteSwapRepository` and exposes the same repository
  surface needed by `ExpoArkadeSwaps`.
- Every read filters central rows through ownership:
  - `boltz_swaps.id IN (SELECT swap_id FROM trixie_swap_meta WHERE wallet_id = ?)`
  - preserve caller filters such as type, order, status, and id
  - return no rows for orphaned central swaps
- Every write delegates to the central SDK repository and then claims
  ownership for the same wallet id:
  - `saveSwap(swap)` saves the central row, then calls
    `claimSwapOwnership({ walletId, swapId: swap.id, source: "repository" })`
  - batch / restore writes claim each saved row for that scoped wallet
  - owner conflicts throw and are recorded; do not silently reassign a swap
- `clear()` on a scoped repository must clear only rows owned by that wallet.
  Do not expose central `clearAllSwaps()` to profile reset paths.
- A central unscoped repository may remain for full-app wipe and diagnostics
  only.

Foreground Lightning setup must always pass a scoped repository:

- `ensureLightning({ metadata, behavior, ... })` builds
  `createWalletScopedSwapRepository(metadata.id)`.
- `sendLightningPayment`, `createLightningInvoice`, `createArkToBtcChainSwap`,
  `restoreLightningActivity`, `refreshSwapsStatus`, `getNonTerminalSwapCount`,
  recovery scans, and by-id claim/refund helpers must operate through that
  scoped repository.
- Store actions still call `recordSwapMetadata(...)` after creation to fill
  direction / flow / amount fields, but ownership has already been claimed by
  the scoped repository write. Those follow-up metadata writes must pass the
  captured wallet id from the operation gate.

This is the core isolation rule:

> `boltz_swaps` is central, but every UI, backup, reset, recovery,
> notification, resume, and swap-manager view is scoped by
> `trixie_swap_meta.wallet_id`.

Required helpers:

- `listOwnedSwapIds(walletId)`: returns ids from `trixie_swap_meta`.
- `getSwapOwner(swapId)`: returns the owning wallet id, or `null`.
- `clearSwapsForWallet(walletId)`:
  - read owned ids
  - delete matching central `boltz_swaps` rows
  - delete matching `trixie_swap_meta` rows
  - leave other profiles and orphan rows untouched
- `snapshotBoltzSwapsForWallet(walletId)`:
  - export only central rows joined to metadata for that wallet
  - stable-sort output by `created_at` / id for deterministic backups
- `getPendingSwapCountForWallet(walletId)`:
  - count non-terminal joined rows for the target profile
  - must work for dormant profiles without initializing Lightning
- `getLatestBoltzSwapWriteAtForWallet(walletId)`:
  - compute timestamp from joined central rows only
  - do not let another profile's newer central row mark this profile stale
- `getLightningActivitySources(walletId)`:
  - return scoped Boltz rows and scoped metadata
  - must not require `activeInstance`; Activity / backup / diagnostics can read
    dormant profile data directly from storage
- `findOrphanBoltzSwapIds(limit)`:
  - central rows with no metadata row
  - used by diagnostics and support bundle redacted reporting

Consumers that must switch to scoped helpers in this batch:

- Activity construction / `buildActivities`
- `getBackupHealth(walletId)` timestamp inputs
- reset pending-swap gate
- `ProfileRecovery` / recovery scanner
- `ActivityDetails` chain refund path
- backup export snapshot inputs
- diagnostics counts for active-profile swap rows

By-id mutation helpers must verify ownership before acting:

- `refundChainSwapById(walletId, swapId)`
- `lookupSubmarineRecovery(walletId, swapId)`
- `runSubmarineRecovery(walletId, swap)`
- `isSwapBeingProcessed(walletId, swapId)`

If the requested swap is not owned by the active wallet id, throw a typed
wrong-profile / stale-row error and do not call the SDK mutation.

Residual risk: a `boltz_swaps` row without metadata is unowned. It must not be
shown, exported, reset as another wallet, or processed by a scoped runtime.
Record it through diagnostics as `orphan_swap_row` if encountered during
support bundle generation or scoped repository filtering.

### 4. Background Swap Poll

The background poll follows the active profile only.

#### Active Background Target

`rememberSwapBackgroundWallet(metadata)` continues to write one
`ACTIVE_WALLET_KEY`, but the value is now treated as the sole active background
target:

```ts
type ActiveSwapWallet = {
  walletId: string;
  network: string;
  updatedAt: number;
};
```

Rules:

- Write `ACTIVE_WALLET_KEY` only after the profile has been committed active
  and Lightning setup for that profile has succeeded.
- On switch, the target profile becomes the background target only after the
  target runtime is built and committed.
- On Lightning-unsupported networks, remove `ACTIVE_WALLET_KEY` and leave the
  OS task registered state unchanged unless this is full reset.
- Dormant profiles are never written to `ACTIVE_WALLET_KEY`.
- If a dormant profile has pending swaps, its rows remain durable but no
  background task may claim, refund, refresh, or notify for them until the
  profile becomes active again.

#### Task Runtime Context

The OS task must capture the active wallet once per task execution and use that
same captured context for identity, repository, and result attribution.

Add an internal task context helper:

- `readActiveSwapWallet()` validates `ACTIVE_WALLET_KEY`.
- `withActiveSwapTaskContext(fn)` reads the key once and exposes
  `{ walletId, network, activeUpdatedAt, taskStartedAt }` to all background
  task collaborators for that execution.
- `identityFactory` uses the captured `walletId` and `network` to read the
  secret and build identity.
- The background swap repository uses the captured `walletId`.
- `RecordingSwapTaskQueue.pushResult` uses the captured context when recording
  the shadow result.

Do not let `identityFactory`, repository methods, and result recording each
read `ACTIVE_WALLET_KEY` independently during the same task execution. If the
user switches profiles while a background task is running, independent reads
could mix profile A's identity with profile B's repository or result
attribution.

If the package API does not expose a clean task-execution wrapper, emulate this
with a short-lived module-level `activeTaskContext` that is set for the
duration of a task run and cleared in `finally`. Fail closed when no context is
available for a repository operation that would otherwise process swaps.

#### Active-Scoped Background Repository

Background task setup uses an active-wallet repository adapter:

- Add `createActiveWalletSwapRepository()`.
- It resolves the current task context and delegates to
  `createWalletScopedSwapRepository(context.walletId)`.
- It must fail closed when no active context / active wallet exists.
- It must not cache a wallet id across task executions.
- All reads and writes are filtered / claimed through Batch 3's scoped
  repository rules.

The task definition should use:

- `identityFactory` backed by the captured task context
- `swapRepository: createActiveWalletSwapRepository()`
- the existing central queue prefix, because there is still one OS task
  scheduler and one active background target

#### Result Attribution and Retention

`RecordedSwapTaskResult` includes profile attribution captured at task runtime:

```ts
type RecordedSwapTaskResult = TaskResult & {
  walletId: string;
  network: string;
  activeWalletUpdatedAt: number;
  taskStartedAt: number;
  recordedAt: number;
  notified?: boolean;
};
```

Recording rules:

- Push result entries with the captured `walletId` and `network`, not with a
  fresh read of `ACTIVE_WALLET_KEY` at result-write time.
- Notification decisions are still made at result-write time, but notifications
  must use the captured wallet id for metrics / retention.
- Durable background metrics include `walletId` and `network` where possible.
- Persisted background errors include wallet id / network when they came from a
  captured context.

Foreground drain changes from "read and delete the whole shadow log" to
profile-scoped draining:

- Add `drainSwapPollResultsForWallet(walletId)`.
- It reads `RECENT_RESULTS_KEY`, returns only entries matching `walletId`, and
  writes all non-matching entries back to `RECENT_RESULTS_KEY`.
- It re-applies `RECENT_RESULTS_CAP` after merging retained entries. Prefer
  retaining newest entries per wallet rather than letting one active profile
  evict all dormant-profile results.
- It re-seeds the poll task after draining, as today.
- `resumeLightningSwaps(...)` calls `drainSwapPollResultsForWallet(metadata.id)`.
- Foreground toasts / resume summaries are computed only from drained results
  for the active wallet.

This prevents stale results from profile A being displayed after the user has
switched to profile B, while still allowing profile A's results to be surfaced
when profile A is opened again.

#### Queue State

The package queue remains central:

- Keep one inbox / outbox / config namespace.
- Keep one seeded swap-poll task type.
- Do not enqueue one poll task per dormant profile.
- The task processor resolves the active profile at runtime, so a queued task
  that was created while A was active can legitimately process B later if B is
  active when the OS runs it.
- The result attribution is therefore based on task runtime context, not queue
  creation time.

When full reset is confirmed:

- unregister the background task
- remove `ACTIVE_WALLET_KEY`
- clear queue inbox / outbox / config
- clear recent result shadow log
- clear background task metrics

When the active profile is reset and another profile remains:

- dispose active runtime as in reset flow
- remove `ACTIVE_WALLET_KEY`
- do not write a survivor to `ACTIVE_WALLET_KEY` automatically
- set `activeWalletId = null` and route to WalletPicker; background poll stays
  paused until the user explicitly opens another profile
- keep retained recent results for other surviving profiles

Required helpers:

- `readActiveSwapWallet()`
- `rememberSwapBackgroundWallet(metadata)`
- `forgetSwapBackgroundWallet(walletId)`:
  - removes `ACTIVE_WALLET_KEY` only when it currently points at `walletId`
- `createActiveWalletSwapRepository()`
- `drainSwapPollResultsForWallet(walletId)`
- `clearSwapPollResultsForWallet(walletId)`
- `clearAllSwapBackgroundState()`

### 5. Runtime and Switch Flow

`runtime.ts` and `lightning.ts` remain single-active modules.

Switching is a blocking action with a stage overlay. It must not run while the
foreground operation gate is busy, and it must not durably commit the target
profile as active until the target server probe, runtime rebuild, and first
snapshot refresh have succeeded.

Add transient UI / store state for the blocking overlay, not persisted:

- `walletSwitch: { targetWalletId: string; label: string; stage: string } | null`
- stages:
  - "Stopping current wallet..."
  - "Connecting to <label>..."
  - "Opening <label>..."
  - "Refreshing <label>..."
  - "Resuming swaps..."

Flow:

1. If `hasActiveWalletOperation`, throw `wallet_busy` and leave state
   unchanged.
2. If `targetId === activeWalletId`, no-op.
3. Find the target profile. Throw descriptively if missing.
4. Capture `priorActiveWalletId`, `priorProfile`, and the current runtime
   generation.
5. Set `walletSwitch` overlay state and increment runtime generation. From
   this point, late callbacks from the old runtime must fail their generation
   check and drop their writes.
6. Clear foreground refresh timers, clear wallet-scoped
   `lightningResumeInFlight`, and invalidate cached VTXO snapshots.
7. Dispose Lightning, then dispose wallet.
8. Probe `target.arkServerUrl` without changing persisted `activeWalletId`.
9. On probe success, build the target runtime without committing active id yet:
   - update a local target draft with server info / status
   - `ensureWallet({ metadata: targetDraft, behavior: target.behavior })`
   - `maybeEnsureLightning(targetDraft, target.behavior, backgroundTasks.swapPoll)`
     using the profile-scoped swap repository
   - `refreshWalletSnapshot(targetDraft, target.behavior)`
   - build the final target profile snapshot in memory
10. Atomically commit the target only after step 9 succeeds:
    - replace the target `wallets[]` entry with the refreshed target profile
    - set `activeWalletId = targetId`
    - persist once
11. Schedule `resumeLightning("switch")` for the target profile only. The
    resume write is guarded by target wallet id and generation.
12. Pop navigation to Main so Send / Receive / Activity params from the prior
    profile cannot linger.
13. Hide the stage overlay.

Probe or target rebuild failure:

- write the target profile's `serverStatus = "offline"` and
  `serverLastError`, but leave persisted `activeWalletId` unchanged
- attempt to rebuild the prior profile runtime using `priorProfile`
- if prior rebuild succeeds, keep / restore `activeWalletId = priorActiveWalletId`
  and persist only the target error state
- if prior rebuild fails, set `activeWalletId = null`, persist the target error
  state, route to `WalletPicker`, and surface a toast explaining that no
  profile could be opened automatically
- always clear `walletSwitch` in `finally`

Switch no longer persists the target id before probe / rebuild. This avoids a
kill-between-persist-and-rollback state where startup would treat an unopened
or broken target profile as active.

### 6. Switching With Pending Swaps

Pending swaps are durable but only monitored for the active profile.

Switching away from a profile with non-terminal swaps is allowed after any
foreground operation has completed. The picker should make the implication
clear:

- If the active profile has pending swaps, show a confirmation sheet:
  "Swap monitoring for <label> will pause until you open it again."
- The confirmation is not needed for zero pending swaps.
- Switching back to that profile runs `resumeLightning("switch")`, drains
  active-profile background results, refreshes swap statuses, and resumes
  claim/refund work for that profile.

Active-profile reset remains stricter:

- `Reset active wallet` uses `getPendingSwapCountForWallet(activeWalletId)`.
- Pending swaps block or require the existing typed "RESET PENDING" gate,
  using the active profile's label and counts.
- `Full reset` does not run per-wallet pending-swap checks; the dedicated
  screen warns that all local swap recovery state will be deleted.

### 7. Backup and Import

Backup remains one profile per file.

#### Payload Shape

Do not introduce a multi-wallet backup envelope. A `.trixiebackup` file still
contains exactly one wallet profile and its recovery-critical local rows.

The current v2 payload already carries:

- `wallet`
- `walletBehavior`
- portable `preferences`
- `secret`
- `swapMetadata`
- `boltzSwaps`
- `importedAssetIds`

Map those fields into / out of the new profile shape:

- `walletBehavior` becomes the profile's `behavior`
- `importedAssetIds` becomes the profile's `importedAssetIds`
- portable `preferences` remain device-level import material, not profile data
- `secret` remains per wallet id
- `swapMetadata` and `boltzSwaps` are scoped to the payload wallet id

Do not serialize `lastBackupAt` or `dirtyForBackup`. Those are local backup
health markers:

- successful export dispatch sets `profile.lastBackupAt = createdAt` and
  `profile.dirtyForBackup = false`
- successful import initializes the imported profile as backed up at the
  envelope / payload creation time and not dirty
- later profile-local mutations mark only that profile dirty

Batch 3 makes ownership metadata rows valid before all projection fields are
known. Because current v2 parsing requires `direction` and `createdForFlow`,
update the backup serializer as follows:

- bump `PAYLOAD_VERSION` to `3` if `LocalSwapMetadata.direction` /
  `createdForFlow` become nullable in the exported shape
- keep v1 / v2 imports supported and normalize them into the v3 in-memory
  shape
- v3 `swapMetadata` rows require `swapId` and `walletId`, but nullable
  projection fields stay nullable
- duplicate `swapId` entries inside the same payload are invalid
- `boltzSwaps` remains the package-owned object shape and is not normalized
  beyond id/type presence checks
- update `docs/BACKUP_FORMAT.md` and `scripts/decrypt-backup.mjs` examples /
  fixture expectations to show the current payload version and
  `importedAssetIds`

#### Export

`exportBackup(walletId, password)`:

- reads the named profile
- reads that profile's secret
- verifies the secret kind matches the profile's `identityKind`
- uses scoped swap metadata for `walletId`
- uses `snapshotBoltzSwapsForWallet(walletId)`
- reads `profile.behavior` and `profile.importedAssetIds`, not old top-level
  store slices
- includes only portable device preferences:
  `theme`, `fiatCurrency`, and `bitcoinUnit`
- excludes notifications, background-task preferences, lock/security state,
  server probe state, cached balances, activities, and backup health markers
- does not initialize or switch to a dormant profile just to export it
- returns `{ walletId, uri, filename, createdAt }` so the UI can mark the same
  profile complete even if the active profile changes while the OS save/share
  sheet is open
- includes the short id in the temp basename:
  `trixie-backup-{shortId}-{stamp}.trixiebackup`

The backup screen must pass the captured active wallet id into
`exportBackup(walletId, password)`. `markBackupCompleted(walletId, createdAt)`
is called only after the user successfully saves or shares the prepared temp
file. Cancelled save/share leaves `dirtyForBackup` unchanged.

#### Import Validation

`importBackup(envelope, password)`:

- decrypts and parses as today
- runs structural payload parsing before any local side effects
- validates `payload.wallet.id` is not already present in `wallets`
- validates the label with the same label rules as `renameWallet`; do not
  silently replace an invalid label
- validates `payload.wallet.identityKind` matches `payload.secret.kind`
- treats `payload.wallet.network` as the source of truth, derives the Ark
  server URL from the known network mapping, and ignores the saved
  `wallet.arkServerUrl` except for diagnostics
- rejects unsupported networks before writing secrets or swap rows
- probes the derived Ark server and rejects network mismatch before writing
  secrets or swap rows
- validates every `payload.swapMetadata[i].walletId === payload.wallet.id`
- rejects duplicate swap ids in `payload.swapMetadata`
- rejects duplicate ids in `payload.boltzSwaps`
- rejects any `payload.boltzSwaps[i].id` not present in payload swap metadata
- rejects any incoming swap id that already exists locally in
  `trixie_swap_meta` or `boltz_swaps`, including orphan central rows with no
  metadata owner
- preserves metadata-only rows from the backup; a metadata row without a
  matching Boltz row is valid

Add an import preflight helper, or equivalent store-local validation, that
returns the normalized payload plus:

- imported wallet id
- normalized label
- normalized behavior
- normalized imported asset ids
- derived network / Ark server URL
- probed server info
- incoming swap id set

No state or SQLite write should happen until this preflight succeeds.

#### Additive Import Flow

Import appends the profile and makes it active, but it must use the same
two-phase safety as `switchWallet`:

1. Run decrypt / parse / preflight validation with no local writes.
2. Enter the foreground operation gate. Re-read `wallets`, active profile, and
   local swap ownership after the gate is acquired so a state change during
   decryption / probing cannot invalidate the earlier preflight.
3. Capture whether this is still a clean install, the prior active profile,
   and the current runtime generation.
4. Stage imported side effects for the new wallet id:
   - `saveSecret(walletId, payload.secret)`
   - restore metadata with ownership-preserving inserts for the payload wallet
   - restore Boltz rows through a wallet-scoped restore helper, not the
     unscoped central repository
5. Increment runtime generation before disposing the current active runtime.
6. Build the imported runtime using the payload secret, normalized behavior,
   derived server URL, probed server info, and Batch 3's scoped swap
   repository.
7. Refresh the first wallet snapshot and rebuild Activity from scoped sources.
8. Atomically commit once:
   - append the imported profile to `wallets`
   - set `activeWalletId = payload.wallet.id`
   - set the imported profile's `lastBackupAt` from the backup creation time
   - set the imported profile's `dirtyForBackup = false`
   - apply portable preferences only if this was a clean install
   - preserve existing preferences, notifications, security, biometrics, and
     background-task settings on additive import
9. Persist once.
10. After commit, schedule profile-scoped Lightning restore / resume and update
   the active background target if Lightning setup succeeded.

Do not commit `activeWalletId` before the imported runtime and first snapshot
are ready. A kill or crash before commit must leave the old active profile as
the durable active profile.

#### Import Rollback

Rollback must be profile-scoped:

- if the imported runtime was created, dispose it
- delete only the imported profile's secret
- clear only the imported profile's scoped Boltz rows and metadata
- clear retained background poll results for the imported wallet id
- do not call `clearAllSwaps()`
- do not remove or mutate existing profiles
- do not change device preferences, security, notifications, or background
  task settings
- if the prior active runtime was disposed, attempt to rebuild it; if rebuild
  fails, persist `activeWalletId = null` rather than pointing at the failed
  import

Post-commit work failures, such as a later Lightning restore scan, must not
roll back a successfully imported and persisted profile. Record them on the
profile's Lightning restore / resume state instead.

`markBackupCompleted(walletId, createdAt)` and `markDirtyForBackup(walletId)`
write to the named profile.

### 8. Reset

Reset has exactly two user-facing paths:

- **Reset active wallet**: delete the currently open profile only. This path is
  available only when at least one other profile exists.
- **Full reset**: delete every profile and all local wallet state.

There is no dormant-profile reset action. Dormant profiles are effectively
unusable until opened, and their purpose is fast switching. If a user wants to
delete a dormant profile, they must switch into it first and then use
`Reset active wallet`.

#### Reset Active Wallet

Replace the current Profile reset entry with `Reset active wallet`.

Route to the existing `ProfileReset` screen, but make the screen active-profile
specific:

- capture the active wallet id, label, short id, and network when the screen
  opens
- if there is no active wallet, route back to WalletPicker / Landing
- if there is only one profile, route to the full-reset screen instead of
  running active-profile reset
- show the captured profile label, short id, and network in the warning copy
- compute backup health with `getBackupHealth(capturedWalletId)`
- compute pending swap count with
  `getPendingSwapCountForWallet(capturedWalletId)`
- keep the existing backup warning, pending-swap alert, and typed destructive
  confirmation behavior for this active-profile path
- before final confirmation, re-check that `activeWalletId === capturedWalletId`
  and that another profile still exists; otherwise abort and route back

`resetActiveWallet(expectedWalletId)`:

- rejects if `expectedWalletId` is not the current `activeWalletId`
- rejects if the current active profile is missing
- rejects if no survivor profile exists; full reset is the only final-profile
  deletion path
- enters the foreground operation gate
- increments runtime generation so late callbacks from the deleted runtime
  drop their writes
- clears foreground refresh timers, incoming-funds timers,
  wallet-scoped `lightningResumeInFlight`, and VTXO snapshot cache
- disposes active Lightning and wallet runtime
- deletes only the active profile's secret
- clears only that profile's SDK repos
- clears only that profile's joined `boltz_swaps` rows and
  `trixie_swap_meta` rows via `clearSwapsForWallet(walletId)`
- clears only that profile's asset-icon approvals
- clears retained background poll results for that wallet id
- removes the profile from `wallets`
- sets `activeWalletId = null`
- removes `ACTIVE_WALLET_KEY` if it points at the deleted wallet
- persists once
- routes to WalletPicker so the user explicitly chooses the next profile

Do not automatically open the first survivor. The deleted wallet was the only
active runtime, and choosing the next profile is a product decision, not a
storage cleanup side effect. When the user picks another profile, the normal
`switchWallet(id)` flow probes, rebuilds, refreshes, resumes swaps, and writes
the active background target.

Active reset must not clear:

- any other profile
- any other profile's secret or SDK repos
- other profiles' swap rows or metadata
- other profiles' retained background results
- app lock/security settings
- preferences or notification settings
- background-task user preferences
- diagnostics
- shared network-keyed asset metadata
- global tx timestamp cache

#### Full Reset

Add a second Profile action: `Full reset`.

This route does not run per-wallet checks:

- no backup-health checks
- no pending-swap checks
- no recovery scan
- no per-profile warning aggregation

It opens a dedicated destructive screen whose copy is about the whole app, not
the active wallet. The screen must show:

- the total wallet count
- a clear statement that every cached wallet profile will be deleted
- a clear statement that all local swap recovery state will be deleted
- a clear instruction to check / back up each wallet first
- a single destructive button, e.g. `Full reset`

The full reset entry / button should still be disabled while the foreground
operation gate is busy. This is not a backup or pending-swap check; it prevents
wiping storage while a send / receive / recovery action is actively mutating
the runtime.

`fullReset()`:

- enters a full-reset-in-progress state so late UI callbacks cannot start new
  wallet work
- increments runtime generation
- clears foreground timers, resume state, and VTXO snapshot cache
- disposes Lightning and wallet runtime
- unregisters the background swap task
- removes `ACTIVE_WALLET_KEY`
- clears background queue inbox / outbox / config
- clears the recent background result shadow log
- clears background task metrics
- deletes every stored wallet secret
- clears every `ark_{walletId}_*` SDK repo for every stored profile
- clears all `trixie_swap_meta` rows
- clears all central `boltz_swaps` rows
- clears all asset-icon approvals
- clears shared asset metadata
- clears persisted diagnostics / errors
- removes the persisted app store key and legacy storage keys
- resets Zustand state to `DEFAULT_STATE` with `_hydrated = true`
- routes to Landing

The full reset implementation may share an internal "wipe all local wallet
state" helper with schema-mismatch wipe, but keep the public actions separate:

- `acknowledgeSchemaMismatchAndWipe()` is for the schema mismatch modal
- `fullReset()` is for the explicit Profile nuclear reset screen

### 9. Asset and Metadata Scoping

- `asset-icon-approval` is re-keyed from `trixie:asset-icon-approval` to
  `trixie:asset-icon-approval:{walletId}`.
- `asset-metadata` remains keyed by network and shared. It is chain data and
  can be reused by profiles on the same network.
- `tx-cache.ts` (`arkade_tx_timestamps`) remains global unless a concrete
  collision is found. Ark txids are treated as globally unique.
- `importedAssetIds` moves into profile metadata. Asset screens and send
  flows read from the active profile.

### 10. UI, Navigation, and Wallet Selection

The UI must make one fact obvious: only one profile is active, and dormant
profiles are cached switch targets.

#### Route Model

Extend `RootStackParamList` with explicit profile-management routes:

```ts
WalletPicker: { mode?: "initial" | "modal" } | undefined;
WalletRename: undefined;
ProfileReset: { walletId: string };
FullReset: undefined;
AddWalletLanding: undefined;
AddWalletIntroCarousel: undefined;
AddWalletRestore: undefined;
AddWalletRestoreBackupPassword: { envelope: EncryptedEnvelope };
```

Keep the no-wallet routes separate from add-wallet routes:

- `Landing`, `IntroCarousel`, `RestoreWallet`, and `RestoreBackupPassword`
  are only for a clean install with no profiles.
- `AddWalletLanding`, `AddWalletIntroCarousel`,
  `AddWalletRestore`, and `AddWalletRestoreBackupPassword` are only for adding
  a profile while profiles already exist.
- The add-wallet routes may reuse components, but route names, titles, and
  completion behavior must stay distinct so the back stack and copy are
  predictable.

Root route gate:

- `wallets.length === 0`:
  - `Landing`
  - `IntroCarousel`
  - `RestoreWallet`
  - `RestoreBackupPassword`
- `security.isLocked`:
  - `Unlock`
- `wallets.length > 0 && !security.isLocked && activeWalletId == null`:
  - `WalletPicker` as the initial route
  - no `Main` route mounted
  - no back affordance on the initial picker
  - add-wallet routes may be mounted
  - `FullReset` may be mounted only for explicit navigation from a destructive
    entry point; do not surface it as the default recovery choice
- `wallets.length > 0 && !security.isLocked && activeWalletId != null`:
  - `Main`
  - active-wallet routes
  - `WalletPicker`
  - `WalletRename`
  - `ProfileReset`
  - `FullReset`
  - add-wallet routes

Key active-wallet route groups by `activeWalletId`:

- key `RootTabs` by `activeWalletId`
- put Send / Receive / Activity / Assets / VTXO / Profile detail routes in a
  `Stack.Group` keyed by `activeWalletId`
- when `activeWalletId` changes or becomes null, old active-wallet screens
  unmount instead of retaining stale route params

On successful switch:

- reset the navigation stack to `Main`
- do not preserve Send / Receive / Activity / ActivityDetails params from the
  prior profile
- hide the switch overlay only after the route reset is scheduled

On active reset with survivors:

- set `activeWalletId = null`
- reset the navigation stack to initial `WalletPicker`
- do not auto-open a survivor

#### WalletPicker

Create a dedicated `WalletPicker` screen. It has two modes:

- `initial`: used when profiles exist but no active profile is open
- `modal`: opened from WalletScreen / ProfileScreen while an active profile is
  available

Rows show:

- label
- network badge
- short id
- active profile marker
- balance
- "Live" for the active profile balance
- "Last known" / "Updated when opened" for dormant profile balances
- pending swap count when nonzero
- "Monitoring paused" on dormant rows with pending swaps
- server error badge if the profile failed the last probe

Pending counts for dormant rows are loaded with
`getPendingSwapCountForWallet(walletId)` and should not initialize a dormant
runtime. Failed count reads hide the count rather than blocking the picker.

Actions:

- Tap active row:
  - in `modal` mode, close the picker
  - in `initial` mode, no-op; there should be no active row in this state
- Tap dormant row:
  - if a foreground wallet operation is busy, keep the row disabled
  - if the current active profile has pending swaps, show the pause warning
    before switching
  - call `switchWallet(id)` only after confirmation
- No delete affordance on dormant rows. To delete a dormant profile, switch to
  it first.
- `+ Add Wallet` opens `AddWalletLanding` and is disabled while the foreground
  operation gate is busy.

Pause warning copy:

- title: `Pause swap monitoring?`
- body: `Swap monitoring for <label> will pause until you open it again.`
- primary action: `Switch`
- secondary action: `Stay`

The warning is based on the profile being left, not the target profile.

#### Switch Overlay

Render the transient `walletSwitch` state as a blocking overlay above the app:

- "Stopping current wallet..."
- "Connecting to <label>..."
- "Opening <label>..."
- "Refreshing <label>..."
- "Resuming swaps..."

The overlay blocks navigation, tab presses, and destructive actions. It must
not expose cancel; switch teardown / rebuild is not safely cancellable once the
runtime generation has been invalidated.

Switch failure UX:

- if the prior profile was rebuilt, stay on / return to the prior active
  profile and show the target profile's error
- if no profile could be opened, route to initial `WalletPicker`
- the target row shows its server error badge

#### Profile and Wallet Entry Points

WalletScreen:

- make the balance / network header open `WalletPicker` in `modal` mode
- show active profile label near the network badge or account summary
- disable the switch affordance while the foreground operation gate is busy

ProfileScreen:

- show active label, short id, and network badge in the user section
- add a `Switch wallet` row that opens `WalletPicker`
- add a `Rename wallet` row or inline affordance that opens `WalletRename`
- keep Backup, Recovery, Preferences, and Lock Wallet entries
- replace `Reset Wallet` with `Reset active wallet`
- add `Full reset` as a separate destructive row
- disable `Reset active wallet` when there is no active wallet, when only one
  profile exists, or while the foreground operation gate is busy
- disable `Full reset` while the foreground operation gate is busy

#### Rename

Add `WalletRename` as a modal route or in-place edit on ProfileScreen:

- initialize from the active profile label
- trim on save
- reject empty labels
- reject labels longer than 32 graphemes
- uniqueness is not required
- call `renameWallet(activeWalletId, label)`
- show the short id in the screen so duplicate labels remain understandable
- return to ProfileScreen after save

#### Add Wallet

Add-wallet flows are available only after the app is unlocked.

`AddWalletLanding`:

- offers create-new, restore seed/private key, and restore backup file
- returns to `WalletPicker` / `Main` on back depending on how it was opened

Create / seed restore:

- render the M16 `NetworkSelector` as controlled local route state
- do not write a global network choice
- pass the selected network to `createWallet(kind, network)` or
  `restoreWallet(input, network)`
- on success, reset the stack to `Main`

Backup import:

- do not render `NetworkSelector`
- the backup payload's `wallet.network` is the source of truth
- use `AddWalletRestoreBackupPassword` for additive import when profiles
  already exist
- on success, reset the stack to `Main`

#### Reset Screens

`ProfileReset`:

- route params include the captured active `walletId`
- on mount, capture label / short id / network for display
- compute backup and pending-swap gates for that wallet id only
- before submit, verify the same wallet is still active and there is a
  survivor profile
- call `resetActiveWallet(walletId)`
- on success, reset the stack to initial `WalletPicker`

`FullReset`:

- route has no wallet id param
- show wallet count and whole-app destructive copy
- do not run backup-health, pending-swap, or recovery-scan checks
- call `fullReset()`
- on success, reset the stack to Landing

### 11. Screen Migration Rules

Replace direct `state.wallet` usage with `useActiveWallet()` or
`getActiveWallet()` in screens, hooks, and services.

Avoid `state.wallets.find(...)` outside store helpers. Keeping active-profile
lookup centralized makes the `activeWalletId == null` recovery state and future
profile normalization testable.

Replace direct global network reads with active profile reads:

- `activeWallet.detectedNetwork ?? activeWallet.network`
- `activeWallet.arkServerUrl`
- `activeWallet.serverInfo`
- `activeWallet.serverStatus`
- `activeWallet.serverLastError`

Replace direct `state.walletBehavior` with active profile behavior.

Replace direct `state.assets.importedAssetIds` with active profile
`importedAssetIds`.

Screens that need focused migration:

- `RootStack`
- `RootTabs`
- `WalletScreen`
- `ProfileScreen`
- `ProfileBackup`
- `ProfileRecovery`
- `ProfileReset`
- `RestoreWallet`
- `RestoreBackupPasswordScreen`
- Send screens
- Receive screens
- Activity / ActivityDetails
- Asset screens
- VTXO screens

Every active-wallet screen should either unmount via the active-wallet
navigation key or explicitly guard against `activeWalletId` changing while it
is mounted.

Replace `LightningResumeTrigger` consumers with the expanded
`"startup" | "unlock" | "foreground" | "switch"` union. A switch-triggered
resume should not update a profile if the active id changed while it was
running.

### 12. Diagnostics and Support Bundle

The support bundle currently assumes one wallet, one network slice, one
walletBehavior slice, and unscoped Boltz rows. Multi-profile support must make
diagnostics active-profile scoped and aggregate-only for dormant profiles.

Bump `BUNDLE_SCHEMA_VERSION` to `2`.

#### Bundle Shape

Replace the single-wallet assumptions with:

```ts
type SupportBundleV2 = {
  schemaVersion: 2;
  generatedAt: number;
  app: ExistingAppBlock;
  storeSchemaVersion: number;
  wallets: {
    total: number;
    activeWalletId: string | null;
    activeWalletIdPrefix: string | null;
    activeLabel: string | null;
    activeNetwork: string | null;
    byNetwork: Record<string, number>;
    dormantCount: number;
  };
  activeProfile: ActiveProfileDiagnostics | null;
  preferences: ExistingPortablePreferencesBlock;
  assets: {
    activeImportedAssetIdCount: number;
    activeNonZeroBalanceCount: number;
    cachedMetadataCount: number;
  };
  vtxos: ExistingVtxoSummary | null;
  recovery: ActiveProfileRecoveryDiagnostics | null;
  swapStorage: {
    activeMetadataCount: number;
    activeBoltzSwapCounts: Record<string, number>;
    activeNonTerminalSwapCount: number;
    orphanBoltzSwapCount: number;
    orphanBoltzSwapIdPrefixes: string[];
  };
  backgroundTasks: {
    swapPoll: BgTaskMetrics;
    activeTarget: {
      walletIdPrefix: string;
      network: string;
      updatedAt: number;
    } | null;
    retainedResultCountsByWalletPrefix: Record<string, number>;
  };
  errors: ErrorEntry[];
};
```

`activeProfile` contains only the open profile:

- `present`
- `id` and `idPrefix`
- `label`
- `network`
- `identityKind`
- `hasMnemonic`
- `hasPrivateKey`
- `esploraOverride`
- profile `behavior`
- profile server probe state:
  - `arkServerUrl`
  - `detectedNetwork`
  - `serverStatus`
  - redacted `serverLastError`
  - `serverInfo` summary when available
- `lightningSupported`
- `lightningRestore`
- `lightningResume`
- backup health:
  - `lastBackupAt`
  - `dirtyForBackup`
  - `hasBackupMaterial`
  - `isStale`

Do not include dormant profile labels, balances, addresses, activities,
secrets, or raw swap ids. Dormant profiles are represented only by aggregate
counts unless they become active.

#### Collection Rules

Support bundle collection must not initialize dormant runtime state.

- Use `getActiveWallet()` / active profile selectors instead of `state.wallet`.
- Use active profile server fields instead of `state.network`.
- Use active profile `behavior` instead of `state.walletBehavior`.
- Use active profile `importedAssetIds` instead of `state.assets`.
- If `activeWalletId == null`, set `activeProfile`, `vtxos`, and `recovery` to
  `null`; still report wallet aggregate counts and background task state.
- Active VTXO and recovery scans may use the active runtime only when available.
  If the active runtime is unavailable, record a redacted diagnostic error and
  return `null` for that block.
- Activity counts use `activeProfile.activities` only.
- Swap metadata count uses scoped metadata for `activeWalletId`.
- Boltz counts use `snapshotBoltzSwapsForWallet(activeWalletId)`, never the
  unscoped `snapshotBoltzSwaps()`.
- Non-terminal count uses `getPendingSwapCountForWallet(activeWalletId)` or
  the scoped Lightning helper.
- Orphan rows use `findOrphanBoltzSwapIds(limit)` and report:
  - total count
  - redacted id prefixes only
  - never full swap ids
- Background target uses `readActiveSwapWallet()` and redacts wallet id to a
  prefix.
- Retained shadow result counts may be grouped by wallet id prefix; do not
  include task result payloads.
- Recent errors stay redacted through the diagnostics recorder.

#### Files to Update

- `app/services/diagnostics/bundle.ts`
- `app/services/diagnostics/bg-task-metrics.ts` only if metrics become
  wallet-scoped
- `app/services/diagnostics/recorder.ts` only if new categories are needed
- `app/screens/ProfileRecovery.tsx` / support-bundle triggers if they display
  bundle fields
- `docs/TESTING.md` if support-bundle generation instructions reference the
  old single-wallet fields

Add diagnostics tests in:

- `app/services/diagnostics/__tests__/bundle.test.ts`

Required diagnostics tests:

- no profiles: bundle reports `wallets.total = 0`, `activeProfile = null`,
  and does not call active runtime helpers
- profiles exist with `activeWalletId = null`: bundle reports aggregate wallet
  counts but no active profile / recovery / vtxo blocks
- active A and dormant B: bundle reports active A details, aggregate
  `byNetwork`, and no dormant B label / balance / activity data
- active swap counts use scoped A rows and ignore B rows
- orphan central Boltz rows are counted and reported only by redacted prefixes
- background active target is reported from `readActiveSwapWallet()` with
  wallet id prefix only
- retained background result counts are grouped by wallet prefix without
  exposing payloads
- active runtime helper failure records a redacted error and leaves the
  affected block null

## Automated Tests

Keep the broad test matrix, but organize implementation work by file ownership
so each batch can land with focused regression coverage.

Test placement:

- `app/store/__tests__/useAppStore.test.ts`: profile state, selectors,
  operation gate, switching, reset, backup health side effects
- `app/services/arkade/__tests__/swap-storage.test.ts`: ownership metadata,
  scoped repository helpers, orphan reporting, scoped clear/snapshot helpers
- `app/services/arkade/__tests__/swap-background.test.ts`: active background
  target, task context capture, active-scoped repository, result attribution,
  profile-scoped drain/retention
- `app/services/backup/__tests__/serializer.test.ts`: payload versions,
  nullable metadata projection, duplicate-id rejection, v1/v2 normalization
- `app/store/__tests__/backup-import.test.ts` or store tests: additive import,
  collision preflight, rollback, backup-health attribution
- `app/services/diagnostics/__tests__/bundle.test.ts`: support bundle v2 shape
  and active-profile scoping
- `app/__tests__/navigation-multi-profile.test.tsx`: route gates, picker
  modes, stack reset on switch/reset, reset/full-reset screen behavior
- Existing Send / Receive / Activity / Asset / VTXO tests: update fixtures and
  add focused stale-active-wallet guards where those screens call runtime
  helpers

Verification command set before the milestone is complete:

- `pnpm test`
- `pnpm check`

If the full suite becomes slow or flaky during implementation, use targeted
Jest paths while developing, but the final milestone pass requires the full
commands above.

### Store

- `createWallet` with no profiles appends and sets `activeWalletId`.
- `createWallet` with one profile appends and switches active profile.
- `restoreWallet(input, network)` from mnemonic / nsec / hex defaults label
  to the next `"Wallet {n}"`.
- `importBackup` preserves `payload.wallet.label`.
- `useActiveWallet()` / `getActiveWallet()` return the profile matching
  `activeWalletId`, and return `null` when the id is null or missing.
- Profile updates replace only the target `wallets[]` entry and preserve
  device-scoped preferences, security, and background task settings.
- `setWalletBehavior`, `importAsset`, `forgetAsset`, `markBackupCompleted`,
  and `markDirtyForBackup` affect only the active / named profile.
- `renameWallet(id, "  Demo  ")` trims and marks that profile dirty.
- Empty / over-limit rename is rejected.
- Hydrate with missing `activeWalletId` falls back to first profile.
- Hydrate with no profiles leaves `activeWalletId = null`.
- Hydrate normalizes missing per-profile `behavior`, `importedAssetIds`, server
  probe fields, and `assetBalances`.
- Hydrate of schema `6` sets `_schemaMismatch` and does not attempt to migrate
  old top-level `wallet`, `network`, `walletBehavior`, or `assets` fields.
- `resumeLightning("switch")` records resume state on the target active profile
  and drops the write if the active profile changes before completion.
- `beginWalletOperation(kind)` captures the active wallet id and returns an
  opaque token; `finishWalletOperation(token)` clears only that token.
- `withActiveWalletOperation(kind, fn)` clears the operation token in `finally`
  when `fn` throws.
- `switchWallet` while foreground gate is busy throws `wallet_busy`, leaves
  state unchanged, and does not dispose runtime.
- Foreground operations hold the gate through final refresh / persist and
  clear it in `finally`.
- `sendArkade`, `sendLightning`, `sendOnchain`, `sendChainSwap`,
  `runRecoveryAction`, asset mutations, behavior updates, create / restore /
  import, active reset, and pull-to-refresh enter the operation gate before
  touching runtime services.
- Direct receive-invoice actions used by fixed Lightning receive and LNURL
  receive enter the operation gate and record metadata against the captured
  wallet id.
- Fee-preview helpers that call `ensureWallet()` drop their result if the
  active wallet changes before the preview resolves.
- Runtime generation increments on switch start before disposing the current
  runtime.
- Delayed swap-event refresh, incoming-funds refresh, app-state foreground
  resume, and LNURL invoice callbacks drop writes when wallet id or runtime
  generation no longer match.
- `lightningResumeInFlight` is reused only when wallet id and runtime
  generation both match; switch start clears any existing in-flight resume.
- `switchWallet(b)` disposes prior runtime, probes B, ensures B, refreshes B,
  then atomically sets active id to B and persists once.
- `switchWallet(b)` does not persist `activeWalletId = b` when probe,
  `ensureWallet`, `ensureLightning`, or snapshot refresh fails.
- `switchWallet(b)` failure records B's server error state while keeping A
  active if A can be rebuilt.
- `switchWallet(b)` failure sets `activeWalletId = null` only if the prior
  active profile cannot be rebuilt.
- `switchWallet(b)` schedules `resumeLightning("switch")` only after B has
  been committed as active.
- `switchWallet(unknownId)` throws with state unchanged.
- No store action accepts a dormant wallet id for deletion.
- `resetActiveWallet(activeId)` rejects when `activeId` is no longer the
  current active wallet.
- `resetActiveWallet(activeId)` rejects when no survivor profile exists.
- `resetActiveWallet(activeId)` with a survivor deletes only activeId's
  profile data, sets `activeWalletId = null`, removes the active background
  target, and routes to WalletPicker without opening a survivor.
- `resetActiveWallet(activeId)` leaves surviving profiles, preferences,
  security, diagnostics, and shared metadata intact.
- `fullReset()` clears every profile, every wallet secret, central swap state,
  background task state, persisted diagnostics, app storage, and routes to
  Landing.
- `fullReset()` is blocked or disabled while the foreground operation gate is
  busy.
- `markBackupCompleted(walletId)` and `markDirtyForBackup(walletId)` affect
  only that profile.

### Swap and Background Services

- `claimSwapOwnership(walletA, swap1)` inserts a minimal metadata row with
  `wallet_id = walletA`.
- `claimSwapOwnership(walletA, swap1)` is idempotent when the row already
  belongs to wallet A.
- `claimSwapOwnership(walletB, swap1)` throws / records `swap_owner_conflict`
  when the row belongs to wallet A.
- `recordSwapMetadata(walletA, swap1, details)` fills projection fields without
  changing the owner.
- `recordSwapMetadata(walletB, swap1, details)` rejects when swap1 belongs to
  wallet A.
- `linkSwapToWalletTx(walletA, swap1, txid)` updates only wallet A's row.
- `linkSwapToWalletTx(walletB, swap1, txid)` fails without changing wallet A's
  linkage.
- Scoped swap repository returns only rows owned by the requested wallet id.
- Scoped repository preserves caller filters / ordering while applying wallet
  ownership filtering.
- Orphan `boltz_swaps` rows with no metadata are not returned by scoped reads.
- `saveSwap()` through `createWalletScopedSwapRepository(walletA)` saves the
  central row and claims ownership for wallet A before the row can be returned
  by scoped reads.
- `saveSwap()` through a wallet B scoped repository for a swap already owned by
  wallet A throws an owner-conflict error.
- `clear()` on a scoped repository deletes only wallet-owned rows and leaves
  other profiles' rows intact.
- Foreground Lightning setup receives a repository scoped to active wallet id.
- `createLightningInvoice`, `sendLightningPayment`, `createArkToBtcChainSwap`,
  `restoreLightningActivity`, `refreshSwapsStatus`, and
  `getNonTerminalSwapCount` use only the active wallet's scoped repository.
- New receive / send / chain-swap creation does not lose the just-created row
  before metadata details are filled.
- `getLightningActivitySources(walletId)` returns scoped Boltz rows and scoped
  metadata even when Lightning is not initialized.
- Activity merge never shows a central row owned by another wallet.
- Activity merge never shows an orphan central row.
- Activity merge tolerates owned metadata rows with null flow / direction /
  amount projection fields and falls back to the Boltz swap shape where
  possible.
- Recovery scan sees only swaps owned by the requested wallet id.
- By-id recovery / refund helpers reject swaps not owned by the active wallet.
- `rememberSwapBackgroundWallet(activeA)` writes `ACTIVE_WALLET_KEY` for A only
  after A has been committed active and Lightning setup succeeds.
- Switch from A to B updates `ACTIVE_WALLET_KEY` to B only after B is committed
  active and Lightning setup succeeds.
- Switch failure from A to B leaves `ACTIVE_WALLET_KEY` pointing at A when A is
  rebuilt successfully.
- Lightning-unsupported active profiles remove `ACTIVE_WALLET_KEY` and do not
  process swaps in the background.
- `forgetSwapBackgroundWallet(walletA)` removes `ACTIVE_WALLET_KEY` only when
  it currently points at wallet A.
- Background task context captures wallet id / network once per task execution.
- Background identity factory, active-scoped repository, result attribution,
  and persisted errors all use the same captured task context.
- Background active-scoped repository fails closed when no task context or
  active wallet exists.
- Background active-scoped repository does not cache wallet id across task
  executions.
- Background task repository reads through the captured active wallet context
  and filters through that wallet's metadata.
- Background results record `walletId`, `network`, active-wallet updated time,
  task start time, recorded time, and notification state.
- Background result recording does not infer wallet id from a fresh
  `ACTIVE_WALLET_KEY` read after processing.
- `drainSwapPollResultsForWallet(walletA)` returns only A results and writes B
  results back to the recent-results shadow log.
- `drainSwapPollResultsForWallet(walletB)` later returns retained B results.
- Foreground resume summaries and toasts include only drained results for the
  active wallet.
- Retention cap keeps newest results without allowing one profile to evict all
  retained results for another profile.
- Dormant profile pending swaps are not processed while another profile is
  active.
- Switching back to a dormant profile with pending swaps resumes only that
  profile's swaps.
- `resetActiveWallet(walletA)` clears retained recent results for A, removes
  `ACTIVE_WALLET_KEY` when it points at A, and keeps retained results for
  surviving wallets.
- After active reset with survivors, the background poll fails closed until a
  survivor is explicitly opened.
- `fullReset()` unregisters the task and clears `ACTIVE_WALLET_KEY`, queue
  inbox/outbox/config, recent result shadow log, and background task metrics.
- `clearSwapsForWallet(walletId)` deletes only joined rows for that profile.
- `snapshotBoltzSwapsForWallet(walletId)` exports only joined rows for that
  profile.
- `getPendingSwapCountForWallet(walletId)` works for dormant profiles.
- `getBackupHealth(walletId)` uses scoped metadata and scoped Boltz timestamp.
- `getLatestBoltzSwapWriteAtForWallet(walletA)` ignores newer central rows
  owned by wallet B.
- `findOrphanBoltzSwapIds(limit)` reports central rows with no metadata row,
  redacted at the diagnostics layer.

### Backup

- Existing single-wallet backup fixtures still parse.
- v1 and v2 backup payloads normalize into the current in-memory payload shape.
- Current payload export writes the current payload version and includes
  nullable swap projection fields when metadata ownership rows are incomplete.
- Current payload parsing rejects duplicate `swapMetadata.swapId` values.
- Current payload parsing rejects duplicate `boltzSwaps[].id` values.
- Export for wallet A contains only A's metadata rows and A's joined Boltz
  rows, even when wallet B has newer central rows.
- Export for wallet A reads A's `behavior` and `importedAssetIds`, not the
  active wallet's fields.
- Export for a dormant wallet does not initialize or switch runtime.
- `exportBackup(walletA, password)` returns `walletId = walletA`; saving /
  sharing the prepared file calls `markBackupCompleted(walletA, createdAt)`
  even if the active wallet changes before dispatch completes.
- Cancelled save/share leaves wallet A's `dirtyForBackup` unchanged.
- Import rejects duplicate wallet ids already present in `wallets`.
- Import rejects invalid or over-limit payload labels.
- Import rejects a payload whose wallet `identityKind` disagrees with the
  secret kind.
- Import rejects unsupported `wallet.network` values before saving secrets or
  swap rows.
- Import rejects server network mismatch before saving secrets or swap rows.
- Import rejects swap metadata rows whose wallet id differs from payload wallet
  id.
- Import rejects Boltz rows whose ids are absent from payload swap metadata.
- Import rejects incoming swap ids that already exist in `trixie_swap_meta`.
- Import rejects incoming swap ids that already exist as orphan central
  `boltz_swaps` rows.
- Import accepts metadata-only swap rows when no matching Boltz row is present.
- Import restores metadata with ownership-preserving inserts and restores Boltz
  rows through a wallet-scoped helper.
- Additive import appends the imported profile, switches active only after
  runtime build and first snapshot refresh succeed, and persists once.
- Additive import revalidates wallet-id and swap-id uniqueness after acquiring
  the foreground operation gate.
- Additive import leaves existing device preferences, security, notifications,
  biometrics, and background task settings unchanged.
- Clean-install import applies portable payload preferences while preserving
  device-local notification / security defaults.
- Import initializes the imported profile's backup health as
  `lastBackupAt = backupCreatedAt` and `dirtyForBackup = false`.
- Import rollback clears only the imported profile's scoped rows, retained
  background results, and secret.
- Import rollback does not call `clearAllSwaps()` and does not delete existing
  profiles' swap rows.
- Import rollback rebuilds the prior active runtime if it was disposed.
- Post-commit Lightning restore failure records profile restore state without
  rolling back the imported profile.

### Navigation and UX

- No profiles routes to Landing.
- Locked profiles route to Unlock.
- Profiles with `activeWalletId == null` route to initial WalletPicker without
  mounting Main.
- Profiles with active id route to Main and active-wallet routes.
- Active-wallet route groups and RootTabs remount when `activeWalletId`
  changes.
- Switch from Send / Receive / Activity / ActivityDetails resets the stack to
  Main and drops prior profile params.
- Switch overlay blocks navigation and destructive actions through all stages.
- Switch failure with prior rebuild keeps / restores prior profile and shows
  target error.
- Switch failure with no rebuildable profile routes to initial WalletPicker.
- WalletPicker modal closes when tapping the active row.
- WalletPicker initial mode has no back affordance.
- WalletPicker marks dormant balances as last-known / updated when opened.
- WalletPicker loads dormant pending counts without initializing dormant
  runtime.
- WalletPicker shows paused-monitoring copy for dormant profiles with pending
  swaps.
- WalletPicker has no dormant-profile delete affordance.
- Switch away from an active profile with pending swaps shows the pause warning
  for the profile being left.
- `+ Add Wallet` opens add-wallet routes and is disabled while the foreground
  operation gate is busy.
- Clean-install restore routes and add-wallet restore routes are distinct.
- Seed/private-key add-wallet flow passes controlled network state to
  create/restore actions without writing a global network choice.
- Backup import flow renders no NetworkSelector and uses payload network.
- Add-wallet success resets the stack to Main.
- Profile shows active label, short id, network badge, Switch wallet, Rename
  wallet, Backup, Recovery, Preferences, Lock Wallet, Reset active wallet, and
  Full reset entries.
- WalletScreen balance / network header opens WalletPicker modal.
- Rename trims labels, rejects empty / over-limit labels, allows duplicates,
  marks only the active profile dirty, and returns to Profile.
- Profile shows `Reset active wallet` and `Full reset` as separate destructive
  actions.
- `Reset active wallet` is disabled / rerouted when only one profile exists.
- `ProfileReset` captures the active wallet id on entry and aborts final
  confirmation if the active wallet changed before submit.
- `ProfileReset` shows backup and pending-swap checks for only the captured
  active wallet.
- `Full reset` screen shows wallet count and whole-app destructive copy.
- `Full reset` does not call backup-health, pending-swap, or recovery-scan
  checks.
- Busy foreground operation disables switch, Add Wallet, Reset active wallet,
  and Full reset controls.

## Manual Verification

1. Existing v6 install hits schema mismatch modal and wipes after user
   confirmation.
2. Create Mutinynet profile A. Label defaults to "Wallet 1"; balance is live.
3. Add Bitcoin profile B. Label defaults to "Wallet 2"; B becomes active.
   A appears in picker with last-known balance.
4. Switch A / B repeatedly. Only one runtime is live; UI network, addresses,
   Activity, and send / receive screens match active profile.
5. Start a foreground send, then open picker. Switch controls are disabled
   until send refresh / persist completes.
6. Create a Lightning receive on A, switch to B after foreground creation
   completes. Picker warns that A swap monitoring will pause. Switch back to
   A and verify resume updates the swap.
7. Background the app with A active, wait, return, unlock. Only A's background
   results are drained and toasted.
8. Switch to B. Background poll target changes to B. A's dormant rows remain
   durable but paused.
9. Verify WalletPicker has no delete affordance for dormant A.
10. Switch back to A. Export A's backup. Decrypt with helper and verify Boltz
    rows are only A's.
11. Switch to B. Reset active B with A remaining. The app lands on WalletPicker
    with no active wallet; A remains available but is not opened automatically.
12. Open A from WalletPicker. Background poll target changes back to A.
13. Import A's backup onto a device with B. A is appended and selected; B
    preferences and security are unchanged.
14. Attempt to import the same backup again. Duplicate wallet / swap ids are
    rejected and existing profiles remain unchanged.
15. Rename a profile. Picker and backup screen show the new label. Generate a
    support bundle and verify it is schema v2, reports the renamed active
    profile, includes aggregate wallet counts, and does not include dormant
    profile labels or raw swap ids.
16. Corrupt B's Ark server URL in a fixture with A and B. Switch from A to B
    fails, A is rebuilt and remains usable.
17. Enter Full reset. Confirm the screen shows the wallet count and whole-app
    destructive warning. Pressing the destructive button routes to Landing and
    clears background task state.

## Resolved Decisions

1. Trixie remains a single-wallet runtime. Cached profiles are dormant
   snapshots, not concurrently managed accounts.
2. Background swap management follows the active profile only.
3. Pending dormant-profile swaps are durable but paused until that profile is
   opened.
4. The central `boltz_swaps` table is acceptable only behind scoped repository
   views and `trixie_swap_meta.wallet_id` attribution.
5. Switches are blocked only by active foreground operations, not by durable
   pending swaps. Pending swaps trigger pause-warning copy.
6. Network is per profile. There is no global network slice.
7. Password and biometrics are device-scoped.
8. Backup is one profile per file. Import appends and switches.
9. Reset has only two user paths: reset the active wallet when survivors
   exist, or full reset all local wallet state.
10. Schema `6 -> 7` uses wipe-on-mismatch. No migration code.
