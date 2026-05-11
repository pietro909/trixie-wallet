# Milestone 10: Assets support

**Status:** Delivered (2026-05-11). All phases landed; pending manual verification per the *Verification Plan* below.

Goal: Add support for custom Arkade-native assets across activity rendering,
balance breakdown, and the full lifecycle (send, receive, mint, reissue, burn).

This milestone should prove:
- Assets show in the activities list (sent, received, minted, burned, …)
  with name + ticker + icon when metadata is available.
- Asset details (name, ticker, decimals, icon, supply) are shown in the
  Activity details view.
- Assets are shown in the balance breakdown on the Wallet screen.
- Asset operations are supported: send, receive, mint (issue), reissue
  (control-asset-gated), burn.
- Feature parity with the sibling `../wallet` app for asset flows.

## Current State

The asset data path is already plumbed end-to-end at the activity layer but
stops short of UI rendering, balance breakdown, and outbound operations.

What exists today:

- **Activity classifier** in `app/services/arkade/activity-history.ts`
  decodes `VirtualCoin.assets` into `Asset[]` deltas
  (`collectAssets`, `subtractAssets`, `assetDeltas` — lines 28–77) and
  classifies them into five categories:
  `asset_issued | asset_burned | asset_sent | asset_received | asset_activity`
  (`classifyAssetActivity`, lines 184–208).
- **Activity builder** `buildAssetActivity` (lines 231–266) emits one
  Activity per asset-bearing arkTxid with `kind: "wallet_event"`,
  `rail: "arkade"`, and a `metadata` bag containing `arkTxid`, `assetId`,
  `assetAmount` (lossy: first asset only, `Number(bigint)`),
  `anchorAmountSats`, and `classification`.
- **Details rendering** in
  `app/services/activity-details/buildSections.ts:472–507` already shows
  asset id, asset amount, anchor sats, and classification — no name,
  ticker, decimals, or icon.
- **List rendering** in `app/screens/ActivityScreen.tsx:71–121` shows the
  generic title (`"Asset sent"` etc.) and renders `amountSats` (which for
  asset rows is the anchor-sat dust, not the asset quantity).
- **Wallet snapshot** in `app/services/arkade/runtime.ts:31–43` captures
  only BTC balance fields (`available, total, settled, preconfirmed,
  boardingTotal`); `WalletBalance.assets` (`@arkade-os/sdk` type field) is
  read by `wallet.getBalance()` but dropped on the floor.
- **Store metadata** `ArkadeWalletMetadata` in `app/store/types.ts:73–94`
  carries only BTC `balanceSats / balanceTotalSats / balanceBoardingSats`.
  No asset-bearing fields.
- **Activity type** in `app/store/types.ts:25–37` has no dedicated asset
  fields — asset info lives in the free-form `metadata` bag.
- **Send flows** under `app/screens/send/` parse only BTC + Lightning
  payment inputs; no asset selection, precision handling, or BIP21
  `assetid` decoding.
- **Receive flows** under `app/screens/receive/` generate the shared
  Arkade address with no per-asset annotation.
- No mint, burn, or reissue surface anywhere.
- No asset metadata cache, no icon approval gate, no asset registry.
- `app/store/mock.ts` carries only fiat rates — no mock assets.

Grep coverage: outside `activity-history.ts` and
`activity-details/buildSections.ts`, "asset" appears nowhere. The Wallet
screen, Send screens, Receive screens, and ProfileScreen surface have
zero asset awareness today.

## SDK Surface Available Now

Confirmed from `node_modules/@arkade-os/sdk/dist/types/` against version
shipped in trixie's `package.json`.

### Asset types (`wallet/index.d.ts`)

- `Asset` (line 256): `{ assetId: string; amount: bigint }`. Amounts are
  always `bigint` — `Number.MAX_SAFE_INTEGER` is insufficient.
- `KnownMetadata` (290): partial `{ name, ticker, decimals (0–8), icon }`.
  `icon` is a string passable to `<img src>` — practically a data: or
  https: URL.
- `AssetMetadata` (308): `KnownMetadata & Record<string, unknown>` —
  arbitrary extension keys allowed, immutable post-issuance.
- `AssetDetails` (315): `{ assetId, supply: bigint, metadata?,
  controlAssetId? }`. `controlAssetId` presence implies the asset is
  reissuable.
- `IssuanceParams` (335) / `IssuanceResult` (349): `{ amount: bigint,
  controlAssetId?, metadata? }` → `{ arkTxId, assetId }`.
- `ReissuanceParams` (360): `{ assetId, amount: bigint }`. Requires the
  caller to hold the control asset; SDK does not validate up front.
- `BurnParams` (371): `{ assetId, amount: bigint }`.
- `WalletBalance` (204): includes `assets: Asset[]` in addition to BTC
  fields. Already returned by `wallet.getBalance()` — currently discarded
  in `runtime.ts:250`.
- `Recipient` (271): `{ address, amount?, assets? }`. **Same wallet
  address for BTC and any asset.** `wallet.send(recipients)` accepts
  asset-bearing recipients; no separate asset-send entrypoint.

### Asset manager (`wallet/asset-manager.d.ts`)

- `wallet.assetManager: IAssetManager`
  (`@arkade-os/sdk/wallet/expo/wallet.d.ts:98` for `ExpoArkadeWallet`,
  the implementation trixie uses).
- `getAssetDetails(assetId): Promise<AssetDetails>` — hits the indexer.
- `issue(params): Promise<IssuanceResult>` — emits an Arkade tx.
- `reissue(params): Promise<string>` — returns arkTxId. Requires control
  asset in wallet.
- `burn(params): Promise<string>` — returns arkTxId.

### `ArkTransaction` and `VirtualCoin`

- `TxType` has only `TxSent` / `TxReceived` — asset txs are not a separate
  kind; presence of `assets?: Asset[]` on `VirtualCoin` is the signal.
