# Milestone 11: Transaction Visibility

Goal: give users accurate, honest visibility into pending funds and individual
VTXOs.

This milestone should prove:

- Pending swap transactions are visually distinct from settled ones in every
  list and detail view (color, label, status badge).
- Pending inbound amounts are never counted in the confirmed balance total.
- An optional pending-amount line in the balance breakdown makes in-flight
  funds visible without inflating the settled total.
- A user can open a paginated VTXO detail view listing every VTXO at their
  address, with copy-to-clipboard and explicit dust/unspendable labels.

## Current State

### Pending visual state — incorrect today

- `app/services/arkade/swap-mappers.ts:33–61` correctly classifies
  reverse-, submarine-, and chain-swap Boltz statuses into the
  `ActivityStatus` enum (`pending | confirmed | failed | refunded | info`,
  `app/store/types.ts:6–11`). Reverse swaps stay `"pending"` until
  `invoice.settled`. That part of the data model is fine.
- **The bug is in rendering.** Both `ActivityScreen` and `WalletScreen`
  paint inbound rows green regardless of status:
  - `app/screens/ActivityScreen.tsx:131–135` —
    `amountColor = isSelf ? text : isIn ? success : text` (no pending
    branch).
  - `app/screens/WalletScreen.tsx:333–337` — identical inline copy of the
    same expression on the wallet home's recent-activity preview.
  - The only acknowledgement of pending is the `" · Pending"` text suffix
    appended to the timestamp (`ActivityScreen.tsx:47–58`,
    `WalletScreen.tsx:371`). The amount itself still glows success-green.
- `app/screens/ActivityDetailsScreen.tsx:307–342` renders status as a
  generic pill backed by `surfaceSubtle`/`textMuted` (the same gray
  treatment as rail and direction). The status word is correct
  (`statusLabel(activity.status)`) but the pill is visually identical for
  Pending, Confirmed, Failed, and Refunded — nothing pulls the user's
  eye.
- `buildSections.ts:77–82` already maps the status enum to copy
  (`statusCopy`) — useful when we extract a shared status helper.
- The milestone goal text mentions `rawStatus === 'pending'`; the actual
  field is `Activity.status` (`app/store/types.ts:44`). No `rawStatus`
  field exists anywhere in the codebase. Use `status` consistently —
  treat any "rawStatus" wording in earlier notes as a typo.

### Balance computation — already correct under the hood

- `app/services/arkade/runtime.ts:31–49` exposes the snapshot's `balance`
  with `available`, `total`, `settled`, `preconfirmed`, `boardingTotal`,
  and `assets`. These come straight from `wallet.getBalance()`
  (`runtime.ts:240–272`) — the SDK is responsible for keeping pending
  reverse-swap inbound amounts out of `available`.
- `app/store/types.ts:99–126` flattens the snapshot into
  `ArkadeWalletMetadata` and only persists three BTC fields:
  `balanceSats` (= `available`), `balanceTotalSats` (= `total`),
  `balanceBoardingSats` (= `boardingTotal`). Pending Lightning is **not**
  added to any of them. So the textual claim "pending inbound amounts
  never count in confirmed total" already holds — but it's not currently
  *visible* anywhere, which is what the milestone is really after.
- The Wallet screen big-number card displays `wallet.balanceSats` only
  (`WalletScreen.tsx:165–170`). Balance breakdown lists three lines —
  Available offchain / Boarding (onchain) / Total
  (`WalletScreen.tsx:399–408`). There is no Pending line and no link
  to a VTXO detail view.

### VTXO inspection — not in the app today

- No screen exposes per-VTXO data. Users currently click through the
  block explorer at `https://explorer.mutinynet.arkade.sh/address/…`
  (only reference to that domain in app code is
  `app/services/activity-details/explorer.ts:16`, used for tx links).
- The activity-history pipeline already reads `wallet.getVtxos()`
  internally (search `activity-history.ts` for `virtualStatus`, e.g.
  `:338` and `:560`) but its output is folded into activity rows, not
  surfaced raw.
