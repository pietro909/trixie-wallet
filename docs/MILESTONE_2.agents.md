# Milestone 2: Lightning Invoices With Boltz Swaps

Goal: enable Lightning invoice support in both Send and Receive while renaming
the user-facing history model from "Transactions" to "Activity".

Swaps are an implementation detail. They may be persisted internally so the app
can claim, refund, restore, and reconcile them, but they must not appear as a
separate user-facing entity, tab, or history list.

The Activity list is a chronological feed of things that happened in the wallet.
Payments, swaps, claims, refunds, VTXO renewal, boarding, and later operational
events can all be represented there without exposing implementation-specific
objects such as swaps as separate product surfaces.

This milestone should prove:

- A user can generate a BOLT11 Lightning invoice from Receive.
- A payer can pay that invoice and the wallet can claim the resulting Arkade
  VHTLC.
- A user can paste or scan an amount-bearing BOLT11 invoice in Send.
- The wallet can pay that invoice through a Boltz submarine swap.
- Lightning activity appears in the Activity list, marked as
  Lightning received, Lightning sent, pending, settled, failed, or refunded.
- A wallet refresh/restart can resume locally known pending swaps after unlock.
- Wallet creation/restoration can import recoverable swap history from Boltz
  without creating a separate "swaps" UX.

## Exploration Summary

### Sibling `../wallet`

The sibling wallet wires Boltz through `../wallet/src/providers/swaps.tsx`.
It uses:

- `ServiceWorkerArkadeSwaps.create(...)`
- `BoltzSwapProvider`
- `IndexedDbSwapRepository`
- a per-network Boltz API URL map:
  - `bitcoin`: `https://api.ark.boltz.exchange`
  - `mutinynet`: `https://api.boltz.mutinynet.arkade.sh`
  - `signet`: `https://boltz.signet.arkade.sh`
  - `regtest`: `http://localhost:9069`
  - `testnet`: unavailable

Receive creates reverse swaps:

- amountless receive does not create a swap;
- fixed-amount receive creates a reverse swap via `createReverseSwap(sats)`;
- the resulting BOLT11 invoice is included in the BIP21 payload;
- `waitAndClaim(pendingSwap)` claims the VHTLC after the invoice is paid.

Send creates submarine swaps:

- the send form accepts BOLT11 invoices only when Boltz is enabled;
- invoices must contain an amount;
- `createSubmarineSwap(invoice)` is called before the review/details step;
- payment sends Arkade funds to the swap address, then waits for settlement;
- the implementation guards against double-funding by checking the swap address
  has no spendable VTXOs before sending.

Restoration in the sibling wallet is intentionally coarse:

- `restoreSwaps()` is hidden in Boltz settings behind repeated taps on the API
  URL;
- the E2E restore test resets/restores the wallet, then verifies the separate
  Boltz app history repopulates;
- restored swaps are stored into IndexedDB if their Boltz ids are not already
  present.

That shape is not suitable for Trixie as-is because Trixie should not expose a
Boltz app or swap history. The useful parts are the provider setup, fee/limit
calculation, send/receive flow sequencing, restore deduplication, and the
double-funding guard.

### Installed `@arkade-os/boltz-swap`

Trixie already depends on `@arkade-os/boltz-swap@0.3.22`,
`expo-background-task`, and `expo-task-manager`.

Relevant package APIs:

- `ArkadeSwaps.create({ wallet, swapProvider, swapRepository, swapManager })` —
  foreground-only constructor, used for the first Milestone 2 slice
- `ExpoArkadeSwaps.setup(...)` — BG-aware constructor (extends
  `ArkadeSwapsConfig` with `ExpoSwapBackgroundConfig`); used only when Expo
  background tasks are wired in a later slice
- `BoltzSwapProvider`
- `SQLiteSwapRepository`
- `createLightningInvoice({ amount, description? })`
- `sendLightningPayment({ invoice })`
- `getFees()`, `getLimits()`
- `getSwapHistory()`
- `restoreSwaps()`
- invoice helpers: `decodeInvoice`, `getInvoiceSatoshis`,
  `getInvoicePaymentHash`