- `Recipient.address` is the same Arkade address used for BTC. No per-asset
  address derivation.

### What the SDK does NOT provide

- No bulk asset list endpoint (no `getAssets()`); discovery is wallet-driven
  via `WalletBalance.assets` plus user-imported asset ids.
- No on-chain icon hosting; icons are inline strings in metadata
  (typically `data:` or `https://` URLs), trusted at the wallet's
  discretion.
- No network gating: same APIs across `bitcoin / signet / mutinynet /
  regtest`. The server decides whether asset issuance is allowed.

## Sibling Wallet Patterns Worth Inheriting

`../wallet` (web, same SDK) is the canonical asset surface. Patterns to
mirror, adapted to React Native:

- **Per-asset metadata cache with TTL.** `../wallet/src/lib/storage.ts`
  caches `AssetDetails` for 24 h
  (`ASSET_METADATA_TTL_MS = 24 * 60 * 60 * 1000`), serialized with bigint
  coercion (`supply` is re-wrapped to BigInt on read). Trixie should
  back this with AsyncStorage under `trixie:asset-metadata:<networkName>`
  keyed by network + assetId so the same asset id on different networks
  does not collide.
- **Imported assets list.** The web wallet tracks user-imported asset
  ids in `config.importedAssets` so dust-only or zero-balance assets the
  user has minted/seen don't disappear after sweep. Mirror as
  `AppState.assets.importedAssetIds: string[]` (per-wallet scope).
- **Asset arithmetic helpers.** Lift `prettyAssetAmount`,
  `prettyAssetAmountHide`, `unitsToCents`, `centsToUnits`, `isValidAssetId`,
  `truncatedAssetId` from `../wallet/src/lib/assets.ts` into
  `app/services/arkade/asset-format.ts`. Keep them pure, no React.
- **Icon approval gate.** Sibling uses `AssetIconApprovalManager` to
  default-hide unverified icons (XSS via crafted `data:image/svg+xml,...`
  payloads is the threat model). Persist approval state per-asset; render
  the avatar fallback (first letter of ticker/name) until approved.
- **`AssetCard` + `AssetAvatar`.** Direct visual analogues. Trixie's
  version uses `expo-image` for the icon and falls back to a circle with
  the first letter of ticker/name when icon is missing or not approved.
- **Three-bucket asset display on Wallet.** BTC card + per-asset cards
  below it. Sibling renders `assetBalances ∪ importedAssets` then fetches
  missing metadata via `Promise.allSettled`.
- **Send form asset selector.** Asset dropdown built from
  `assetBalances + cached metadata`. Amount input switches to asset
  precision via `unitsToCents(amount, decimals)`. Asset-bearing sends
  validate that the destination is an Arkade address (not BTC, not
  Lightning). Sibling reference:
  `../wallet/src/screens/Wallet/Send/Form.tsx:148–246`.
- **Mint flow shape.** Inputs: name (≤ 40 chars), ticker (≤ 8), amount
  (positive bigint), decimals (0–8), icon URL, control mode
  (None / Existing / New). "Control: New" mints a 1-unit control asset
  first, then the actual asset. Reference:
  `../wallet/src/screens/Apps/Assets/Mint.tsx`.
- **Burn flow.** Single amount input, precision-aware, simple confirm.
  Reference: `../wallet/src/screens/Apps/Assets/Burn.tsx`.

## Product Rules

- Asset balances are display-and-spend, never editable. Metadata is
  immutable post-issuance per the SDK.
- Outbound operations (send, mint, reissue, burn) must require an
  unlocked wallet and a confirmation dialog naming the exact asset id,
  amount, and outcome.
- Asset amounts displayed to the user are always decimals-adjusted via
  `prettyAssetAmount(amount, decimals)`. Raw base-unit numbers are only
  shown in detail rows alongside the formatted value.
- The same Arkade address receives BTC and any asset. Do **not** invent
  per-asset addresses; do not derive new addresses for assets.
- Icon rendering is gated: unverified icons render as the letter
  fallback unless the user explicitly approves them. Provide a per-asset
  approve toggle in the asset detail view.
- Asset send is **Arkade-only**. Reject Lightning invoices and Bitcoin
  on-chain addresses when an asset is selected, with explicit user-facing
  copy. The sibling enforces this — same rule here.
- Asset metadata must be fetched lazily on the screens that need it, with
  a per-network cached store. Never block wallet hydration on metadata
  fetches.
- Persisted state must not store raw secrets, private keys, or
  invoices alongside asset records. Metadata is public; the cache is
  network-scoped and harmless to dump in the support bundle.
- Mint/reissue/burn emit arkade transactions; activity rows for these
  must be classified via the existing `activity-history.ts` pipeline
  (already handles `asset_issued` / `asset_burned` / `asset_sent` /
  `asset_received`) — no parallel activity surface.

## Decisions

- **Storage location for asset metadata cache:** AsyncStorage under
  `trixie:asset-metadata:<networkName>` (the canonical key used in
  Phase 1; do not introduce alternate names elsewhere in the codebase),
  JSON-serialized `Record<assetId, CachedAssetDetails>` with bigint
  coercion to/from string for `supply`. Not stored in the Zustand
  `AppState` slice (would balloon backup size with hex-heavy metadata
  and ties the cache to schema-version migrations).
- **`importedAssetIds` location:** new `AppState.assets` slice (NOT
  inside `ArkadeWalletMetadata`). The slice is persisted but excluded
  from the backup serializer's `wallet` envelope to keep wallet
  identity vs. preferences cleanly separated. The serializer can add
  its own pass-through if cross-device asset persistence becomes a
  user ask later.