- `ArkadeServerInfo.dustSats` is read on `runtime.ts:118`
  (`Number(info.dust)`) and persisted in
  `AppState.network.serverInfo.dustSats` — already available for
  dust labeling without a fresh server probe.

## SDK Surface Available Now

Confirmed against the SDK shipped in trixie's `package.json`.

- **`wallet.getVtxos(filter?: GetVtxosFilter): Promise<ExtendedVirtualCoin[]>`**
  — `@arkade-os/sdk/dist/types/wallet/index.d.ts:741`. Returns the full
  list in one shot. **No pagination params** (`GetVtxosFilter` is
  `{ withRecoverable?, withUnrolled? }`, line 616–621).
- **`ExtendedVirtualCoin`** (`:562`) = `TapLeaves & EncodedVtxoScript &
  VirtualCoin & { extraWitness? }`. Inherited from `VirtualCoin`
  (`:474–496`):
  - `value: number` (sats), `script: string` (hex scriptPubKey),
    `txid: string`, `vout: number`, `createdAt: Date`.
  - `isUnrolled: boolean`, `isSpent?: boolean`, `settledBy?: string`
    (commitment txid), `spentBy?: string` (checkpoint txid),
    `arkTxId?: string`.
  - `virtualStatus: VirtualStatus` with
    `state: "preconfirmed" | "settled" | "swept" | "spent"`,
    `commitmentTxIds?: string[]`, `batchExpiry?: number` (ms epoch).
  - `assets?: Asset[]` — preserved for asset-bearing VTXOs (M10 land).
- **Classification helpers** (top of same file):
  - `isSpendable(vtxo)` — `:574` — true when not marked spent.
  - `isRecoverable(vtxo)` — `:587` — true when swept but still
    spendable in a new batch.
  - `isExpired(vtxo)` — `:600` — true when swept or batchExpiry passed
    (timestamp; helper guards against regtest block-height values).
  - `isSubdust(vtxo, dust: bigint)` — `:610` — true when value < dust.
- **No bulk "list-and-paginate" endpoint.** Pagination must be a UI
  concern — fetch all, page on the client.
- **Dust threshold** — `wallet.serverInfo.dust` (number, sats) or
  cached as `state.network.serverInfo.dustSats`. Convert to BigInt for
  `isSubdust`.

## Sibling Wallet Patterns Worth Inheriting