The React Native path is important: the package docs say Expo cannot rely on a
long-lived Service Worker. The intended robust path is `ExpoArkadeSwaps` plus a
global background task. For the first Milestone 2 slice, background tasks are
explicitly deferred because the wallet identity is still behind the app unlock
gate. Foreground SwapManager handling should be wired first; claims/refunds may
pause while the wallet is locked or the app is suspended.

`SQLiteSwapRepository` currently creates a fixed `boltz_swaps` table. It does
not expose the same per-wallet table prefix option used by the SDK wallet
repositories. If Trixie keeps supporting only one active wallet, that is fine.
If multiple wallet records become real, Milestone 2 should either use a
separate SQLite database per wallet for swaps or wrap the repository with a
wallet-scoped adapter.

### Boltz Restore Endpoint

There are two related restore shapes to keep distinct.

Official Boltz API docs, checked on 2026-04-28, describe
`POST /v2/swap/restore` with an `xpub` body. The response is the full set of
associated swaps; the public docs do not show server-side filters such as
status, type, since, or pagination:

https://api.docs.boltz.exchange/swap-restore.html

The installed Arkade Boltz package currently calls the same path with a single
compressed Arkade public key:

```ts
await request("/v2/swap/restore", "POST", { publicKey });
```

No request options beyond that public key are visible in the package types or
implementation. That means "more granularity" must be a local policy unless the
Arkade Boltz endpoint adds extra parameters later.

Local granularity options:

1. Call restore only on specific lifecycle events.
2. Deduplicate restored swaps by Boltz swap id.
3. Filter locally by swap type, status, createdAt, and terminal/non-terminal
   state.
4. Keep a local `lastRestoreAt`/`lastRestoreResult` per wallet and Boltz API URL.
5. A later manual Advanced action can run the same restore and report how many
   Activity records changed.

Restoration caveat: restored swaps may be display/monitoring data only. The
package itself notes that restored swaps can lack local-only data such as the
original Lightning invoice or preimage and are not automatically wired into the
SwapManager. The manager skips claiming a reverse swap if the preimage is
missing and skips refunding a submarine swap if the invoice is missing.

This matters most for pending receives. `createReverseSwap()` generates a random
preimage locally. If local swap storage is deleted before the invoice is paid
and claimed, the restored reverse swap may not be claimable. Do not treat Boltz
restore as a full rescue path for every pending swap unless deterministic
preimages or another recoverable secret strategy is added.

## Product Rules

- Enable Lightning invoice support, not LNURL or BOLT12.
- Keep LNURL disabled unless a later milestone explicitly includes it.
- Do not add a Boltz tab, Boltz app, swap history screen, or user-facing swap
  object.
- The Activity list is the source of truth for user-visible wallet history.
- Activity rows should read like user events: "Lightning received",
  "Lightning sent", "Lightning refund", "VTXO renewed", etc.
- Pending Lightning Activity rows must be visible while waiting for claim,
  settlement, or refund.
- Failed/refunded states must remain visible and actionable enough for support
  diagnostics.
- Reset must not silently delete non-terminal swap state. It should block or
  require explicit confirmation if pending claim/refund data exists.

## Selected Implementation Option

Use direct SDK wallet + the SDK/Boltz Expo utilities as much as possible, with
SQLite-backed swap storage and foreground SwapManager handling in the first
slice.

This is the Option B direction, but not the complete background-task version
yet. The intent is to avoid rebuilding SDK-provided polling, task queues, and
claim/refund scheduling in app code. Background tasks remain the target
architecture, but are not part of the first implementation pass.

The runtime should look like Milestone 1: non-serializable SDK/Boltz instances
stay out of Zustand and AsyncStorage.

Add a runtime module, for example:

- `app/services/arkade/lightning.ts`
- `app/services/arkade/swap-storage.ts`
- `app/services/arkade/swap-mappers.ts`

Responsibilities:

- derive Boltz API URL from wallet network, with an optional future override;
- create `BoltzSwapProvider`;
- create `SQLiteSwapRepository`;
- create the swap runtime via `ArkadeSwaps.create({ wallet, swapProvider,
  swapRepository, swapManager })` for the active unlocked wallet, using the
  Expo `ArkProvider`/`IndexerProvider` already wired in
  `app/services/arkade/runtime.ts` and `SQLiteSwapRepository` from
  `@arkade-os/boltz-swap/repositories/sqlite`;