- **Activity model:** keep `kind: "wallet_event"` for asset rows for
  v1 (already in place). Add an optional `assets?: Array<{ assetId,
  amount: string }>` field on `Activity` (string to survive JSON
  round-tripping; the renderer reconstructs `BigInt`). One Activity row
  per arkTxid, listing every asset delta the wallet observed in that
  tx — the row id stays `activityId("asset", arkTxid)`, which is
  collision-free because arkTxids are unique. Multi-asset transfers in
  a single tx render as a single list row with a "+N more" hint when
  the array has multiple entries; the details screen shows one block
  per asset.

  The "control + main" mint path looks like two assets, but the sibling
  implementation issues them as **two separate `wallet.assetManager.issue`
  calls** (control first, wait for VTXO update, then main —
  `../wallet/src/screens/Apps/Assets/Mint.tsx:117–142`). Two issue calls
  = two arkTxids = two Activity rows. So the "one row per arkTxid"
  invariant holds even for that flow, and there is no id collision.
- **Activity classification gain:** introduce `kind: "asset_op"` or
  keep `wallet_event`? **Keep `wallet_event`.** Asset rows naturally
  belong in the same "wallet event" lane as renewals/settlements; the
  finer-grained `classification` value already distinguishes them. A
  new top-level `kind` would require touching every consumer of
  `ActivityKind`. Revisit only if filtering by "show asset ops only"
  becomes a feature ask.
- **Network gating:** no UI gating in v1. The asset section on Wallet
  renders unconditionally; mint/burn/reissue are reachable on every
  network. Server-side rejection on networks that disable issuance
  surfaces as the standard error toast. (Easier to revisit than to
  retrofit a gate that has to look up server capabilities.)
- **Icon approval default:** unverified icons are **hidden** by
  default. Per-asset approve toggle in the asset detail view. No
  external "verified list" fetch in v1 — that's the sibling's
  `VITE_VERIFIED_ASSETS_URL` pattern and adds a network dependency we
  don't need on day one. Self-issued assets (where the user owns the
  control asset) auto-approve.
- **Reissue scope in v1:** show the action only when the local wallet
  holds the control asset. SDK does not validate up front; we do the
  check via `getAssetDetails(asset.assetId).controlAssetId` then
  cross-check against `assetBalances`. Hide the button when not
  satisfied, surface "Requires control asset" in the detail card.
- **Mint UI minimum bar:** require name + ticker + positive amount.
  Decimals defaults to `0`. Icon URL is optional and behind icon
  approval flow.
- **Send flow integration:** extend the existing
  `app/screens/send/` flow rather than fork a parallel asset-send flow.
  Asset selection happens on the existing entry/amount screen via a
  selector pinned above the amount input. Selecting an asset narrows
  destination validation to Arkade-only.
- **Mint/Burn/Reissue placement:** new screens under
  `app/screens/assets/` reached from the Wallet screen's asset cards
  (tap asset → asset detail → Mint more / Burn / etc.). Not under
  Profile (operational, not configurational).
- **Backup:** asset metadata cache stays device-local. Imported asset
  ids are user-intent data — include in the backup payload via the
  serializer so a restored wallet doesn't lose user-tracked assets
  with zero current balance. Bump the backup `PAYLOAD_VERSION` constant
  (`app/services/backup/serializer.ts:11`) from `1` to `2` and add a
  `BackupPayloadV2` shape with an `importedAssetIds: string[]` field.
  Accept v1 payloads transparently in `parseBackupPayload` by treating
  the missing field as `[]`. Keep `BackupPayloadV1` exported for the
  parser's discriminated union, but write only v2 going forward. The
  persisted store still does **not** bump `schemaVersion` — the
  Zustand slice normalizes on hydrate same as `backgroundTasks`.

## Recovery / Disaster Considerations

The Milestone 9 recovery surface needs an explicit change so asset-bearing
commitments stop firing the "Arkade settlement anomaly" rule, and a few
follow-ons:

- **Today's bug to fix as part of this milestone.**
  `activity-history.ts:515–539` emits an `"Arkade settlement"` activity
  for every commitment group, including `asset_bearing_settlement` rows
  (line 145). `recovery.ts:334–360` matches on `activity.title ===
  "Arkade settlement"` with non-zero `unresolvedAmountSats` and surfaces
  it as an anomaly — which the asset-bearing case is not.
  Fix it on the **recovery side** (not the activity side, to avoid
  hiding asset-bearing settlement rows from the Activity feed):
  add `if (md.settlementReason === "asset_bearing_settlement") continue;`
  to the loop. Skipping by `settlementReason` is more robust than by
  title and lets us add more skip reasons later. Track via a verification
  scenario: after a mint, ProfileRecovery should show **zero** anomalies.
- Asset-bearing pending-finalize rows continue to finalize via the
  existing `finalize_pending_tx` action; assets ride the same arkTxid
  as BTC funds and are not separately recoverable.
- Reset clears the asset metadata cache (network-scoped key), the
  icon-approval map, and the `importedAssetIds` slice via the existing
  `DEFAULT_STATE` reset path plus explicit cache wipes.

## Implementation Plan

### Phase 1 — Asset primitives & metadata cache

Add:

- `app/services/arkade/asset-format.ts` — pure helpers:
  `prettyAssetAmount(amount: bigint, decimals: number)`,
  `prettyAssetAmountHide(value, suffix)`,
  `unitsToCents(units, decimals)`,
  `centsToUnits(cents, decimals)`,
  `isValidAssetId(id)` (68-char hex test),
  `truncatedAssetId(id)`. Direct port from
  `../wallet/src/lib/assets.ts`.
