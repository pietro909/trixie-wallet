# Milestone 9: Disaster Recovery Tooling

**Status (2026-05-04):** Implementation complete, pending manual verification —
see the "Manual testing status" section in [README.md](../README.md). The
scenarios under "Verification Plan" below have not been exercised on device
yet; do not treat the recovery surface as battle-tested until they are.

Goal: add operational recovery tools for dangling VHTLCs, claimable or
refundable swaps, unfinalized Arkade transactions, and stranded wallet outputs.

This milestone should prove:

- A user can inspect pending recoverable state before taking recovery actions.
- The wallet can sweep or reconcile dangling outputs that can still be claimed
  or refunded, one item at a time.
- The wallet can finalize Arkade transactions stuck after a crash or network
  drop between `submitTx` and `finalizeTx`, one item at a time.
- Recovery actions are explicit, per-row, and confirmed.
- The app can surface enough state to support manual rescue after a bad reset.

## Current State

- Swap metadata is already tracked in `app/services/arkade/swap-storage.ts`.
  `trixie_swap_meta` carries wallet id, swap id, direction, amounts, payment
  hash, optional linked wallet tx id, and restore/link timestamps.
- Boltz swap rows are persisted through `SQLiteSwapRepository` in
  `app/services/arkade/swap-background.ts`. The underlying `boltz_swaps` table
  is shared and does **not** have a wallet id column, so every recovery scan
  must be scoped through the active unlocked wallet/network and local metadata.
- Activity rows already carry swap and wallet-event lineage via
  `app/services/arkade/activity-history.ts` and
  `app/services/arkade/swap-mappers.ts`.
- The app already resumes pending swaps through `resumeLightningSwaps()` /
  `refreshSwapsStatus()` in `app/services/arkade/lightning.ts`, but those run
  on app start / unlock only — background polling is parked pending
  `arkade-os/boltz-swap#136`. M9 must not assume a background loop has
  already reconciled state before the user opens the recovery surface.
- Reset safety and encrypted backup import/export shipped in Milestone 6.
  Reset clears swap metadata, all Boltz rows, and swap background state, so
  pre-reset inspection/export is the primary rescue path.
- `ActivityDetailsScreen.tsx:185` already exposes one explicit recovery action:
  refundable ARK -> BTC chain swaps call `refundChainSwapById()` ->
  `refundArk()`.
- `AdvancedScreen` carries support-bundle export and Lightning runtime status,
  but recovery does not belong inside Advanced; it ships as a dedicated
  Profile screen.
- Support bundles already include recovery counts through
  `app/services/diagnostics/bundle.ts`, but they do not list individual
  recoverable items.
- The sibling wallet at `../wallet/src/screens/Apps/Boltz/Settings.tsx` already
  ships per-swap submarine recovery for the same boltz-swap version (0.3.24)
  Trixie ships. The patterns there inform Phase 3.

## SDK Surface Available Now

### `@arkade-os/boltz-swap` 0.3.24 (`ExpoArkadeSwaps` / `ArkadeSwaps`)

- `refreshSwapsStatus()` and `restoreSwaps()` for status reconciliation.
- `getSwapHistory()`, `getPendingSubmarineSwaps()`, `getPendingReverseSwaps()`,
  `getPendingChainSwaps()` for inventory.
- `scanRecoverableSubmarineSwaps()` and `inspectSubmarineRecovery(swap)` for
  read-only VHTLC recovery inspection.
- `recoverSubmarineFunds(swap)` for explicit per-swap submarine VHTLC recovery
  (thin wrapper around `refundVHTLC`; per the SDK comment, the caller is
  expected to have already inspected and confirmed `status: "recoverable"`).
- `claimVHTLC(reverseSwap)` and `waitAndClaim(reverseSwap)` for reverse-swap
  claim paths.
- `refundVHTLC(submarineSwap)` for manual submarine refund.
- `refundArk(chainSwap)` for ARK-side chain-swap refunds.
- `getSwapManager()?.isProcessing(swapId)`, `hasSwap(swapId)`, and `getStats()`
  for race checks against the automatic SwapManager.
- Status helpers / type guards: `isReverseSwapClaimable`,
  `isSubmarineSwapRefundable`, `isChainSwapRefundable`, `isReverseFinalStatus`,
  `isSubmarineFinalStatus`, `isChainFinalStatus`.