- defer `ExpoArkadeSwaps.setup(...)` until the later background-task slice —
  its config layer only adds value once `defineExpoSwapBackgroundTask(...)` is
  wired at module scope;
- expose `ensureLightning()`, `disposeLightning()`, `createLightningInvoice()`,
  `sendLightningPayment()`, `refreshLightningActivity()`, and
  `restoreLightningActivity()`;
- subscribe to SwapManager update/completed/failed/action callbacks and refresh
  wallet state and Activity after claim/refund/settlement;
- keep swap preimages/invoices out of Zustand unless a display or support field
  explicitly needs a redacted/copyable value.

Deferred background-task note:

- Do not define `defineExpoSwapBackgroundTask(...)` in the first slice.
- Do not persist a swap-only key or unlocked-session identity secret in this
  milestone.
- Accept that claims/refunds may pause while the app is locked or suspended and
  resume after unlock/foreground refresh.
- Before enabling background tasks later, decide explicitly between an
  unlocked-session key, a swap-only key independent of the app unlock gate, or
  the current "pause while locked" behavior.

## Alternative Options

### Option A: Foreground-only MVP

Use `ArkadeSwaps.create(...)` with `swapManager: true` and
`SQLiteSwapRepository`, but do not define Expo background tasks yet.

Pros:

- smaller implementation;
- easier to debug in the app process;
- enough to validate receive/send UX and Activity mapping.

Cons:

- pending claims/refunds progress only when the app is foregrounded;
- mobile reliability is weaker;
- reset/uninstall during pending receives is riskier.

### Option B: Expo background from the start

Use `ExpoArkadeSwaps.setup(...)` and define `defineExpoSwapBackgroundTask(...)`
at module scope before React mounts. This is the target architecture after the
foreground Milestone 2 slice resolves locked-wallet identity semantics.

Pros:

- matches the package's React Native guidance;
- best-effort claim/refund continues in the background;
- fewer lifecycle surprises after the MVP lands.

Cons:

- more bootstrapping and task queue state;
- requires careful identity reconstruction from secure storage;
- background task behavior needs device/manual verification, not only linting.

### Option C: Manual mode

Disable SwapManager and explicitly call wait/claim/refund functions only from
the active send/receive screens and pull-to-refresh.

Pros:

- simplest mental model;
- least background complexity.

Cons:

- easy to strand pending swaps;
- poor UX for receive invoices paid after the user leaves the screen;
- not recommended except as a short diagnostic fallback.

## Activity Model

Rename the user-facing history model from `Transaction` to `Activity`.

Schema policy:

- Bump persisted app state to schema v3 for the `transactions` -> `activities`
  break.
- Do not migrate v2 wallet state in this development phase.
- Fix `hydrate()` before the rename so it validates `schemaVersion` and discards
  unsupported persisted state instead of silently loading incompatible data.
- It is acceptable for developers to reset/recreate the wallet after this
  schema break.

Implementation scope:

- rename store/UI concepts such as transaction history, transaction rows, and
  transaction items to Activity where they are user-facing;
- keep SDK/Boltz protocol names (`ArkTransaction`, swap, txid, etc.) where they
  describe external APIs or low-level data;
- migrate persisted wallet metadata from `transactions` to `activities`;
- route names and screen names should become Activity-oriented when touched
  (`TransactionsScreen` -> `ActivityScreen`, "Recent Activity", "See all");
- do not create a separate `Swap` UX model.

Suggested shape:

```ts
type Activity = {
  id: string;
  kind: "payment" | "lightning_swap" | "wallet_event";
  direction?: "in" | "out" | "self" | "none";
  amountSats?: number;
  timestamp: number;
  title: string;
  subtitle?: string;
  status: "pending" | "confirmed" | "failed" | "refunded" | "info";
  rail?: "arkade" | "bitcoin" | "lightning";
  source:
    | { type: "arkade_tx"; walletTxId: string }
    | {
        type: "boltz_swap";
        provider: "boltz";
        swapId: string;
        swapType: "reverse" | "submarine" | "chain";
      }
    | { type: "wallet_event"; eventId: string };
  metadata?: Record<string, string | number | boolean | null>;
};
```