- `app/services/arkade/asset-metadata.ts` — AsyncStorage-backed cache:
  - `readAssetMetadata(network, assetId): Promise<CachedAssetDetails | null>`
  - `writeAssetMetadata(network, details): Promise<void>`
  - `dropAssetMetadata(network, assetId): Promise<void>`
  - `clearAssetMetadata(network?): Promise<void>` (network-scoped or
    full wipe)
  - `readAssetMetadata(network, assetId)` — pure cache read, no
    network. Returns `null` on miss or TTL expiry. It still returns a
    Promise because AsyncStorage is async, so use it from `useEffect`
    preloaders and then pass the resulting in-memory map into render /
    `buildSections` code.
  - `fetchAssetDetailsCached(network, assetId, mode: 'cache' | 'fresh')` —
    `'cache'` means "read cache, then if missing **or expired** call
    `wallet.assetManager.getAssetDetails(assetId)` and write through";
    `'fresh'` means "always call the SDK and overwrite cache". Both
    modes can hit the network — `'cache'` skips it only when the
    cache entry is present and unexpired. Use this from `useEffect`
    paths (asset detail screen, send selector hydrate) where awaiting
    a network call is acceptable.
  - Storage key: `trixie:asset-metadata:<networkName>`.
  - Serialization: bigint→string for `supply`, restored on read.
  - TTL: 24 h matches sibling; expose `ASSET_METADATA_TTL_MS` for
    consumers to force-refresh.
- `app/services/arkade/asset-icon-approval.ts`:
  - `readIconApprovals(): Promise<Record<assetId, boolean>>`
  - `setIconApproval(assetId, approved): Promise<void>`
  - Storage key: `trixie:asset-icon-approval`. Cross-network on
    purpose — same icon, same trust decision.
  - Self-issued assets auto-approve via
    `markSelfIssued(assetId)` called from the mint success path.

Acceptance:
- Cache survives app restart, evicts on TTL, network-scoped.
- `unitsToCents`/`centsToUnits` round-trip cleanly for decimals 0–8.
- `isValidAssetId` accepts the SDK's 68-char hex format only.

### Phase 2 — Wallet snapshot carries asset balances

Update `app/services/arkade/runtime.ts`:

- Extend `WalletSnapshot.balance` with `assets: Array<{ assetId: string;
  amount: string }>` (string to keep the snapshot serializable across the
  store boundary; deserialize in renderers).
- In `snapshotWallet` and `refreshWalletSnapshot`, read
  `balance.assets: Asset[]` from `wallet.getBalance()` and map to the
  serializable shape. Sort by amount desc, then by assetId for stable
  ordering.

Update `app/store/types.ts`:

- Extend `ArkadeWalletMetadata` with
  `assetBalances: Array<{ assetId: string; amount: string }>`.
- Add `AppState.assets: { importedAssetIds: string[] }` slice with
  default `{ importedAssetIds: [] }`. The serializer carries this
  exact shape forward as `BackupPayloadV2.importedAssetIds: string[]`
  — no separate entry type needed.

Update `app/store/useAppStore.ts`:

- Apply the new `assets` slice in `DEFAULT_STATE`, persist whitelist,
  and add `normalizeAssetsSlice(raw)` to the hydrate path (no schema
  bump — same pattern as `backgroundTasks`).
- Plumb `assetBalances` through `buildMetadata` and `applySnapshot`.
- Add `importAsset(assetId)` and `forgetAsset(assetId)` actions for the
  asset detail screen. Both **must call `markDirtyForBackup()`** —
  imported asset ids are backup material that the v2 payload carries,
  and the existing `dirtyForBackup` flag drives `getBackupHealth.isStale`.
- Extend `getBackupHealth` (currently `useAppStore.ts:1857–1873`):
  rename `hasSwapMaterial` → `hasBackupMaterial` (or add a new boolean
  via overload, but a rename is cleaner) and compute it as
  `hasSwapMaterial || importedAssetIds.length > 0`. Every consumer of
  the old field — search the codebase for `hasSwapMaterial` — must move
  to the new name. The `isStale` rule keeps its existing `dirty || ...`
  shape; the rename only widens what counts as material.
- Reset path: the new slice resets via the existing `DEFAULT_STATE`
  reset; also call `clearAssetMetadata()` and clear icon approvals.

Acceptance:
- Wallet balance refresh updates `wallet.assetBalances`.
- `importedAssetIds` round-trips through hydrate and persists across
  restart.
- Reset wipes both slices + caches.

### Phase 3 — Activity rendering carries asset display

Update `Activity` (`app/store/types.ts`) to add an optional
`assets?: Array<{ assetId: string; amount: string }>` field (string
amounts for JSON safety). Keep `metadata.assetId / .assetAmount` for
back-compat but mark them as legacy "primary asset" pointers.

Update `app/services/arkade/activity-history.ts:buildAssetActivity`:

- Populate `assets` from `assetDelta` (all entries, not just `[0]`),
  with `amount` as `delta.amount.toString()`.
- Keep the existing `metadata.assetId / assetAmount` writes pointing at
  `assetDelta[0]` so existing consumers (buildSections, tests) keep
  working until they migrate.

Update `app/services/activity-details/buildSections.ts:472–507` —
note the architectural constraint: `buildSections` is currently
**pure and synchronous**, takes `Activity + BuildSectionsContext`
(`buildSections.ts:21–24`), and returns text/copy rows only
(`buildSections.ts:4–13`). `ActivityDetailsScreen.tsx:172` calls it
synchronously inside `useMemo` with no async/data plumbing. We must
not break that purity. Approach:

1. **Extend `BuildSectionsContext`** with
   `assetMetadata?: Map<string, CachedAssetDetails>` and
   `iconApprovals?: Record<string, boolean>` — both injected by the
   caller, optional so existing call sites keep compiling.
2. **Preload data after first paint.** `ActivityDetailsScreen` renders
   the first frame with fallback labels (ticker/name absent, truncated
   ids) and an empty `assetMetadata` map. A `useEffect` looks at
   `activity.assets`, awaits `readAssetMetadata(network, id)` for each
   id (cache-only, no network), stores the resolved in-memory map in
   component state, then re-runs `buildSections` via `useMemo`
   dependency. Misses kick off a second async pass via
   `fetchAssetDetailsCached(network, id, 'cache')` inside `useEffect`
   to hydrate from the SDK when needed. AsyncStorage is never read
   synchronously during render.