`../wallet/src/screens/Settings/Vtxos.tsx` (the web sibling's VTXO list)
is the canonical reference. Patterns to mirror:

- Single `svcWallet.getVtxos({ withRecoverable: true, withUnrolled:
  false })` call on mount; no streaming or pagination on the SDK side.
- Per-row colored status tag with a fixed vocabulary:
  `settled` (green) / `unconfirmed` (orange) / `swept` (orange) /
  `subdust` (orange). Adopt the same four labels — they map cleanly to
  the four `VirtualStatus.state` values plus the `isSubdust` overlay.
- Copyable outpoint (`txid:vout`) and amount per row.
- A header explaining what dust / swept / recoverable mean — users
  reading this screen are doing forensics, not casual browsing; the
  prose is worth the screen real-estate.

The web sibling does not currently expose a balance-breakdown "pending"
line, so the pending-section design below is trixie-original. Keep it
small and predictable.

## Product Rules

- A pending amount must never appear in the confirmed balance total.
  (Already true; we add an audit step to keep it true.)
- Pending activity rows must be visually distinct from settled rows in
  the list and the detail screen. "Visually distinct" means at minimum:
  a non-success amount color and a colored status pill that uses the
  warning palette — not just a text suffix.
- The pending-amount section in the breakdown renders only when the
  pending total is non-zero. Empty pending state must not add a line
  that says "0 sats" — that's just noise.
- VTXO data must come from `wallet.getVtxos()`, not from the explorer
  HTML or any other out-of-band source.
- The VTXO list must include every VTXO at the wallet's Arkade address,
  including dust and unspendable entries, with a clear per-row label.
  Users get full visibility over their money — no hidden buckets.
- Pagination is required because the list can grow indefinitely as
  receives accumulate. Pagination is **client-side only** in v1
  (the SDK does not paginate `getVtxos`). Render the visible page from
  a stable, sorted in-memory copy of the SDK response.
- The VTXO list and balance breakdown must not block initial Wallet
  render. Both load lazily after the first paint and degrade gracefully
  on error (toast + retry, no fatal screen).
- Explorer links remain available for individual VTXOs but they are
  secondary — copy outpoint and amount must work without the network.

## Decisions

- **Pending color token.** Add a `pending` semantic color to the theme,
  resolving to `warning` in both modes (`#FDB022` dark / `#F79009`
  light) plus a `pendingSoft` rgba(warning, 0.18) for tag backgrounds.
  Reusing `warning` directly avoids token sprawl but invites accidental
  drift if "warning" gets repurposed later; the alias keeps the call
  sites semantic. Pending amounts render in `pending`; pending icons
  use `pending`-tinted backgrounds (same opacity treatment used for
  success/danger today in `ActivityScreen.tsx:120–124`). Confirmed
  inbound stays `success`; failed stays `danger`; refunded stays
  `textSubtle`.
- **Status pill in details.** The status pill (currently gray
  `surfaceSubtle` + `textMuted` in `ActivityDetailsScreen.tsx:307–342`)
  switches to a status-aware pair: `pendingSoft` + `pending` for
  Pending, `successSoft` + `success` for Confirmed, `dangerSoft` +
  `danger` for Failed, `surfaceSubtle` + `textMuted` for Refunded /
  Info. Add `successSoft`, `dangerSoft` to the theme too — same alpha
  scheme as `pendingSoft`. Rail and direction pills keep their current
  gray treatment so the status pill remains the eye-magnet.
- **Where the shared status-styling lives.** Extract
  `app/services/activity-status.ts` exporting
  `statusColor(status, theme)` returning
  `{ fg, bg, label }`. Both `ActivityScreen.tsx` and `WalletScreen.tsx`
  consume it for the row amount color; `ActivityDetailsScreen.tsx`
  consumes it for the pill. `buildSections.ts:77–82` already has
  `statusCopy` — keep it; the new module imports and re-exports the
  label.
- **Pending-amount section in the balance breakdown.** Compute
  `pendingInboundSats` and `pendingOutboundSats` from
  `wallet.activities`: sum `amountSats` for rows where
  `status === "pending"` and `direction === "in"` (or `"out"`). Skip
  rows with `assets` (assets are not BTC), skip `wallet_event`, skip
  rows missing `amountSats`. Render the section in
  `WalletScreen.tsx:386–408` between Boarding and Total when the
  inbound total is non-zero, plus a "Pending outbound" line when
  outbound is non-zero. Total is unchanged — still derived from
  `balanceTotalSats`.
- **Balance audit guard.** Add a one-shot assertion (dev-only,
  `__DEV__` gate) in `applySnapshot` (search `useAppStore.ts` for
  `balanceSats:`) that warns to the recorder when
  `balanceSats + pendingInboundSats > balanceTotalSats + dust slack`.
  This is a regression canary, not a UI gate: if a future SDK change
  starts folding pending amounts into `available`, we want a paper
  trail in the support bundle rather than silent drift. Tolerance:
  10 sats — enough to absorb rounding without hiding real drift.
- **VTXO data layer.** New service
  `app/services/arkade/vtxo-listing.ts` with:
  - `loadVtxos(wallet, { includeRecoverable: boolean }):
    Promise<ClassifiedVtxo[]>`
  - `classifyVtxo(vtxo: ExtendedVirtualCoin, dustSats: number):
    VtxoStatus`
  - `type ClassifiedVtxo = ExtendedVirtualCoin & { status: VtxoStatus,
    amountSats: number, outpoint: string }`
  - `type VtxoStatus = "settled" | "preconfirmed" | "swept" |
    "subdust" | "spent"`. Order matters — `subdust` wins over
    everything (most user-relevant); then `state` from `virtualStatus`;
    `spent` only appears when `withUnrolled` is on (we keep it off by
    default).
- **VTXO list entry point.** Reached from the balance breakdown via a
  new row ("View VTXOs") rendered below Total in the breakdown card.
  Not in the bottom-tab nav — this is a forensic/inspection surface,
  not part of the daily-driver flow.
- **Pagination strategy.** `FlatList` with `initialNumToRender: 30`,
  `windowSize: 7`. The SDK call returns the full array; we sort
  client-side by `value` desc, then `createdAt` desc. No "Load more"
  button — `FlatList`'s virtualization handles the long-list case for
  free. If the wallet ever ships with > 10k VTXOs we'll revisit; until
  then virtualization is sufficient.
- **VTXO row content.** Per row: amount (sats), status pill, truncated
  outpoint (`txid…:vout`), createdAt (relative). Tap the row → bottom
  sheet (or detail screen) with full outpoint, full txid, status,
  commitment txid(s), batchExpiry (formatted), copy buttons, and an
  "Open in explorer" link. We use a stack screen (`VtxoDetail`) rather
  than a bottom sheet to stay consistent with `ActivityDetails` and
  keep deep-linking trivial.
- **Copy semantics.** Outpoint copy emits `txid:vout` (canonical form).
  Amount copy emits the integer sats with no thousands separators
  (matches `ActivityDetailsScreen` copy conventions). Both
  copy actions show a toast via the existing `useToast()`.
- **Asset-bearing VTXOs.** Show a small asset badge ("+ ASSET") when
  `vtxo.assets?.length > 0`. The list does not break down per-asset
  amounts — that lives in the AssetDetail screen (M10). Tap-through
  still leads to `VtxoDetail`.
- **No screen-scraping fallback.** If `getVtxos()` throws, show an
  inline error with a "Retry" button and a "Open address in explorer"
  link as the escape hatch. Do not parse the explorer HTML.
- **Persisting the VTXO snapshot.** Do **not** persist. The list is
  fetched fresh on every screen entry. Caching introduces staleness
  bugs we don't want on a forensic screen.
- **`pendingInboundSats` in `ArkadeWalletMetadata`?** No. Compute on
  the fly from `activities` in the renderer. Persisting it would
  double the source of truth and require yet another normalization
  step on hydrate.

## Recovery / Diagnostics Considerations

- **Diagnostics bundle** (`app/services/diagnostics/bundle.ts`): add a
  redacted VTXO summary block. Counts only — no outpoints, no scripts:
  - total VTXOs, count by `VtxoStatus`, sum of dust sats, sum of
    swept sats, oldest `createdAt` ms-since-epoch, newest. Skipping
    raw ids preserves privacy parity with the existing swap-id
    redaction (`bundle.ts:14–19` defines `redactString`).
- **Pending-balance audit warning** (from Decisions above) goes through
  `recordError("wallet", …)` so the support bundle picks it up via
  `getRecentErrors`. Sampling rate: at most once per snapshot
  application — flag a module-scope `__warned` boolean so we don't
  spam.
- **No recovery flow change.** VTXO listing is a read surface;
  ProfileRecovery (`app/screens/ProfileRecovery.tsx`) still owns the
  active recovery actions.

## Implementation Plan

### Phase 1 — Status color tokens + shared style helper

Add to `app/theme/theme.tsx:140–224`:

- `pending`, `pendingSoft`, `successSoft`, `dangerSoft` keys in both
  light and dark palettes. Soft variants are
  `rgba(<semantic>, 0.18)` in dark and `rgba(<semantic>, 0.12)` in
  light, matching the existing `primarySoft` treatment
  (`theme.tsx:164,198`).

Add `app/services/activity-status.ts`:

- `statusVisuals(status, theme): { fg: string, bg: string, label:
  string }` — single source of truth for status → color/label.
- Re-export the existing `statusCopy` from
  `app/services/activity-details/buildSections.ts:77–82` so callers
  have one import path.

Acceptance:
- `pnpm check` clean.
- The new helper covers all five `ActivityStatus` values and never
  throws for unknown values (default to `info`).

### Phase 2 — Activity list + details adopt pending visuals

Update `app/screens/ActivityScreen.tsx`:

- Replace the `amountColor` ternary (`:131–135`) with a `statusVisuals`
  lookup that returns `pending` when the status is pending, success
  for confirmed inbound, danger for failed/refunded outbound, default
  text otherwise.
- Replace the bare `" · Pending"` suffix (`:47–58, :201, :234`) with a
  small inline pill rendered next to the timestamp. Pill uses
  `statusVisuals(status).bg` + `.fg`. Show the pill for any non-`confirmed`
  status — Pending, Failed, Refunded all benefit from the colored chip.
  Keep the `formatDate` text unchanged.
- Asset-row path (`:175–210`) gets the same pill treatment; the
  asset-amount color stays neutral (asset colors don't carry the same
  semantics as sats).

Update `app/screens/WalletScreen.tsx`:

- Recent-activity preview (`:319–383`) mirrors the changes above. This
  is hand-rolled inline today — extract a small `ActivityRow`
  component to `app/components/ActivityRow.tsx` shared between
  `ActivityScreen` and `WalletScreen`. Each screen keeps its own
  empty-state and refresh control; the row is the only shared chunk.

Update `app/screens/ActivityDetailsScreen.tsx:307–342`:

- The status pill (first tag) consumes `statusVisuals` for both bg
  and fg.
- The amount in the summary block (`:298–303`) also picks up the
  pending color when the status is pending and the direction is `in`.
  Outbound pending stays text-default (no color change for out — it's
  already showing as a minus).
- Rail and direction pills keep their gray treatment.

Acceptance:
- A reverse swap stuck at `transaction.mempool` renders with a
  yellow/orange amount in the activity list, a yellow status pill in
  the detail summary, and an unchanged amount value.
- A settled inbound shows green amount + green pill.
- A failed submarine shows red pill + text-colored amount (no
  green-on-failed).
- A refunded submarine shows neutral pill + text-colored amount.

### Phase 3 — Pending section in balance breakdown

Add `app/services/wallet-balance.ts`:

- `computePendingTotals(activities: Activity[]): { inboundSats: number,
  outboundSats: number }`. Pure function. Sums `amountSats` over
  `kind === "lightning_swap"` (rev = in, sub = out) plus `kind ===
  "payment" && status === "pending"`. Excludes rows with
  `assets?.length > 0`. Returns 0/0 on empty input.
- `auditBalanceIntegrity(snapshot, pending, dustSlack = 10): null |
  string` — returns a warning string when the SDK's `available`
  appears to be inflated, otherwise null. Used only in `__DEV__`
  builds.

Update `app/store/useAppStore.ts` `applySnapshot` (search for
`balanceSats:`):

- After applying the snapshot, call
  `auditBalanceIntegrity(snapshot, computePendingTotals(activities))`.
  When non-null, call `recordError("wallet", warning)` exactly once
  per app session (module-scope guard).

Update `app/screens/WalletScreen.tsx:386–408`:

- `pending = computePendingTotals(wallet.activities)`.
- Render `Pending inbound: …` and/or `Pending outbound: …` rows above
  Total when their respective sats are > 0. Color: `pending`. Label:
  small inline "Pending" chip on the right of the amount, same chip
  component as Phase 2.
- Total line unchanged.

Acceptance:
- Fresh wallet, no swaps: no pending lines render, breakdown looks
  identical to today.
- Issue a Lightning invoice and wait for `transaction.mempool`: a
  Pending inbound line appears with the swap amount. Confirmed balance
  is unchanged (no inflation).
- Settle the swap: Pending inbound disappears, confirmed total goes up
  by the same amount.
- Pending lines show a chip styled with the new `pending` color, not
  green.

### Phase 4 — VTXO data layer

Add `app/services/arkade/vtxo-listing.ts`:

```ts
export type VtxoStatus =
  | "settled" | "preconfirmed" | "swept" | "subdust" | "spent";

export type ClassifiedVtxo = ExtendedVirtualCoin & {
  status: VtxoStatus;
  amountSats: number;
  outpoint: string;        // `${txid}:${vout}`
};

export function classifyVtxo(
  vtxo: ExtendedVirtualCoin,
  dustSats: number,
): VtxoStatus;

export async function loadVtxos(
  wallet: Wallet,
  opts: { includeRecoverable: boolean; includeUnrolled?: boolean },
  dustSats: number,
): Promise<ClassifiedVtxo[]>;
```

- Classification precedence: `isSubdust(vtxo, BigInt(dustSats))` →
  `"subdust"`; else `virtualStatus.state` mapped 1:1
  (`preconfirmed | settled | swept | spent`).
- Sort the returned list by `value` desc, then `createdAt` desc.
- Wrap the SDK call in `toArkadeError("vtxos_fetch_failed", ...)` so
  the screen can surface a consistent error toast.

Acceptance:
- `loadVtxos` returns a stable, sorted array.
- `classifyVtxo` maps every `VirtualStatus.state` and never returns
  `undefined`.
- A dust-sized settled VTXO (value < `dustSats`) classifies as
  `subdust`, not `settled`.

### Phase 5 — Navigation + entry point

Update `app/navigation/RootStack.tsx`:

- Extend `RootStackParamList` (`:45–110`):

  ```ts
  VtxoList: undefined;
  VtxoDetail: { outpoint: string };
  ```

- Register both `Stack.Screen`s alongside the existing screens. iOS
  inherits the native header; Android picks up the custom
  `StackHeader` per the existing pattern (`RootStack.tsx:114+`).

Update `app/screens/WalletScreen.tsx`:

- Add a tappable row "View VTXOs" under the balance breakdown card.
  Tapping pushes `nav.navigate("VtxoList")`. Visible regardless of
  whether the user has VTXOs — the empty state lives on the list
  screen, not as a gate.

Acceptance:
- TS compile passes after adding the routes.
- The "View VTXOs" row navigates to the list screen.

### Phase 6 — VTXO list screen

Add `app/screens/vtxos/VtxoListScreen.tsx`:

- On mount: read `dustSats` from
  `useAppStore(s => s.network.serverInfo?.dustSats ?? 0)`; call
  `ensureWallet(...)` to get the live `Wallet` (the existing pattern
  used by ProfileRecovery / send flows); call `loadVtxos(wallet, {
  includeRecoverable: true }, dustSats)`. Wrap in
  `useFocusEffect` so navigating back-and-forth refreshes.
- Header: short explanation paragraph naming each status with a
  one-sentence definition (Settled / Pending / Recoverable / Dust).
  No "marketing" copy — pure forensics.
- `FlatList` body:
  - `initialNumToRender: 30`, `windowSize: 7`,
    `keyExtractor={(v) => v.outpoint}`.
  - Per-row: amount in sats (right-aligned, tabular-nums), status pill
    (Phase 1 colors), truncated outpoint (first 8 chars of txid + `…:vout`,
    monospace), relative createdAt.
  - Tap row → `nav.navigate("VtxoDetail", { outpoint: v.outpoint })`.
- RefreshControl: pull-to-refresh re-runs `loadVtxos`.
- Empty state: `Inbox` icon + "No VTXOs at this address yet".
- Error state: inline card with retry button + "Open address in
  explorer" link via `explorerUrl(network, arkAddress, "address")`.
- The status pill colors map: settled → success, preconfirmed →
  pending, swept → warning, subdust → textSubtle, spent → danger.

Acceptance:
- A wallet with 50 mixed VTXOs scrolls smoothly; FlatList virtualizes.
- Dust VTXOs render with a clear "Dust" chip and a muted amount color.
- Swept (recoverable) VTXOs render with a "Recoverable" chip.
- Asset-bearing VTXOs show a small "+ ASSET" badge.
- Pull-to-refresh re-fetches.

### Phase 7 — VTXO detail screen

Add `app/screens/vtxos/VtxoDetailScreen.tsx`:

- Reads `outpoint` from route params, fetches the same `loadVtxos`
  result (cache via component state passed through navigation params
  is tempting but adds a footgun — keep it stateless and re-fetch).
  When the outpoint isn't in the fresh list, show "VTXO no longer
  present" with a back button.
- Renders one card per data block:
  - **Amount** — formatted sats + raw integer copyable.
  - **Status** — pill + one-sentence explanation per status.
  - **Outpoint** — full `txid:vout`, mono, copyable.
  - **Created** — full ISO timestamp + relative.
  - **Commitment txids** — list of strings from
    `virtualStatus.commitmentTxIds`, each copyable, each with explorer
    link.
  - **Batch expiry** — formatted timestamp + relative ("expires in
    3 days").
  - **Settled by / Spent by / Ark tx id** — only when set; copyable +
    explorer link.
  - **Script** — collapsed by default behind a "Show script" pressable;
    expands to the full hex, copyable.
  - **Assets** — when `assets?.length > 0`: list of `{ assetId,
    amount }` with truncated id and `prettyAssetAmount` formatting via
    cached metadata. Match the existing asset-detail conventions from
    M10.
- "Open in explorer" button uses
  `explorerUrl(network, outpoint or txid, "tx")` —
  `app/services/activity-details/explorer.ts` already encodes per-network
  base URLs.

Acceptance:
- Detail screen renders all blocks present in the SDK payload.
- Copy actions toast success per the existing pattern.
- Asset block renders for asset-bearing VTXOs and is omitted for plain
  BTC.

### Phase 8 — Diagnostics integration

Update `app/services/diagnostics/bundle.ts`:

- Add a `vtxos` summary section under the existing wallet block:
  ```ts
  vtxos: {
    total: number;
    byStatus: Record<VtxoStatus, number>;
    dustSats: number;          // sum of value over dust entries
    sweptSats: number;         // sum over swept entries
    oldestCreatedAt: number | null;
    newestCreatedAt: number | null;
  } | null;
  ```
- Populate by calling `loadVtxos(wallet, { includeRecoverable: true
  }, dustSats)` at bundle-assembly time. On error, set `vtxos: null`
  and append to the existing `errors` slot. Do not include outpoints,
  scripts, or txids — counts only.

Acceptance:
- Support bundle export includes the `vtxos` block on a wallet with
  VTXOs.
- Bundle export still succeeds when `getVtxos()` throws (the
  `vtxos: null` branch).

## Verification Plan

No test framework configured. Use repo checks plus manual scenarios.

Commands:
- `pnpm check`
- `./node_modules/.bin/tsc --noEmit`

Manual scenarios (mutinynet recommended — Lightning swaps and dust
VTXOs are easiest to produce there):

- **Pending visual on reverse swap.** Generate a Lightning invoice,
  pay it from an external wallet. While the swap status is
  `transaction.mempool`, the Activity list row's amount is rendered
  in the pending color and shows a "Pending" pill. The Wallet screen
  recent-activity preview matches. The detail screen's status pill is
  pending-colored.
- **Pending visual on submarine swap.** Send out via Lightning. Before
  `transaction.claim.pending`, the row is pending-pilled. After
  `invoice.paid`, the row settles to confirmed.
- **Failed swap.** A swap that expires (or that you cancel) renders
  with a red status pill and a text-colored amount (no green).
- **Refunded swap.** A submarine swap that gets refunded renders with
  a neutral pill and a text-colored amount.
- **Balance breakdown pending line.** A pending inbound reverse swap
  causes a "Pending inbound" line to appear above Total. Confirmed
  balance is unchanged. After settlement, the line disappears and
  confirmed balance increases by the same amount.
- **Balance breakdown — no pending.** Fresh wallet, no swaps: no
  pending lines render.
- **Balance audit canary.** Force-emit the warning by stubbing
  `auditBalanceIntegrity` to return a string for one render (smoke
  test only — not a real failure mode). Verify the support bundle
  picks it up via `getRecentErrors`.
- **VTXO list scroll.** Receive 30+ payments to build up multiple
  VTXOs. List renders smoothly, status pills are correct, dust entries
  show as Dust (mutinynet's dust threshold is small but non-zero).
- **Pull-to-refresh.** Trigger a settlement off-screen, swipe down on
  the VTXO list, see preconfirmed entries flip to settled.
- **Dust VTXO labeling.** Send a tiny amount (below `dustSats`) to the
  wallet, confirm the resulting VTXO shows as "Dust" in the list.
- **Recoverable VTXO.** Wait for a VTXO to expire (or force via test
  net), confirm it shows as "Recoverable" rather than "Settled".
- **Asset-bearing VTXO.** Receive an asset (M10). The VTXO row shows
  the "+ ASSET" badge; the detail screen renders the asset block.
- **Copy actions.** Long-press / tap the copy button on outpoint,
  amount, script: toast confirms; pasting into a notes app yields the
  expected canonical strings.
- **Empty state.** Wipe the wallet, navigate to VTXOs: empty state
  renders, no errors.
- **Error state.** With the wallet server unreachable, the list shows
  the inline error + Retry; Retry attempts the fetch again.
- **Explorer fallback.** Tap "Open in explorer" from the error state:
  opens `https://explorer.mutinynet.arkade.sh/address/<arkAddress>`
  in the device browser.
- **Support bundle.** Generate a bundle on a wallet with VTXOs;
  inspect the `vtxos` block: counts match the list, no raw outpoints
  or scripts present.

## Execution Order

Recommended order for an implementation agent:

1. **Phase 1**: theme tokens + `activity-status.ts` helper. No UI
   changes ship in this phase — pure plumbing.
2. **Phase 2**: Activity rendering picks up the pending visuals
   everywhere (list, recent activity preview, detail).
3. **Phase 3**: Balance breakdown gains the pending line + audit
   canary.
4. **Phase 4**: `vtxo-listing.ts` service. No UI yet.
5. **Phase 5**: Routes + Wallet entry point. Compile-only contract
   change.
6. **Phase 6**: VTXO list screen.
7. **Phase 7**: VTXO detail screen.
8. **Phase 8**: Diagnostics summary.

Stop after step 3 if the visual changes reveal classification issues —
pending visibility is the higher-priority half of the milestone.

## Footguns

- The milestone goal language says `rawStatus === 'pending'`. The
  field is `Activity.status`; there is no `rawStatus`. Don't add one
  — rename in the goal text if needed but do not duplicate the field.
- `isSubdust(vtxo, dust)` expects `dust: bigint`. The cached value is
  `dustSats: number`. Always convert via `BigInt(dustSats)`. Forgetting
  this will throw at runtime, not at compile time.
- `wallet.getVtxos()` returns the **full** list. On a wallet with
  thousands of VTXOs the array is large but the FlatList virtualizes
  rendering. Do not pre-format every row eagerly outside of the
  `renderItem` callback — keep the per-row formatting lazy.
- `VirtualStatus.batchExpiry` is **milliseconds** in the SDK
  mapping but may be a block height on regtest (the SDK's
  `isExpired` helper guards against this). The detail screen's
  "Batch expiry" formatter must use the same guard or risk showing
  "1970-01-01" for non-time values.
- The SDK's `available` field is the source of truth for confirmed
  balance. Do not subtract or add anything to it in the renderer.
  The pending section is computed separately from activities, not by
  diffing `total - available`.
- Pending outbound is an edge case: a submarine swap mid-flight does
  decrement spendable balance immediately at the SDK level (the
  Arkade-side lockup VTXO is reserved), so "Pending outbound" is
  *informational only* — it does not change `balanceSats` further.
  Make sure copy reflects this: "Pending outbound" should not read as
  "will-be-deducted".
- The Activity list amount color helper currently lives inline in two
  files. After Phase 2 it lives in one. Future contributors will be
  tempted to copy the inline pattern — leave a one-line jsdoc on
  `statusVisuals` pointing to itself as the single source.
- The `auditBalanceIntegrity` warning is `__DEV__`-gated and
  rate-limited. Forgetting either gate makes the recorder spam every
  snapshot apply, which the diagnostics bundle then truncates. Keep
  the once-per-session guard.
- The VTXO list uses `ensureWallet()` like other screens. Do not call
  `wallet.getVtxos()` against a wallet instance captured at module
  scope — instance lifetime is bound to lock/unlock cycles.
- "Open in explorer" must respect the active network. Use the
  existing `explorerUrl(network, id, kind)` helper; do not hardcode
  the mutinynet base URL.