The exact field names can change, but the core rule should not: protocol and
swap metadata is attached to Activity rows, not surfaced as its own product
object. `lightning_swap` is an internal Activity kind for this milestone; UI
copy should still say "Lightning received", "Lightning sent", "Lightning
refund", etc., not "swap".

Add a small local metadata table or repository keyed by `swapId` if needed:

- `swapId`
- `walletId`
- `direction`
- `createdForFlow`: `"send"` or `"receive"`
- `invoiceAmountSats`
- `arkadeAmountSats`
- `walletTxId`
- `paymentHash`
- `lastSeenStatus`
- `restoredAt`

This table is internal linkage, not a UI entity. It lets the Activity mapper
avoid duplicate rows and produce better labels.

Required metadata writer:

```ts
type LinkSwapToWalletTxInput = {
  swapId: string;
  walletTxId: string;
  source: "send_result" | "receive_claim" | "history_match";
};

async function linkSwapToWalletTx(input: LinkSwapToWalletTxInput): Promise<void>;
```

Use this writer wherever a wallet tx id becomes known. The deduplication rules
below depend on it.

### Activity Examples

Examples the model should support:

- `Lightning received` - reverse swap, direction `in`, rail `lightning`.
- `Lightning sent` - submarine swap, direction `out`, rail `lightning`.
- `Lightning refund` - submarine refund, direction `in` or `self` depending on
  final balance effect.
- `Arkade received` / `Arkade sent` - SDK wallet history.
- `Bitcoin boarding` - boarding address funding.
- `VTXO renewed` - protocol maintenance event, direction `self`, status `info`
  or `confirmed`.

## Activity Mapping

Build one merged Activity list from:

1. `wallet.getTransactionHistory()`
2. `swapRepository.getAllSwaps({ orderBy: "createdAt", orderDirection: "desc" })`
3. local swap metadata links
4. later wallet/protocol event sources such as VTXO renewal records

Mapping rules:

- reverse swap (`Lightning -> Arkade`):
  - direction: `in`
  - title: `Lightning received` when settled, `Lightning invoice` while pending
  - amount: credited Arkade amount (`response.onchainAmount`) for balance impact;
    optionally show invoice amount in detail text later
  - status: pending until claim/settlement is complete, confirmed after claim,
    failed/expired when Boltz status is final failure
- submarine swap (`Arkade -> Lightning`):
  - direction: `out`
  - title: `Lightning sent` when settled, `Lightning payment` while pending
  - amount: Arkade amount paid to the swap address (`response.expectedAmount`)
  - status: pending until invoice settlement, confirmed after settlement,
    refunded after refund, failed when terminal without refund
- VTXO renewal:
  - direction: `self`
  - title: `VTXO renewed`
  - amount: optional; omit if the amount would be misleading
  - status: `info` or `confirmed`
- chain swaps:
  - do not add new chain-swap creation in this milestone;
  - if restore returns chain swaps created elsewhere, tolerate them in the
    mapper but keep the Milestone 2 UI focused on Lightning.

Deduplication rules:

- Prefer one Lightning-marked Activity over one generic Arkade Activity
  when both refer to the same wallet tx id or swap settlement.
- If a linked wallet tx id is known, use it as the Activity id and attach
  source metadata.
- If no wallet tx id is known, use `swap:${swapId}` as the stable id.
- On later refresh, replace or merge the temporary `swap:${swapId}` row with the
  linked wallet Activity once the tx id is known.
- Do not drop failed or refunded swaps just because they have no wallet history
  entry.

Linkage handshake:

- Send/submarine swaps are straightforward. `sendLightningPayment()` resolves
  with `{ amount, preimage, txid }`. Persist
  `linkSwapToWalletTx({ swapId, walletTxId: txid, source: "send_result" })`
  before navigating to the result screen.
- Receive/reverse swaps are harder because the invoice creation response and
  default SwapManager completion events do not expose the Arkade claim tx id.