- `SubmarineRecoveryInfo` shape:
  `{ swap, status, vtxoCount, amountSats, refundLocktime?, error? }`.
  `status` is one of `"recoverable" | "pre_cltv" | "none" | "already_spent" |
  "invalid_swap"`.
- `SubmarineRefundOutcome` shape: `{ swept: number, skipped: number }`.

### `@arkade-os/sdk` (`Wallet`) — wallet-level pending-tx recovery primitives

All primitives below are public on `Wallet`:

- `wallet.arkProvider: ArkProvider` (public readonly).
- `wallet.indexerProvider: IndexerProvider` (public readonly).
- `wallet.identity.sign(tx)` for checkpoint signing.
- `wallet.makeGetPendingTxIntentSignature(coins: ExtendedVirtualCoin[])` —
  builds a `SignedIntent<GetPendingTxMessage>`.
- `wallet.arkProvider.getPendingTxs(intent)` — authoritative server-side stuck
  queue. Returns `PendingTx[]` with `{ arkTxid, finalArkTx, signedCheckpointTxs }`.
- `wallet.arkProvider.finalizeTx(arkTxid, finalCheckpoints)` — per-tx
  finalization.
- `wallet.fetchPendingTxs()` — cheap "is there any in-flight VTXO?" probe via
  the indexer.
- `wallet.finalizePendingTxs(vtxos?)` — bulk helper. **Do not call this from
  the recovery path** (see Footguns).

## Product Rules

- Recovery tooling is operational, not cosmetic.
- Never auto-trigger destructive recovery actions without confirmation.
- Show txids, swap ids, timestamps, and status so the user can understand what
  is actually recoverable.
- Prefer a narrow set of explicit per-row actions over a broad hidden
  "fix everything" button.
- Never write preimages, invoices, private keys, mnemonics, or raw swap payloads
  into Activity metadata, support bundles, toasts, or plain AsyncStorage.
- Treat restored Boltz rows conservatively: they may be useful for display and
  monitoring but can lack local-only claim/refund material. Do not label a
  restored swap as actionable unless the package inspection/action API confirms
  it.
- Prefer read-only scan and status refresh before any recovery action.
- Every action must re-check the current row/status immediately before acting.
- After every action, refresh Lightning status, wallet Activity, and the
  current scan so the user sees the result or the remaining manual-support
  state.
- Avoid "fix" / "repair" / "safe" / "broken" copy unless the scanner has
  confirmed recoverability. Frame each card as a *check*, not a *fix*.

## Recovery Taxonomy

Use this taxonomy for the first implementation pass. It should live in a small
service rather than being encoded directly in the screen.

- **Healthy / no action**: terminal success/refund, or no VTXO at the relevant
  VHTLC address. Submarine inspection statuses `none` and `already_spent`
  fall here. **Hidden** in the UI; counted in the support bundle.
- **Pending / monitored**: non-terminal swap that the SwapManager is already
  monitoring. Show it; default action is "Refresh status" / "Resume".
- **Reverse claimable**: reverse swap in a package-recognized claimable state.
  Action is `claimVHTLC()` or `waitAndClaim()` only after confirming the swap
  still has the required local material.
- **Submarine recoverable now**: `inspectSubmarineRecovery()` or
  `scanRecoverableSubmarineSwaps()` returns `status: "recoverable"`. Action is
  `recoverSubmarineFunds(swap)`.
- **Submarine waiting for timelock**: returns `status: "pre_cltv"`. Show
  amount, VTXO count, refund locktime, and a time-based countdown — no
  immediate action except refresh/support.
- **Submarine cannot inspect**: returns `status: "invalid_swap"`. Show the
  truncated `error` field; hand off to support bundle.
- **Chain refundable**: chain swap is ARK -> BTC and package says it is
  refundable. Action is the existing `refundArk()` path.
