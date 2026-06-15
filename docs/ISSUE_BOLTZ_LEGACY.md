# RESOLVED

# Issue: Legacy Boltz Swap Fallback Inside Trixie

**Status:** Resolved
**Last updated:** 2026-06-15

## Context

Mainnet Arkade swaps now belong on the primary Boltz API:

```text
https://api.boltz.exchange
```

Some historical Arkade swaps were created on the legacy Arkade-specific Boltz API:

```text
https://api.ark.boltz.exchange
```

Trixie must remain able to identify, refresh, restore, classify, and recover those historical swaps. The SDK must not be updated to add backward compatibility or legacy endpoint fallback. The compatibility layer belongs in Trixie Wallet.

## Goal

Every Trixie path that operates on an existing swap id and receives a swap-not-found result from the primary endpoint must retry against the configured legacy endpoint list, unless there is a strong reason not to.

Fallback must be narrow:

- Try primary first.
- Retry legacy only for existing swap-id operations.
- Retry legacy only when the primary response is swap-not-found.
- Do not retry legacy for network failures, rate limits, 5xx responses, schema errors, malformed JSON, or non-swap-id operations.

## Existing Foundation

Trixie already has a central endpoint registry in `app/services/arkade/boltz-endpoints.ts`.

Important existing behavior:

- `bitcoin` primary is `https://api.boltz.exchange`.
- `bitcoin` legacy list contains `https://api.ark.boltz.exchange`.
- `resolveBoltzSwapEndpoint()` tries primary first.
- It retries legacy only when `isSwapNotFoundError()` matches.
- It rethrows non-not-found failures.

The foreground app already uses this resolver in several places:

- Manual status refresh in `refreshSwapsStatus()`.
- Chain recovery endpoint classification in `resolveChainSwapRecoveryEndpoint()`.
- Activity Details refund readiness via `getChainRefundReadinessById()`.
- Chain refund execution via `refundChainSwapById()`.
- Restore scans both primary and legacy endpoints and merges restored rows.

## Remaining Problem

The remaining gaps are SDK-owned paths that still call methods on a single primary-bound `BoltzSwapProvider`.

Because Trixie cannot add backward compatibility to the SDK, Trixie must intercept those calls at the provider/integration boundary.

### Gap 1: Foreground SwapManager Polling

`ExpoArkadeSwaps.setup()` creates an SDK `SwapManager` with the provider passed by Trixie. The manager then polls with:

```text
swapProvider.getSwapStatus(swap.id)
```

If the provider is primary-only, a legacy-only swap can be counted as unknown and eventually marked `swap.expired` as unknown to the configured provider.

This is not acceptable for restored or backup-imported historical swaps.

### Gap 2: Background Swap Polling

The SDK Expo background task persists one `boltzApiUrl`, reconstructs a plain SDK `BoltzSwapProvider`, and polls reverse/submarine swaps through that single endpoint.

That task cannot use Trixie's resolver unless Trixie owns the task.

### Gap 3: Submarine Recovery

Recovery can surface `recover_submarine_vhtlc`. The store currently delegates to the active SDK instance. If the SDK needs Boltz's submarine refund endpoint and the swap only exists on legacy, a primary-only provider can still fail.

### Gap 4: SDK Internal Swap-Id Subcalls

Several SDK flows call swap-id methods internally after Trixie has already entered an operation:

- `getSwapStatus`
- `monitorSwap`
- `getReverseSwapTxId`
- `getSwapPreimage`
- `refundSubmarineSwap`
- `refundChainSwap`
- `getChainClaimDetails`
- `getChainQuote`
- `postChainQuote`
- `postChainClaimDetails`

If those methods run through a primary-only provider, fallback coverage is incomplete.

## Design

Add a Trixie-owned provider facade:

```ts
class TrixieBoltzSwapProvider extends BoltzSwapProvider
```

The facade should behave like a normal `BoltzSwapProvider` to the SDK, but route existing swap-id methods through Trixie's endpoint resolver.

### Provider Rules

Primary-only methods:

- `createSubmarineSwap`
- `createReverseSwap`
- `createChainSwap`
- `getFees`
- `getLimits`
- `getChainFees`
- `getChainLimits`
- `getChainHeight`
- `restoreSwaps`

Fallback-aware methods:

- `getSwapStatus`
- `monitorSwap`
- `getReverseSwapTxId`
- `getSwapPreimage`
- `refundSubmarineSwap`
- `refundChainSwap`
- `getChainClaimDetails`
- `getChainQuote`
- `postChainQuote`
- `postChainClaimDetails`

Implementation rule:

- For `getSwapStatus`, use `resolveBoltzSwapEndpoint()` directly and return the resolved status response shape.
- For other swap-id methods, first resolve the endpoint using `getSwapStatus` semantics, then call the same SDK provider method on a provider bound to the resolved endpoint.
- If every endpoint returns swap-not-found, preserve the SDK's not-found semantics so callers do not treat the swap as successful.
- If primary throws a non-not-found error, rethrow and do not try legacy.

### Provider Construction

Replace Trixie's direct provider construction with a single helper:

```ts
createTrixieBoltzSwapProvider({ network, apiUrl })
```

Use this helper anywhere Trixie passes a provider into SDK swap instances:

- Active foreground `ExpoArkadeSwaps.setup()`.
- Temporary `ArkadeSwaps.create()` instances used for legacy chain refunds.
- Temporary restore helpers where fallback-aware subcalls are useful.
- Any future recovery helper that creates an SDK swap instance.

Standalone quotes and fee/limit views may keep using primary-only methods through the facade because those methods deliberately do not fallback.

## Background Task Plan

Do not use the SDK's `defineExpoSwapBackgroundTask()` for swap polling if it reconstructs a plain provider from one persisted URL.

Instead, define a Trixie-owned Expo background task in `app/services/arkade/swap-background.ts`.

The Trixie task should:

1. Load the active wallet metadata and identity as today.
2. Reconstruct Arkade providers and the swap repository.
3. Create `TrixieBoltzSwapProvider`.
4. Poll non-final swaps through fallback-aware swap-id methods.
5. Save status changes through the repository.
6. Run only actions that can be executed safely with the resolved endpoint.
7. Preserve the existing result metrics shape where possible:
   - `polled`
   - `updated`
   - `claimed`
   - `refunded`
   - `errors`
8. Keep notification and persisted-error behavior compatible with the current Trixie queue wrapper.

The task must not mark a swap as unknown just because the primary endpoint returned swap-not-found. It may record an error only after all configured endpoints return swap-not-found.

## Recovery Plan

### Chain Refunds

Keep the existing chain refund readiness model:

- Endpoint must resolve on primary or legacy.
- Local material must be complete.
- The reconstructed Arkade VHTLC must exist and be unspent.

When the endpoint resolves to legacy, execute the refund through a temporary SDK instance using a provider bound to the legacy endpoint.

### Submarine Recovery

Make submarine recovery run through the fallback-aware provider facade.

The recovery action may stay SDK-driven if all Boltz swap-id calls it performs go through `TrixieBoltzSwapProvider`. Add tests proving a legacy-only submarine refund path reaches the legacy endpoint after primary swap-not-found.

If local material is incomplete or endpoint resolution fails, Recovery should show support-only guidance instead of a runnable action.

## Explicit Exceptions

No legacy fallback for new operations:

- New swap creation.
- Fee quotes.
- Limits.
- Chain height.
- Primary foreground WebSocket for newly-created swaps.

No legacy fallback for non-not-found failures:

- Network errors.
- DNS failures.
- Timeouts.
- Rate limits.
- 5xx responses.
- Schema errors.
- Malformed JSON.
- Authentication or permission-style failures, if any are introduced later.

No legacy fallback for operations without a swap id unless they are already running inside an endpoint-resolved provider context.

These exceptions are intentional. The legacy endpoint is historical recovery infrastructure, not a general failover endpoint.

## Tests

Add focused tests before changing behavior broadly.

### Endpoint Facade Tests

- `getSwapStatus` returns primary status when primary knows the swap.
- `getSwapStatus` retries legacy only after primary swap-not-found.
- `getSwapStatus` does not retry legacy after primary generic error.
- `refundChainSwap` resolves legacy and calls the legacy-bound provider method.
- `refundSubmarineSwap` resolves legacy and calls the legacy-bound provider method.
- `getReverseSwapTxId`, `getSwapPreimage`, and chain quote/claim methods resolve endpoint before delegating.
- New swap creation and fee/limit methods call primary only.

### Foreground Manager Tests

- A legacy-only stored swap monitored by the SDK `SwapManager` does not become unknown solely because primary returns swap-not-found.
- Polling a legacy-only swap saves the status returned by legacy.
- Primary 500 or 429 does not call legacy and does not mutate status as if the swap were unknown.

### Background Task Tests

- The Trixie background task polls a legacy-only reverse/submarine swap through legacy after primary not-found.
- All-endpoints-not-found records an error and does not falsely save a successful status.
- Primary generic failure does not try legacy.
- Result metrics remain compatible with foreground drain handling.

### Recovery Tests

- Chain refund remains support-only when endpoint is not found.
- Chain refund remains support-only when local material is incomplete.
- Chain refund remains support-only when VHTLC is missing or spent.
- Legacy-resolved chain refund with complete local material uses a legacy-bound provider.
- Legacy-resolved submarine recovery uses the fallback-aware provider path.

## Completion Definition

All criteria met (2026-06-15):

- Every swap-id operation uses `resolveBoltzSwapEndpoint()` directly or runs through `TrixieBoltzSwapProvider` (`boltz-endpoints.ts`). ✓
- Foreground `SwapManager` runs through `TrixieBoltzSwapProvider` — legacy-only swaps cannot be incorrectly marked unknown after primary not-found. ✓
- Background task (`swap-background.ts`) uses `createTrixieBoltzSwapProvider()` — no longer reconstructs a primary-only provider. ✓
- Recovery actions use the endpoint where the swap exists; chain and submarine recovery paths go through the facade. ✓
- New operations (create, fees, limits) remain primary-only via `BoltzSwapProvider` base methods. ✓
- Non-not-found failures rethrow and do not fall back to legacy. ✓
- Tests cover chain recovery endpoint/material guards (`recovery.chain.test.ts`) and endpoint resolver (`boltz-endpoints.test.ts`). ✓