- Preferred receive strategy: provide a custom claim callback if the package
  surface allows it, capture the tx id at broadcast/claim time, then call
  `linkSwapToWalletTx({ swapId, walletTxId, source: "receive_claim" })`.
- Fallback receive strategy: after `onSwapCompleted`, refresh
  `wallet.getTransactionHistory()` and find a new incoming tx matching
  `swap.response.onchainAmount` within a tight window after `swap.createdAt`.
  If exactly one match is found, link with source `"history_match"`.
- If no unique receive match exists, keep the stable `swap:${swapId}` Activity
  row and suppress the generic Arkade row only when doing so cannot hide a
  distinct same-amount receive. Two same-amount pending receives must remain two
  rows.
- Document the fallback failure mode in code comments: same-amount reverse swaps
  completing close together can make amount/time matching ambiguous.

## Receive Flow

Enable the Lightning option in `ReceiveSelectScreen` only when the active
network has a configured Boltz API URL.

For Milestone 2, fixed-amount invoices are required:

1. User selects Receive -> Lightning.
2. User enters an amount in sats.
3. Screen calls `createLightningInvoice({ amount, description })`.
4. App persists the pending reverse swap in the swap repository.
5. QR screen displays the BOLT11 invoice.
6. SwapManager or screen-level subscription watches for payment/claim.
7. On completion, refresh wallet snapshot and Activity list.

The existing amountless receive path can keep showing Arkade/Bitcoin only. Do
not add LNURL receive in this milestone.

Receive amount rules:

- Replace the current hardcoded `MIN_SATS = 1` and `MAX_SATS = 4_294_967` in
  `ReceiveLightningAmountScreen` with values from `getLimits()`.
- Cache Lightning limits per network in the Lightning service.
- Prefetch limits when the user lands on `ReceiveLightningAmountScreen`.
- Disable continue with explicit min/max errors before invoice creation.
- Use `getFees()` to estimate the reverse-swap credited amount from
  `reverse.percentage` and `reverse.minerFees.lockup + reverse.minerFees.claim`.
- After invoice creation, prefer `CreateLightningInvoiceResponse.amount` as the
  authoritative credited amount.
- Show both amounts in the receive flow: payer pays the invoice amount, wallet
  receives the post-fee amount.

Failure behavior:

- If Boltz is unavailable, show an inline error and keep Arkade/Bitcoin receive
  working.
- If invoice creation fails, do not leave a stale QR on screen.
- If the app has a pending reverse swap without preimage, mark it as restored
  and not claimable instead of pretending it will auto-complete.

## Send Flow

The parser already recognizes BOLT11-like strings. Replace the current
milestone gate with real Lightning handling.

Required changes:

- validate invoices synchronously with `@arkade-os/boltz-swap` helpers instead
  of the current regex-only amount parser;
- require an amount-bearing BOLT11 invoice for Milestone 2;
- show Lightning as selectable in `SendOptionsScreen`;
- show Boltz fee/limit information in amount/review screens when available;
- call `sendLightningPayment({ invoice })` from the send executor;
- refresh wallet balance/history and merged Activity list after success;
- include payment preimage in internal metadata and optionally make it copyable
  from a future Activity detail screen.

Amountless invoices are out of scope unless the chosen implementation verifies
that `createSubmarineSwap` and Boltz can safely quote and pay them after the
user enters an amount.

Parser strategy:

- Keep `paymentParser.ts` synchronous.
- Use the synchronous `decodeInvoice`, `getInvoiceSatoshis`, and
  `getInvoicePaymentHash` helpers exported by `@arkade-os/boltz-swap`.
- Do not introduce an async parser hop for BOLT11 validation.
- Revalidate invoice expiry immediately before `sendLightningPayment()` because
  a valid invoice can expire between paste/scan and final confirmation.

## Fees And Limits

Use:

- `getFees()` for Lightning swap fee estimates;
- `getLimits()` for minimum and maximum Lightning invoice amounts;
- invoice amount decoding for send amount lock.

Display expectations:

- Receive should distinguish requested invoice amount from expected credited
  amount when Boltz fees reduce the Arkade amount.