- **Pending finalization (wallet-level)**: a `wallet.send()` was interrupted
  between `submitTx` and `finalizeTx`. Server holds the signed
  `AcceptedOffchainTx`; client never finalized. `wallet.arkProvider
  .getPendingTxs(intent)` returns rows. Action is per-row finalize via
  `arkProvider.finalizeTx()` after signing each `signedCheckpointTxs[i]`.
  This is **wallet-scoped, not swap-scoped** — applies to any interrupted
  send, including but not limited to swap-related ones. Independent of
  `arkade-os/boltz-swap#98`, which is a separate ask for the SwapManager to
  call this automatically on startup.
- **Unlinked / restored**: Boltz row exists but `trixie_swap_meta.wallet_tx_id`
  is null or `restored_at` is set. Show as unresolved lineage; do not invent a
  tx link.
- **Arkade settlement anomaly**: Activity history emits an "Arkade settlement"
  wallet-event row with unresolved amount/reason. In M9 this is support-first
  unless a specific SDK sweep/exit API is identified and safely wrapped.

## Selected Direction

Add a dedicated **`ProfileRecovery`** screen, navigable from `ProfileScreen`
alongside the existing `ProfileBackup` / `ProfileLock` / `ProfilePreferences` /
`ProfileReset` entries. The screen organizes recovery work as
**scenario cards**, each card following the same scan → group-by-status →
per-row-action shape. There is no bulk "fix everything" button anywhere.

The page must:

- scan for claimable/refundable Lightning state;
- inspect submarine VHTLC recovery state before sweeping;
- sweep dangling VHTLC-related outputs only when the package reports they are
  recoverable now, one swap at a time;
- discover and finalize stuck Arkade transactions one tx at a time;
- surface unresolved pending/restored/unlinked state;
- surface Arkade settlement anomalies as support-oriented rows;
- hand off to the existing support-bundle flow when the issue needs support
  attention.

Cards in the first ship, in display order:

1. **Unfinalized transactions** — wallet-level stuck txs from `getPendingTxs`.
2. **Submarine VHTLC recovery** — three groups: Refundable now / Waiting for
   timelock / Could not inspect.
3. **Chain swap refunds** — refundable ARK→BTC rows, single button per swap.
4. **Reverse claim** — placeholder; refresh + support bundle only in v1
   (deferred until local-material checks are reliable).
5. **Arkade settlement anomalies** — support-first.

The existing `ActivityDetailsScreen` chain-refund button stays as a contextual
entry; both paths route through the same store action and share the per-row
state map.

`ProfileReset.tsx` gains a secondary "Open recovery" link in the warn banner
alongside the existing "Back up first" link, so a user about to wipe can scan
the on-chain rescue surface first.

## Sibling Wallet Patterns Worth Inheriting

Lifted from `../wallet/src/screens/Apps/Boltz/Settings.tsx` (same boltz-swap
0.3.24 we ship), adapted to RN:

- **Three-bucket grouping by SDK status** for the submarine card:
  `recoverable` ("Refundable now"), `pre_cltv` ("Waiting for timelock"),
  `invalid_swap` ("Could not inspect"). Hide `none` and `already_spent`.
- **Per-row state, not panel-level:**
  ```ts
  recoveringIds: Set<string>           // keys are RecoveryItem.id
  rowErrors: Record<string, RowError>  // keys are RecoveryItem.id
  type RowError =
    | { type: "deferred_locktime" }
    | { type: "message"; message: string };
  ```
  One row's failure does not taint the panel. The Scan button stays disabled
  while any row is in flight.