3. **`buildSections` stays text/copy-only.** It reads asset metadata
   from the new context map and emits per-asset detail rows: name,
   ticker, formatted amount via `prettyAssetAmount`, supply, control
   asset id. No avatar in the section list — avatars are UI, not
   section data.
4. **Avatar + icon-approval toggle live in the screen, not in
   sections.** `ActivityDetailsScreen` renders the asset avatar(s)
   inside the section header (or a dedicated `<AssetHeader>` block
   above the section list) using `AssetAvatar` + the icon-approval
   gate. This keeps `buildSections` framework-free.
5. **Raw section.** Add a new section id `"asset_raw"` with copy rows
   for raw `assetId` and base-unit `assetAmount` per asset. Collapsing
   is screen state, not section state — render the section but let
   the screen wrap it in a `Pressable` toggle.

Update `app/screens/ActivityScreen.tsx:71–121`:

- For rows where `assets` is non-empty, render asset name + formatted
  asset amount instead of (or in addition to) the anchor-sat amount.
  Use the row's first asset for the headline; show "+N more" if there
  are multiple.
- Add a small `AssetAvatar` (16–24 px) before the title for asset rows
  when the icon is approved.

Add `app/components/AssetAvatar.tsx` and `app/components/AssetCard.tsx`:

- `AssetAvatar`: circular `expo-image` if icon is approved; otherwise
  a circle with the first letter of ticker/name on theme-tinted
  background.
- `AssetCard`: row with avatar + name/ticker on left, balance on right;
  reusable across Wallet screen, send selector, asset detail.

Acceptance:
- Asset activity rows render asset name + formatted amount + avatar in
  the list.
- Activity details show one block per asset with metadata when
  available; raw asset id remains copyable.
- A single-tx multi-asset send (a `wallet.send` recipient with
  multiple `assets[]` entries) renders one Activity row with all
  entries visible in details. "Control + main" mints are **two**
  arkTxids and therefore two rows; both render correctly.

### Phase 4 — Wallet screen balance breakdown

Update `app/screens/WalletScreen.tsx`:

- Below the existing BTC balance card, render an "Assets" section
  when `assetBalances` ∪ `importedAssetIds` is non-empty.
- For each asset id, look up cached metadata (or trigger a fetch on
  screen focus via `useFocusEffect`); render `AssetCard` with avatar,
  name, ticker, formatted balance.
- Tap → navigate to `AssetDetail` when that route exists. Phase 4
  lands before Phase 4b in the execution order, so until 4b ships
  the cards are non-navigating (no `onPress`). The "Stop after step
  4" rule in *Execution Order* explicitly tolerates this. Wire the
  `onPress` in Phase 5 at the same time as `AssetDetailScreen` is
  registered — not in Phase 4 — so a partial ship cannot navigate to
  an unregistered route.
- Add an "Import asset" affordance (icon button on the section
  header) that, once Phase 5's `AssetImportScreen` exists, opens
  that screen. Same gating as above — disable the button in Phase 4
  and enable it when the import screen is registered.

Acceptance:
- New wallet with no assets shows no Assets section.
- After a mint or first asset receive, the asset appears in the
  section.
- A pre-existing imported asset id (for example from restored / seeded
  state) appears with zero balance and persists across restart.
- After Phase 4 alone (without 4b/5): asset cards render but do not
  navigate; no broken-route crashes.

### Phase 4b — Navigation routes

Update `app/navigation/RootStack.tsx` `RootStackParamList`
(`RootStack.tsx:40–68`) with the new asset route types and asset-aware
params only. This is a compile-time contract change; do **not**
register Stack screens in this phase because the components do not
exist yet. Each later phase registers the screens it actually adds.

```ts
AssetDetail: { assetId: string };
AssetMint: undefined;                       // empty → form starts blank
AssetReissue: { assetId: string };
AssetBurn: { assetId: string };
AssetImport: undefined;                     // modal-style "paste id"
```

Existing routes that gain optional asset params:

```ts
SendEntry: { preselectAssetId?: string } | undefined;
SendAmount: {
  option: ParsedPaymentOption;
  preselectAssetId?: string;                // honored when the option
                                             // itself does not carry an
                                             // assetId (e.g., Asset
                                             // Detail → Send shortcut)
};
ReceiveQR: { /* …existing fields…, */
  assetId?: string;
  assetAmountBase?: string;
};
```

No `Stack.Navigator` registration happens in Phase 4b. Registration
rules for the later phases: iOS keeps the native header, Android keeps
the custom `StackHeader` per the project navigation guidance.

### Phase 5 — Asset detail screen

Add `app/screens/assets/AssetDetailScreen.tsx`:

- Reads `assetId` from route params. Loads metadata via
  `fetchAssetDetailsCached`.
- Renders: avatar, name, ticker, current balance, supply,
  `controlAssetId` (or "Non-reissuable"), full asset id (copyable),
  icon approval toggle (hidden when self-issued).
- Action buttons:
  - **Send** — pushes the Send entry screen with asset pre-selected.
  - **Receive** — pushes Receive screen annotated with the asset
    (description shows asset name + ticker; encoded as BIP21 `assetid`
    param in the share string).
  - **Mint more** — visible only when `controlAssetId` is held locally.
    Pushes the `AssetReissue` screen.
  - **Burn** — pushes `AssetBurn` screen.
- "Forget asset" affordance at the bottom; calls `forgetAsset(id)`
  (removes from `importedAssetIds`; SDK-tracked balance still re-adds
  it if non-zero).

Add `app/screens/assets/AssetImportScreen.tsx`:

- Paste / type an asset id, validate via `isValidAssetId`, then fetch
  metadata via `fetchAssetDetailsCached(network, assetId, 'fresh')`.
- On success: write/update the metadata cache, call `importAsset(id)`,
  show a success toast, and navigate back to Wallet / AssetDetail.
- On failure: keep the typed id in place and show a clear error; never
  add invalid or unfetchable ids to `importedAssetIds`.

Register `AssetDetail` and `AssetImport` in `RootStack` in this phase
and wire Wallet's asset-card `onPress` plus the Import button now that
the routes have real components. `AssetMint`, `AssetReissue`, and
`AssetBurn` remain type-only until Phase 7; Detail action buttons for
those routes stay stubbed to toasts until then.

Acceptance:
- Detail screen loads asset metadata (cached or fresh).
- All four action buttons visible/hidden per rule above.
- Icon approval toggle persists.
- Import screen validates, fetches, persists, and round-trips an
  imported zero-balance asset.

### Phase 6 — Asset send integration

The Send flow is two screens today: `SendEntryScreen.tsx` parses input
and navigates to `SendAmountScreen.tsx` with a `ParsedPaymentOption`
in route params (`SendEntryScreen.tsx:97`). `SendAmount` owns
amount entry, balance checks, and Continue. The asset selector,
precision logic, and balance display **belong on `SendAmount`**, not
`SendEntry` — option doesn't exist until parse completes, and putting
it on `SendEntry` would require routing parsed state back into a
non-Amount screen.

Update `app/screens/send/SendEntryScreen.tsx`:

- Accept the new `preselectAssetId?: string` route param from
  `RootStackParamList` (Phase 4b). When set, thread it forward to
  `SendAmount` via the existing `nav.navigate("SendAmount", ...)`
  call as a second param alongside `option`. No new UI here.
- Continue dropping `result.metadata` — asset fields now ride on
  `option.assetId` / `option.assetAmountBase` (see Phase 6 parser
  changes below), so `metadata` carries no asset signal.

Update `app/screens/send/SendAmountScreen.tsx`:

- Add an asset selector chip above the amount input. The candidate
  set is `assetBalances ∪ importedAssetIds` resolved to `AssetOption`s
  via `assetMetadataCache`. Default selection:
  1. `route.params.option.assetId` (BIP21 carried asset).
  2. `route.params.preselectAssetId` (Asset Detail → Send shortcut).
  3. BTC.
- When an asset is selected:
  - The current `Number.parseInt(value)` path (`SendAmountScreen.tsx:48`)
    switches to bigint-aware parsing via `centsToUnits` / `unitsToCents`
    with the asset's `decimals`.
  - Balance check moves from `wallet?.balanceSats` to the asset's
    `assetBalances[id].amount` (bigint compare).
  - Destination guard: if `option.type` is `lightning` or `bitcoin`,
    show an error and disable Continue — assets are Arkade-only
    (sibling rule). Tapping the selector with a non-Arkade option
    is also blocked.
  - Insufficient-balance copy switches to "Insufficient {ticker} balance".
- Pre-fill amount from `option.assetAmountBase` (deserialize via
  `BigInt`, format with `prettyAssetAmount(amount, decimals)`) when
  it's present.
- Pass selected asset to `SendReview` as new route params
  `{ assetId?: string; assetAmountBase?: string }` alongside the
  existing fields.

Update `app/screens/send/SendReviewScreen.tsx`:

- Render asset name + ticker + `prettyAssetAmount` instead of sats
  when route carries `assetId`.
- Add a "Network anchor: 330 sats" detail line for asset sends — the
  330-sat dust ride-along is not a fee, name it accordingly.
- Hand off to the new store action `sendAsset(args)` instead of
  `sendArkade` when asset params are present.

Add `sendAsset` to `useAppStore`, parallel to the existing
`sendArkade` (`useAppStore.ts:1049–1079`):

- Signature:
  `sendAsset(address: string, assetId: string, amount: bigint): Promise<string>`
- Validates: wallet present, asset id valid, amount > 0, amount ≤
  `assetBalances[id]`, destination is Arkade.
- Submits via `wallet.send({ address, assets: [{ assetId, amount }] })`.
  `IWallet.send` is a rest-parameter API
  (`send(...recipients: [Recipient, ...Recipient[]])`,
  `@arkade-os/sdk/dist/types/wallet/index.d.ts:710`), so single
  recipients are passed positionally — matches the existing BTC call
  shape in `useAppStore.ts:1069` (`wallet.send({ address, amount })`).
- Returns the arkTxid. Calls `refreshWallet()` like `sendArkade`.

Decode BIP21 `assetid` / `assetamount` keys in the payment parser.
Threading detail (the parser shape today does **not** carry asset
fields and `SendEntryScreen.tsx:97` drops `result.metadata` when
navigating, so this needs an explicit fix):

- Extend `ParsedPaymentOption` (`paymentParser.ts:42–57`) with
  `assetId?: string` and `assetAmountBase?: string` (string to keep
  the bigint amount JSON-safe through React Navigation route params,
  same trick as `Activity.assets[].amount`).
- Add `"assetid"` and `"assetamount"` to `KNOWN_BIP21_KEYS`
  (`paymentParser.ts:78`) so they are not leaked into the
  `ParseResult.metadata` bag.
- In the BIP21 parsing branch (`parseBip21`-style code in this file,
  search for `KNOWN_BIP21_KEYS`), when the destination is an Arkade
  address and `assetid` is present and valid (`isValidAssetId`), copy
  both fields onto the produced `ParsedPaymentOption`. Reject the
  combo when `assetid` is set and destination is not Arkade (BIP21
  with assets is Arkade-only in this app).
- The fields ride forward through `SendEntryScreen.tsx:97`
  (`nav.navigate("SendAmount", { option })`) without any metadata-bag
  plumbing — `option` is the carrier.