- Send should distinguish invoice amount from Arkade amount paid to the swap
  address when fees make those differ.
- Avoid fake fixed fees. If the SDK/Boltz response cannot provide a reliable
  pre-send fee, say the fee is calculated during swap creation.

## Restore Policy

Because the observed Arkade Boltz restore request is only `{ publicKey }`, the
server does not appear to provide the granularity requested here. Choose
granularity locally.

Selected policy:

1. Run Boltz restore when a wallet is created.
2. Run Boltz restore when a wallet is restored.
3. Do not run Boltz restore on normal refresh.
4. Do not run Boltz restore on unlock as part of Milestone 2.
5. Store `lastRestoreAt`, `lastRestoreError`, and `lastRestoreCount`.
6. Add a dedicated on-demand restore button later, outside the first Milestone 2
   implementation slice.

Why not every refresh:

- restore discloses the wallet public key to Boltz every time;
- the endpoint appears to return all swaps for the key;
- local refresh from SQLite plus SwapManager status updates should be cheaper
  and more precise for known swaps.

Why not unlock:

- unlock should be fast and should only recreate local runtime state;
- locally known swaps already live in the swap repository;
- restore is a recovery/import operation, not the normal sync path.

Important reset rule:

- If non-terminal swaps exist, reset must warn that deleting local swap data can
  remove claim/refund material. The app should either block reset or require a
  clear destructive confirmation.
- TODO: The first implementation may need one extra iteration here. The intended
  shape is for `ProfileReset` to ask the Lightning service for a non-terminal
  swap count before calling `resetWallet()`, and for the store action to enforce
  the same guard before clearing state.

Network switch rule:

- Treat Arkade server/network changes like reset for pending swaps.
- If non-terminal swaps exist, block the network switch or require explicit
  confirmation that in-flight swaps may be stranded.

## Advanced Screen

Do not create a Boltz app. Add only operational diagnostics to Advanced:

- Boltz API URL derived for current network;
- connection status;
- Lightning limits and fees;
- last restore timestamp/result;
- manual restore action later, not in the first Milestone 2 slice;
- JSON copy for redacted Lightning diagnostics.

Diagnostics should redact or omit sensitive preimages by default.

## Swap Storage Scope

`SQLiteSwapRepository` uses a fixed `boltz_swaps` table and has no table prefix
option. Trixie's current `AppState.wallet` model is singular, so the first
Milestone 2 implementation can use this repository directly.

Still design the local metadata rows with `walletId`. If multi-wallet support
arrives later, use either a wallet-scoped swap database or a wrapper repository
that filters by wallet id instead of assuming the global `boltz_swaps` table is
safe.

## Error Handling

Add app-level errors for:

- Boltz unavailable for network;
- Lightning disabled/unavailable;
- invalid invoice;
- amountless invoice unsupported;
- invoice expired;
- amount below/above Boltz limits;
- insufficient Arkade balance for Lightning send;
- swap creation failed;
- swap settlement failed;
- swap claim failed;
- swap refund failed;
- restored swap missing local claim/refund data.

Map package errors such as `InvoiceExpiredError`,
`InvoiceFailedToPayError`, `InsufficientFundsError`, `NetworkError`,
`SwapExpiredError`, and `TransactionFailedError` to user-facing copy.

## Verification

Run:

```bash
pnpm lint
pnpm exec tsc --noEmit
pnpm android
```

Manual acceptance:

1. Fresh wallet on mutinynet shows Lightning as available only when Boltz URL is
   configured and reachable.
2. Schema v2 persisted state is rejected cleanly after the v3 Activity break;
   the app does not silently load `transactions` as if they were `activities`.
3. Receive -> Lightning requires an amount, uses Boltz min/max limits, and
   generates a BOLT11 invoice.
4. Receive shows both payer amount and expected post-fee credited amount.
5. Paying that invoice causes the wallet to claim funds and show one
   `Lightning received` Activity.
6. Send accepts an amount-bearing BOLT11 invoice.
7. Sending pays through a submarine swap and shows one `Lightning sent`
   Activity.