- **`recoverSubmarineFunds` outcome handling:**
  - `swept > 0` → success toast + auto-rescan.
  - `swept === 0 && skipped > 0` → row error `deferred_locktime` ("Refund
    locktime not reached yet — try again in N").
  - both zero → row error message "Nothing was swept; try again later.".
  - exception → row error with extracted message.
- **Time-based locktime countdown only.** Compute `refundLocktime -
  nowUnixSeconds`, format to days/hours/minutes/seconds. Show "Ready now;
  scan again" when remaining ≤ 0. Drop block-height handling: the sibling
  references `info.currentBlockHeight`, but `SubmarineRecoveryInfo` does not
  carry that field — it is dead code at runtime.
- **Auto-rescan after successful per-row action** so the displayed list
  reflects what's left.
- **No bulk button anywhere on the page.** Every card uses scan-then-per-row.
  This matches the existing footgun against `recoverAllSubmarineFunds()` from
  the UI.

The same per-row state machine generalizes to all cards (chain refund,
pending-tx finalize, reverse claim).

## Quick Wins

- Reuse support bundle helpers from `app/services/diagnostics/bundle.ts` for
  "Needs support" rows; bounce or deep-link to `AdvancedScreen` if the bundle
  share UX is not lifted.
- Consolidate the existing chain-swap refund affordance from
  `ActivityDetailsScreen` into the recovery inventory, while keeping the
  Activity details button for contextual entry.
- Add read-only submarine VHTLC scanning using `scanRecoverableSubmarineSwaps()`
  before implementing any new mutation.
- Extend support bundle `recovery` with redacted counts by recovery category.
  Do not add raw swap ids or arkTxids unless product explicitly accepts that
  support bundle sensitivity change.

## Footguns

- The Boltz repository is shared. Never scan or mutate it while a different
  wallet/network is active.
- Reset deletes the local rescue material. The recovery panel can inspect
  active-wallet state before reset, but after reset the app only has encrypted
  backups and support logs.
- SwapManager may already be processing a swap. Check
  `getSwapManager()?.isProcessing(swapId)` before an explicit swap action and
  block or ask the user to refresh when true.
- A restored reverse/submarine row can be visible but not actionable if the
  preimage/invoice is missing. The scanner must distinguish "known row" from
  "recoverable now".
- Do not call `recoverAllSubmarineFunds()` from UI in the initial milestone.
  Single-item actions keep confirmation and error handling understandable.
- **Do not call `wallet.finalizePendingTxs()` from the recovery path.** It
  short-circuits when `state.settings.hasPendingTx !== true` — a local
  optimization, not a correctness gate. The flag can be missed if the
  previous session crashed before setting it, or be inconsistent after a
  backup restore. Reproduce its body (~25 lines) using
  `wallet.makeGetPendingTxIntentSignature` →
  `wallet.arkProvider.getPendingTxs` → `wallet.identity.sign` →
  `wallet.arkProvider.finalizeTx`. Comment the duplication so a future SDK
  upgrade gets revisited deliberately. Track an upstream ask for public
  `inspectPendingTxs()` / `finalizePendingTx(arkTxid)` so the duplication can
  be deleted later.
- **`SubmarineRecoveryInfo.currentBlockHeight` does not exist** on
  boltz-swap 0.3.24, despite being referenced in the sibling wallet. Use only
  `refundLocktime` (always a Unix timestamp from VHTLCs) for countdowns.
- Refresh/status calls can hit the Boltz API. Keep them user-triggered or
  lightweight on screen entry; do not poll aggressively from render effects.
- Chain swaps can be ARK -> BTC or BTC -> ARK. Trixie currently creates only
  ARK -> BTC in the send flow, but classification should verify direction
  before showing `refundArk()`.
- **Pending-finalize discovery is wallet-scoped.** It signs the
  `GetPendingTxMessage` intent with the active wallet's identity. The same
  wallet/network scoping rule as the Boltz repo applies — never run a scan
  when a different identity is active.
- General stranded Arkade outputs are harder than swap rows. Start by
  surfacing `Arkade settlement` anomalies and VTXO/Activity details; only
  implement a sweep when the SDK offers a clear, idempotent API for that
  exact output type.

## Implementation Plan

### Phase 1 - Recovery Inventory Service

Add `app/services/arkade/recovery.ts` and a sibling
`app/services/arkade/pending-tx-recovery.ts`.

`recovery.ts` responsibilities:

- Ensure Lightning is initialized for the active wallet before scanning swap
  state.
- Call `refreshSwapsStatus()` only from explicit scan/refresh actions, not
  from every render.
- Read Boltz rows through `getLightning().swapRepository.getAllSwaps()` after
  the store has ensured the active wallet instance.
- Read local metadata through `getAllSwapMetadata(walletId)`.
- Call `scanRecoverableSubmarineSwaps()` and merge the returned
  `SubmarineRecoveryInfo` by swap id.
- Call into `pending-tx-recovery.ts` to merge wallet-level pending-finalize
  rows.
- Read current Activity rows from the store or accept them as input so Arkade
  settlement anomalies can be included without recomputing wallet history.
- Classify every item using the taxonomy above. `none` and `already_spent`
  submarine entries stay in counts but are excluded from `items`.

`pending-tx-recovery.ts` responsibilities:

- Reproduce the body of `wallet.finalizePendingTxs` using the public
  providers (see Footguns for the why).
- **Discovery**: enumerate the active wallet's non-swept, non-settled VTXOs
  via `wallet.indexerProvider.getVtxos({ scripts: wallet.getWalletScripts() })`,
  build `ExtendedVirtualCoin[]`, batch into 20-input groups, build a signed
  intent per batch via `wallet.makeGetPendingTxIntentSignature(batch)`, call
  `wallet.arkProvider.getPendingTxs(intent)`, dedupe by `arkTxid`. Returns
  `PendingTx[]`.
- **Per-tx finalization**: for a chosen `pendingTx`, sign each
  `signedCheckpointTxs[i]` with `wallet.identity.sign(...)`, then call
  `wallet.arkProvider.finalizeTx(pendingTx.arkTxid, finalCheckpoints)`.
- Expose a method that accepts a single `arkTxid` (re-runs scoped discovery
  and finalizes only that row) so the store facade does not have to hold
  `PendingTx` objects between scan and action.

Suggested types:

```ts
export type RecoverySeverity = "info" | "attention" | "actionable";

export type RecoveryActionKind =
  | "refresh_status"
  | "claim_reverse_vhtlc"
  | "recover_submarine_vhtlc"
  | "refund_chain_ark"
  | "finalize_pending_tx"
  | "support_bundle";

export type RecoveryItem = {
  id: string;                 // per-row key for recoveringIds / rowErrors
  swapId?: string;            // present for swap rows
  arkTxid?: string;           // present for pending_finalize rows
  walletTxId?: string | null;
  paymentHash?: string | null;
  type:
    | "reverse"
    | "submarine"
    | "chain"
    | "pending_finalize"
    | "arkade_settlement";
  title: string;
  status: string;             // SDK status (e.g. "recoverable", "pre_cltv")
                              // or a synthesized label
  severity: RecoverySeverity;
  createdAt: number;
  amountSats?: number;
  vtxoCount?: number;
  refundLocktime?: number;    // Unix timestamp; used for the countdown
  checkpointCount?: number;   // pending_finalize rows only
  restoredAt?: number | null;
  linkState: "linked" | "unlinked" | "restored" | "not_applicable";
  actions: RecoveryActionKind[];
  detail: string;
};

export type RecoveryScan = {
  scannedAt: number;
  items: RecoveryItem[];
  counts: Record<string, number>;
  reason?: string;
  manager?: {
    isRunning: boolean;
    monitoredSwaps: number;
    websocketConnected: boolean;
    usePollingFallback: boolean;
  };
};
```

Acceptance criteria:

- Empty wallet / unsupported Lightning network returns an empty scan and a
  user-readable reason.
- Non-terminal swaps appear in the scan with swap id, type, status, created
  time, amount, and safe hashes/tx ids.
- Submarine `recoverable`, `pre_cltv`, and `invalid_swap` map to distinct row
  titles/details. `none` and `already_spent` are kept in `counts` but
  excluded from `items`.
- Pending-finalize rows appear with `arkTxid`, `checkpointCount`, and
  `createdAt` derived from local indexer state.
- The classifier is pure enough that most logic can be unit-tested later
  without React.

### Phase 2 - Store Facade

Add to `app/store/useAppStore.ts`:

```ts
recoveringIds: Set<string>;                // keys are RecoveryItem.id
rowErrors: Record<string, RowError>;       // keys are RecoveryItem.id

scanRecoveryState: () => Promise<RecoveryScan>;
runRecoveryAction: (
  action: RecoveryActionKind,
  itemId: string,
) => Promise<RecoveryScan>;
```

Rules:

- `scanRecoveryState` requires an unlocked wallet. If locked / no wallet,
  return a controlled error or empty result for the screen to display.
- `runRecoveryAction` re-runs a focused lookup before mutating. It must not
  act on stale screen state.
- Maintain `recoveringIds` and `rowErrors` so the screen can render per-row
  spinners and error text. Add `itemId` to `recoveringIds` on dispatch,
  remove on settle, write the row error on failure paths.
- Before swap actions, check `getSwapManager()?.isProcessing(swapId)`.
- After actions, call `refreshSwapsStatus()` and `refreshWallet()`. The
  existing wallet-mutation pipeline already flips `security.dirtyForBackup`;
  no new dirty-marking call is needed.
- Record failures with `recordError("swap", ...)` or
  `recordError("lightning", ...)` using redacted messages.

Initial action wrappers:

- `refresh_status`: `refreshSwapsStatus()` then rebuild scan.
- `recover_submarine_vhtlc`: find the submarine swap by id, call
  `inspectSubmarineRecovery()`, require `status === "recoverable"`, then
  call `recoverSubmarineFunds(swap)`. Translate the `SubmarineRefundOutcome`:
  - `swept > 0` → success toast + auto-rescan;
  - `swept === 0 && skipped > 0` → row error `deferred_locktime`;
  - both zero → row error message "Nothing was swept; try again later.";
  - exception → row error with extracted message.
- `refund_chain_ark`: reuse or generalize `refundChainSwapById()`; verify
  the target is a refundable ARK-side chain swap before `refundArk(swap)`.
- `finalize_pending_tx`: call into `pending-tx-recovery.ts` with the row's
  `arkTxid`. After success, auto-rescan. Failure paths follow the same
  per-row-error rules as `recover_submarine_vhtlc`.

Defer `claim_reverse_vhtlc` until the scanner can prove the row has all
local material needed by `claimVHTLC()` / `waitAndClaim()`. It can still
appear as `support_bundle` or `refresh_status` in the first UI pass.

### Phase 3 - Profile Recovery Screen

Add `app/screens/ProfileRecovery.tsx`. Register the route in
`app/navigation/RootStack.tsx` next to the other Profile sub-screens, and
add a `Recovery` row to `ProfileScreen.tsx` that navigates to it.

Layout:

- Header: `Recovery`.
- Top-level **Scan** button: kicks off `scanRecoveryState`, populates each
  card. Disabled while any row is in flight (`recoveringIds.size > 0`).
- Last-scan timestamp + summary counts (e.g. "3 actionable, 1 waiting").
- One **scenario card** per recovery type, in the order listed in *Selected
  Direction*. Each card hides itself when its row count is zero, except
  immediately after a fresh scan with no actionable rows anywhere — in
  which case show a single "Nothing to recover" affordance at the page
  level.

Each row shows type, status, amount, timestamp, primary id (swap id or
arkTxid), supporting ids when available (wallet tx id, payment hash),
restored/unlinked marker, and one clear action button driven by
`RecoveryItem.actions[0]`. Action buttons open `Alert.alert(...)`
confirmation dialogs that name the exact id and outcome.

Per-row UI:

- `recoveringIds.has(item.id)` → spinner on the row's button; button
  disabled.
- `rowErrors[item.id]` → red text under the row content; format
  `deferred_locktime` errors using the time-remaining helper.
- For `pre_cltv` submarine rows, render a countdown derived from
  `refundLocktime - nowUnixSeconds` (no block-height path).
- For `invalid_swap` rows, render the truncated `error` string.

Copy guidance:

- Use operational labels: "Recover VHTLC", "Refund Arkade lockup",
  "Finalize transaction", "Refresh status", "Export support bundle".
- Avoid "fix", "repair", "safe", "broken" language.
- Do not expose package jargon as the primary title; keep `swap id`,
  `VHTLC`, `arkTxid`, and raw statuses in detail rows.

`ProfileReset.tsx` gains a secondary "Open recovery" link in the warn
banner alongside the existing "Back up first" link, so users about to wipe
can scan the rescue surface first.

### Phase 4 - Activity Details Integration

Keep the existing chain refund button in `ActivityDetailsScreen.tsx:185`,
but route it through the same `runRecoveryAction("refund_chain_ark", itemId)`
once Phase 2 exists. Both entry points share the per-row state machine —
the Activity-details button reads/writes the same `recoveringIds` map.

Add a secondary "Open recovery" affordance for failed/refundable
Lightning/Bitcoin Activity rows if navigation complexity is low. If not,
leave this out; ProfileRecovery is the canonical operational surface.

### Phase 5 - Diagnostics

Extend `app/services/diagnostics/bundle.ts` carefully:

- Add counts by recovery category and actionability, generated from the
  same classifier when possible. Include hidden `none` / `already_spent`
  counts so the bundle is more diagnostic than the UI.
- Include SwapManager stats if available.
- Include a count of pending-finalize rows discovered (just the count;
  not the arkTxids unless the product accepts that sensitivity bump).
- Keep individual swap ids and arkTxids out of the bundle. Current copy
  ("Bundles a redacted snapshot... Safe to share with support",
  AdvancedScreen.tsx:258) must keep its contract.

### Phase 6 - Stranded Arkade Outputs

Start support-first:

- Surface `Arkade settlement` Activity rows whose metadata includes
  `settlementReason`, `unresolvedAmountSats`, `commitmentTxid`,
  `inputCount`, and `outputCount` (activity-history.ts:517–530).
- Show these as `arkade_settlement` recovery items with `support_bundle`
  and `refresh_status`, not as sweepable items.
- Investigate SDK support for explicit stranded output sweep/reconcile
  APIs. Do not hand-roll raw transaction recovery from VTXO internals in
  this milestone.

Only add an action here if the SDK exposes a clear method that is:

- scoped to the active wallet;
- idempotent;
- safe to retry;
- able to report tx id / no-op / not-yet-valid distinctly.

## Verification Plan

There is no configured test framework. Use focused manual validation plus
the repo checks.

Commands:

- `pnpm check`
- `./node_modules/.bin/tsc --noEmit`

Manual scenarios:

- Fresh wallet with no swaps and no in-flight sends: scan returns no
  recoverable items and no scary copy.
- Lightning receive pending: row appears as monitored/pending; no
  destructive action is shown before claimability.
- Lightning send failed with submarine VHTLC funds: scanner reports
  `recoverable` or `pre_cltv`; only `recoverable` enables recovery.
  Per-row recover succeeds, list auto-rescans.
- Submarine recovery action: confirmation shows swap id; success reports
  swept count via toast; row disappears or moves to a different bucket on
  rescan; Activity refreshes afterwards.
- Submarine recovery hits `skipped > 0`: row remains, shows
  `deferred_locktime` copy with computed time remaining.
- ARK -> BTC chain swap becomes refundable: recovery card and Activity
  details both offer the same refund path; after refund, row stops showing
  as actionable. Confirm both entry points share the per-row spinner state.
- Force-quit during a `wallet.send()` between submitTx and finalizeTx:
  ProfileRecovery's "Unfinalized transactions" card lists the stuck arkTxid;
  per-row Finalize succeeds; row disappears on rescan. Repeat with
  `state.settings.hasPendingTx` manually unset to confirm the bypass works.
- Restored backup with historical swaps: restored/unlinked rows are visible
  but not over-promised as actionable.
- Reset warning still blocks/warns according to Milestone 6 behavior;
  recovery work must not weaken that gate. The "Open recovery" link from
  the warn banner navigates correctly.
- Support bundle generated after a scan includes category counts (including
  pending-finalize and hidden submarine statuses) and recent errors,
  without secrets / preimages / invoices / arkTxids / swap ids.

## Execution Order

Recommended order for an implementation agent:

1. Build `recovery.ts` classifier and scan result types, including the
   `pending_finalize` row shape but with the action stubbed.
2. Build `pending-tx-recovery.ts` (discovery only) and wire it into
   `recovery.ts`.
3. Add `scanRecoveryState` store facade with per-row state maps.
4. Add the `ProfileRecovery` screen with a single submarine VHTLC card
   (read-only) and support-bundle handoff for any `support_bundle` action.
   Wire `ProfileScreen` and `RootStack` entries.
5. Add `recover_submarine_vhtlc` action with confirmation and the full
   outcome-handling rules.
6. Add the chain-swap refund card; route Activity-details refund through
   the same store action.
7. Add `finalize_pending_tx` action and the "Unfinalized transactions"
   card.
8. Extend diagnostics counts (Phase 5).
9. Add Arkade settlement anomaly card (Phase 6).
10. Revisit reverse VHTLC claim only after proving local-material checks
    are reliable.

Stop after step 4 if the scan classification is ambiguous. A read-only
recovery inventory is already useful; an incorrect recovery button is
worse than no button.