Acceptance:
- Send selecting USDT → only Arkade addresses accepted; precision
  conversions are correct; tx submits.
- BIP21 `arkade:<addr>?assetid=...&assetamount=...` deep-link pre-selects
  the asset and amount in the form.

### Phase 7 — Mint / Reissue / Burn screens

Add `app/screens/assets/AssetMintScreen.tsx`:

- Inputs: name (required, ≤ 40 chars), ticker (required, ≤ 8),
  amount (positive integer), decimals (default 0, range 0–8),
  icon URL (optional), control mode (None / Existing / New).
- Validation: matches the sibling's `disabledReason` chain
  (`Mint.tsx:175–193`).
- Submit via `wallet.assetManager.issue({ amount: unitsToCents(amount,
  decimals), metadata, controlAssetId? })`.
- On success: write to metadata cache, mark self-issued (auto-approve
  icon), push `assetId` into `importedAssetIds`, navigate to a success
  screen showing arkTxId + assetId.
- Control mode "New": mint a 1-unit control asset first; on success use
  its `assetId` as `controlAssetId` for the main mint.

Add `app/screens/assets/AssetReissueScreen.tsx` (reachable from asset
detail when control asset is held):

- Single input: additional amount (positive integer, precision-aware).
- Submit via `wallet.assetManager.reissue({ assetId, amount })`.

Add `app/screens/assets/AssetBurnScreen.tsx`:

- Single input: amount to burn (≤ current balance, precision-aware).
- Submit via `wallet.assetManager.burn({ assetId, amount })`.

All three screens: `Alert.alert` confirmation showing the exact asset
id (truncated form), amount, and irreversibility note. After success,
refresh wallet snapshot and rebuild activities.

Acceptance:
- Mint emits an `asset_issued` Activity row (already classified by the
  history pipeline).
- Reissue emits an `asset_issued` row tied to the existing assetId.
- Burn emits an `asset_burned` row.

### Phase 8 — Receive screen annotation

Update `app/screens/receive/`:

- Add asset-aware mode triggered from asset detail's "Receive" button.
- Generate a BIP21 string with `assetid=<id>` and optional `assetamount`
  if the user enters one.
- QR encodes the BIP21 string; copy/share affordances use the same.
- Description on the QR card shows asset name + ticker, e.g.
  "Receive USDT to your Arkade address".

Acceptance:
- Asset-receive QR scans back into the Send flow with asset
  pre-selected.

### Phase 9 — Backup integration

Update `app/services/backup/serializer.ts`:

- Bump `PAYLOAD_VERSION` from `1` to `2` (line 11). The constant is the
  written version; the parser must still accept v1.
- Add a `BackupPayloadV2` type that extends `BackupPayloadV1` shape with
  `importedAssetIds: string[]`. Keep `BackupPayloadV1` exported so the
  union type stays correct.
- `BackupPayload` becomes `BackupPayloadV2` (writes) and the parser
  output normalizes to v2 (reads). Update `parseBackupPayload` to:
  - Accept `r.version === 1` and synthesize `importedAssetIds: []`.
  - Accept `r.version === 2` and parse the field via a `parseStringArray`
    helper (reject non-string entries; cap length to e.g. 200 ids).
  - Continue rejecting any other version with `unsupported_version`.
- Extend `buildBackupPayload` input with `importedAssetIds` and the
  caller in `useAppStore.exportBackup` (`useAppStore.ts:1583`) reads
  it from `get().assets.importedAssetIds`.
- `importBackup` in `useAppStore` writes `payload.importedAssetIds`
  into the new `assets` slice during the restore.