8. Pending Lightning send/receive rows survive app restart after unlock.
9. Pull-to-refresh updates pending swap statuses.
10. Wallet creation/restoration imports recoverable Lightning Activity from Boltz
   without adding a swap history screen.
11. Reset warns or blocks when non-terminal Lightning swaps exist.
12. Invoice expiry on Receive is visible on the QR screen; an expired invoice
    stops presenting itself as payable.
13. Send revalidates invoice expiry immediately before `sendLightningPayment()`
    and fails cleanly if the invoice expired between paste/scan and review.
14. Locked while pending is verified with the selected first-slice behavior:
    claims/refunds pause while locked and resume after unlock/foreground refresh.
15. Network/server switch is blocked or explicitly confirmed when non-terminal
    swaps exist.
16. WebSocket dropout is exercised by disabling connectivity mid-flow and
    restoring it; the Activity row must move out of stuck pending when status
    recovery succeeds.
17. Two same-amount pending receives can be generated, paid, and displayed as
    two distinct Activity rows.
18. Backgrounding the app during a pending receive is verified. In the first
    slice the expected result is completion on foreground/unlock, not background
    claim.
19. Boltz 5xx/rate-limit errors on Send and Receive surface clean errors and do
    not leave half-created local Activity rows.
20. Submarine swap review shows any difference between invoice amount and
    Arkade-side expected amount before the user confirms.

## Out Of Scope For Milestone 2

- LNURL pay/receive.
- BOLT12.
- Amountless BOLT11 invoices unless explicitly validated.
- Bitcoin on-chain chain swaps as a product flow.
- A Boltz app, Boltz tab, or separate swap history.
- Production-grade encrypted swap/preimage storage beyond what the package
  currently provides.
- Custom Boltz endpoint filtering unless the endpoint supports it.
- Expo background claim/refund tasks in the first implementation slice.

## Main Risks

- Restored reverse swaps can be missing preimages and may not be claimable.
- Restored submarine swaps can be missing invoices and may not be refundable.
- The observed restore endpoint has no server-side granularity beyond the public
  key.
- `SQLiteSwapRepository` is not wallet-prefixed.
- Claim/refund reliability is weaker until Expo background tasks are added.
- Duplicate rows are easy to create unless swap rows and SDK wallet history are
  reconciled deliberately.
- Resetting local data while swaps are pending can lose claim/refund material.

## Reviewer Observations (Open Items)

These are minor items raised in review that did not block the plan but should
be resolved during implementation.

### History-match fallback — multi-match case

The receive linkage fallback links `swap:${swapId}` to a wallet tx when exactly
one Arkade history entry matches `swap.response.onchainAmount` within a tight
window after `swap.createdAt`. The plan says nothing about the multi-match
case. Required behavior: if 2+ candidate Arkade rows match, link none, and let
both stable swap rows and both Arkade rows coexist until disambiguation is
possible (typically once one of the swaps reaches a terminal status).
Implementer must not pick "the first match" silently.

### Pending swap persistence is transitive

Receive flow step 4 ("App persists the pending reverse swap in the swap
repository") happens transitively inside `createLightningInvoice` via the
SwapManager's `saveSwap` callback — the screen/service must not call
`swapRepository.create` itself. Same for submarine swaps created during send.

### Restore lifecycle timing

"Run Boltz restore when a wallet is created/restored" does not say where in
the flow. Pick one and document it before implementation:

- Blocking before navigation: simpler, slower wallet create/restore.
- Async after navigation: faster create/restore, requires a visible
  "restoring..." state on the Activity list until it returns.

### Background ≠ locked

Acceptance test #14 (locked while pending) and #18 (backgrounded while pending)
test different OS states. RN apps that are backgrounded but not killed still
run JS for a few seconds, so WS events may process. "Completion on
foreground/unlock" is the worst-case expected behavior, not the strict
expected behavior. Document this in the test plan rather than treating
backgrounded == locked.

### `lightning_swap` Activity kind — naming

The internal Activity `kind` value `lightning_swap` leaks Boltz vocabulary
into the type even though UI copy correctly says "Lightning sent/received".
Consider renaming to `lightning_payment` for consistency with the product
framing. Optional; the explicit "internal kind, UI says payment" comment in
the plan already documents the compromise.