- Asset metadata cache stays device-local; do not persist it in the
  backup envelope (it's network-derivable and TTL-bound). Icon
  approvals do not survive backup either — trust is per-device.

Acceptance:
- Backup → reset → restore yields the same `importedAssetIds`.

### Phase 10 — Recovery filter + Diagnostics

Update `app/services/arkade/recovery.ts`:

- In the `Arkade settlement` loop (currently `recovery.ts:334–360`),
  skip rows where `md.settlementReason === "asset_bearing_settlement"`.
  Drop them silently — they're expected for any tx that touches assets,
  not anomalies. Keep the `bumpCount(counts, "arkade_settlement")` call
  on the unskipped path only, so support bundles don't double-count.

Update `app/services/diagnostics/bundle.ts`:

- The bundle has its own settlement-anomaly counter at
  `bundle.ts:265–278` that mirrors the recovery loop and must get the
  same filter: skip activities where
  `metadata.settlementReason === "asset_bearing_settlement"`. Without
  this, the support bundle inflates `recoveryCounts.arkade_settlement`
  with expected asset-bearing rows.
- Add a redacted asset summary: count of `importedAssetIds`, count of
  non-zero asset balances, count of cached metadata rows. Do **not**
  include raw asset ids in the bundle (privacy parity with swap ids).
- Add a count of asset-bearing activities by classification.
- Add a count of skipped asset-bearing settlement rows (the rows the
  filter dropped) so we can prove the filter is firing without having
  to look at logs. Same count is used by both the recovery service and
  the bundle — extract to a shared helper in `recovery.ts` if the
  duplication starts to drift.

## Verification Plan

No test framework configured. Use repo checks plus manual scenarios.

Commands:
- `pnpm check`
- `./node_modules/.bin/tsc --noEmit`

Manual scenarios (run on signet or mutinynet — networks where
issuance is enabled server-side):

- Fresh wallet, no assets: Wallet screen renders BTC only; Send flow
  shows asset selector inert ("No assets").
- Mint a new asset with decimals=2, ticker=TST: success screen shows
  arkTxId + assetId; asset appears on Wallet with correct formatted
  balance; an `asset_issued` activity row appears with name + ticker
  in the list and a full asset block in details.
- Mint with control mode = New: two activity rows (control + main),
  asset detail shows the control asset id, "Mint more" affordance is
  enabled.
- Reissue 100 additional units: balance updates; activity row
  classified as `asset_issued`; supply count updates after a cache
  invalidation.
- Burn 50 units: balance updates; row classified as `asset_burned`.
- Send 1 TST to another Arkade address: review screen shows asset
  name + ticker + formatted amount; tx succeeds; `asset_sent` row
  appears.
- Try to send TST to a Lightning invoice: form rejects with a clear
  message.
- Try to send TST to a Bitcoin on-chain address: form rejects.
- Import a known asset id from another wallet: appears on the Wallet
  screen with zero balance and persists across restart.
- Forget an imported asset: disappears when balance is zero; stays
  when balance > 0.
- Icon approval: a fresh non-self-issued asset shows the letter avatar;
  approving in the detail screen flips to the image; revoke flips back.
  Self-issued assets auto-approve.
- Cache TTL: roll the system clock forward 24 h (or write a stale
  `cachedAt`); next screen entry re-fetches metadata.
- Reset: clears imported asset list, metadata cache, and icon
  approvals; Wallet screen re-renders without the assets section.
- Backup → restore: `importedAssetIds` round-trip via the v2 payload;
  metadata cache is empty post-restore (refetched lazily); icon
  approvals do not survive restore (intentional — trust decisions are
  per-device).
- Backup health: after importing or forgetting an asset on a freshly
  backed-up wallet, `getBackupHealth().isStale` flips to true and the
  ProfileBackup screen surfaces the "out of date" warning. After a new
  export, `isStale` clears.
- Restore a v1 backup payload (e.g. one created before this milestone):
  parser accepts it, `importedAssetIds` is empty post-restore, no
  errors.
- Recovery anomaly filter: mint an asset, then open ProfileRecovery.
  The Arkade settlement anomaly card is empty (was previously showing
  the asset-bearing commitment). Support bundle shows the skip count
  > 0.

## Execution Order

Recommended order for an implementation agent:

1. **Phase 1**: asset-format helpers + metadata cache + icon approval.
   No UI yet. Ship behind a single import-friendly module.
2. **Phase 2**: snapshot + store slice + types. Wallet now *knows*
   about assets but doesn't render them.
3. **Phase 3**: activity rendering (list + details). Existing
   asset-bearing txs immediately get the upgraded display.
4. **Phase 4**: Wallet screen breakdown + import affordance.
5. **Phase 4b**: Add the new `AssetDetail`, `AssetMint`,
   `AssetReissue`, `AssetBurn`, `AssetImport` routes and the optional
   asset params on `SendEntry`, `SendAmount`, `ReceiveQR`. Type-only
   compile change; do not register screens yet.
6. **Phase 5**: Asset detail + import screens. Register only the
   screens implemented in this phase; keep Mint/Reissue/Burn buttons
   stubbed to toasts.
7. **Phase 6**: Send integration.
8. **Phase 7**: Mint, Reissue, Burn screens. Wire the asset-detail
   action buttons through.
9. **Phase 8**: Receive annotation.
10. **Phase 9**: Backup serializer bump (v1 → v2).
11. **Phase 10**: Recovery filter + diagnostics counts.

Stop after step 4 if asset rendering reveals classifier issues —
inventory and balance correctness are more important than mint UX.

## Footguns

- `Asset.amount` is `bigint`. Never round-trip through `Number`.
  `buildAssetActivity` already calls `Number(primary.amount)` —
  fix this by emitting strings in `assets[]` and reconstructing
  `BigInt` in the renderer. Existing `metadata.assetAmount`
  (lossy) can stay for back-compat but new code should not read it.
- Asset icons are arbitrary user-supplied strings. Never render
  unverified icons by default. The `expo-image` `<Image source>` API
  is fine with `https:` and `data:` URLs but does not sandbox them.
  Approval gate is mandatory.
- Asset-bearing sends still carry a 330-sat anchor dust. Subtract from
  the BTC balance check before allowing the send; don't display the
  anchor as "fee" — call it "network anchor".
- The Arkade address is the **same** for BTC and assets. Don't generate
  a new address per asset; don't gate receive-by-asset on address
  derivation. BIP21 carries the asset id, not the address.
- `wallet.assetManager.reissue` does not validate control-asset
  ownership client-side. Surface "Requires control asset" before the
  user submits; rely on server rejection as a secondary gate, not
  primary UX.
- `AssetDetails.metadata.icon` can be arbitrarily large (data URLs).
  Cap the persisted value to a reasonable size (e.g. 32 KB) when
  writing to the cache, replace overrun with `undefined`, and fall
  back to the letter avatar.
- Two assets in a single arkTxid (rare, e.g. a deliberate dual-asset
  transfer composed in one `wallet.send` call) must render in a single
  Activity row's `assets[]`, not two rows. `activityId("asset",
  arkTxid)` is unique per tx; the renderer must walk `assets[]` and
  not assume `[0]`. This is the bug today: `buildSections.ts:472–507`
  reads `metadata.assetId` (lossy primary) and never sees other
  entries. Mint's "control + main" pattern is **not** affected — those
  are two separate arkTxids (sibling mint flow,
  `../wallet/src/screens/Apps/Assets/Mint.tsx:117–142`).
- Asset metadata cache key includes the network. Switching networks
  with the same asset id (rare but possible for test networks) must
  not show stale metadata from the other network.
- The backup `PAYLOAD_VERSION` bump from 1 → 2 must default missing
  `importedAssetIds` to `[]` when reading v1 payloads, NOT reject them
  with `unsupported_version`. The serializer's existing version gate
  (`serializer.ts:88`) currently rejects anything that isn't exactly
  `PAYLOAD_VERSION`; broaden it to accept the union of supported
  versions and normalize at read time.
