# Issue 5: Boltz Endpoint Migration and Legacy Recovery

**Status:** Planned  
**Last updated:** 2026-05-26

## Context

Trixie currently overrides the Arkade Boltz SDK mainnet default. The SDK default for `bitcoin` is `https://api.boltz.exchange`, but `app/services/arkade/lightning.ts` pins mainnet to `https://api.ark.boltz.exchange`.

The primary Boltz API now advertises ARK pairs and must be used for all new mainnet Arkade swaps. The legacy Arkade-specific endpoint can still contain historical swaps. Example observed during triage:

- `https://api.boltz.exchange/v2/swap/L4Kx9HZscpJ9` returns swap-not-found.
- `https://api.ark.boltz.exchange/v2/swap/L4Kx9HZscpJ9` returns `swap.expired` with `failureReason: "onchain HTLC timed out"`.

Endpoint migration and recovery correctness are therefore one piece of work. A historical swap can be real on the legacy endpoint even when the primary endpoint returns 404.

## User-Visible Failure

In `Profile -> Recovery`, a historical chain swap can appear under "Chain swap refunds" as "Bitcoin send - refund available". Tapping "Refund Arkade lockup" can fail with an SDK error like:

```text
Swap L4Kx9HZscpJ9: missing timeouts in lockup details
```

Root causes:

- Mainnet traffic still uses the legacy endpoint as the default.
- Recovery treats local `swap.expired` as enough to show a runnable refund.
- The SDK refund path also requires complete local lockup material, especially `response.lockupDetails.timeouts`.

## Non-Negotiable Rules

These rules are implementation constraints, not preferences:

- New mainnet swaps must use `https://api.boltz.exchange` only.
- Legacy fallback is allowed only for existing swap-id based operations after primary returns swap-not-found.
- Legacy fallback is forbidden for new swap creation, fee quotes, limits, WebSocket monitoring, network errors, 5xx responses, rate limits, schema errors, and malformed JSON.
- Recovery must not show `refund_chain_ark` unless the swap is endpoint-resolvable and locally executable.
- If local refund material is incomplete, show support/export guidance instead of a refund button.
- Do not add a user-facing custom endpoint selector.
- Do not add a persisted endpoint field unless live resolution later proves too slow or unreliable.
- Do not schema-bump only for this. This project is alpha, but this issue does not require persisted shape changes.

## Ordered Action List

Complete the items in order. Do not skip ahead: later phases assume names and behavior from earlier phases.

### 0. Baseline Verification

Files to inspect before editing:

- `app/services/arkade/lightning.ts`
- `app/services/arkade/recovery.ts`
- `app/screens/ActivityDetailsScreen.tsx`
- `app/services/arkade/swap-mappers.ts`
- `app/screens/AdvancedScreen.tsx`
- `app/store/useAppStore.ts`

Commands:

```bash
rg -n "BOLTZ_API_URLS|boltzApiUrlForNetwork|refreshSwapsStatus|restoreLightningActivity|refundChainSwapById|quoteSubmarineSwapFee|quoteArkToBtcChainSwap" app
pnpm test -- --runInBand app/services/arkade
```

Expected starting facts:

- `lightning.ts` contains `bitcoin: "https://api.ark.boltz.exchange"`.
- `buildInstance()` constructs `new BoltzSwapProvider({ apiUrl, network })` from that map.
- `refreshSwapsStatus()` delegates to `activeInstance.refreshSwapsStatus()`.
- `refundChainSwapById()` calls `swaps.refundArk(target)` through the active instance.
- Recovery classification adds `refund_chain_ark` from `isChainSwapRefundable(swap)` plus ARK -> BTC direction only.

Stop if any fact is false. Update this plan before implementing.

### 1. Add Endpoint Registry Module

Add file: `app/services/arkade/boltz-endpoints.ts`.

Exports to add exactly:

```ts
import { BoltzSwapProvider, type BoltzSwapStatus } from "@arkade-os/boltz-swap";
import type { NetworkName } from "@arkade-os/sdk";

export type BoltzEndpointSource = "primary" | "legacy";

export type BoltzEndpointConfig = {
  primary: string;
  legacy: string[];
};

export type ResolvedBoltzSwapEndpoint = {
  apiUrl: string;
  source: BoltzEndpointSource;
  status: BoltzSwapStatus;
};

export type BoltzSwapEndpointNotFound = {
  kind: "not_found";
  swapId: string;
  checkedUrls: string[];
};
```

Registry contents:

```ts
export const BOLTZ_ENDPOINTS: Partial<Record<NetworkName, BoltzEndpointConfig>> = {
  bitcoin: {
    primary: "https://api.boltz.exchange",
    legacy: ["https://api.ark.boltz.exchange"],
  },
  mutinynet: {
    primary: "https://api.boltz.mutinynet.arkade.sh",
    legacy: [],
  },
  signet: {
    primary: "https://boltz.signet.arkade.sh",
    legacy: [],
  },
  regtest: {
    primary: "http://localhost:9069",
    legacy: [],
  },
};
```

Helper exports:

- `asBoltzNetwork(network: string): NetworkName | null`
- `boltzPrimaryApiUrlForNetwork(network: string): string | null`
- `boltzLegacyApiUrlsForNetwork(network: string): string[]`
- `boltzApiUrlsForNetwork(network: string): string[]`
- `boltzApiUrlForNetwork(network: string): string | null`
- `isLightningSupportedForNetwork(network: string | null | undefined): boolean`
- `createBoltzSwapProvider(args: { network: NetworkName; apiUrl?: string }): BoltzSwapProvider`
- `isSwapNotFoundError(error: unknown): boolean`
- `resolveBoltzSwapEndpoint(args: { network: string; swapId: string }): Promise<ResolvedBoltzSwapEndpoint | BoltzSwapEndpointNotFound>`

`isSwapNotFoundError` rules:

- Import `SwapNotFoundError` from `@arkade-os/boltz-swap` and return true when `error instanceof SwapNotFoundError`.
- Return true when an error object has `errorData.error` containing `could not find swap`, case-insensitive.
- Return true when `error.message` contains `could not find swap`, case-insensitive.
- Return false for all other errors.

`resolveBoltzSwapEndpoint` rules:

1. Resolve `asBoltzNetwork(args.network)`. If null, throw `new Error("Boltz is not configured for " + args.network)`. Callers wrap that error in the existing `ArkadeError` path.
2. Try primary first.
3. If primary succeeds, return `{ apiUrl: primary, source: "primary", status }`.
4. If primary throws and `isSwapNotFoundError(error)` is false, rethrow that error.
5. If primary throws swap-not-found, try each legacy endpoint in order.
6. If a legacy succeeds, return `{ apiUrl: legacyUrl, source: "legacy", status }`.
7. If every legacy endpoint also returns swap-not-found, return `{ kind: "not_found", swapId, checkedUrls }`.
8. If any legacy endpoint throws a non-not-found error, rethrow that error. Do not continue to later legacy URLs.

Tests to add now:

- New file `app/services/arkade/__tests__/boltz-endpoints.test.ts`.
- Mock `BoltzSwapProvider` constructor and `getSwapStatus`.
- Assert bitcoin primary is `https://api.boltz.exchange`.
- Assert bitcoin legacy list contains only `https://api.ark.boltz.exchange`.
- Assert mutinynet has no legacy URLs.
- Assert resolver tries legacy only after primary not-found.
- Assert resolver does not try legacy after primary generic error.
- Assert all-endpoints-not-found returns `kind: "not_found"` with both checked URLs.

Do not edit `lightning.ts` until these tests exist and pass.

### 2. Move Endpoint Helpers Out Of `lightning.ts`

Edit: `app/services/arkade/lightning.ts`.

Required changes:

- Delete local `BOLTZ_API_URLS`.
- Delete local `asBoltzNetwork`.
- Delete local `boltzApiUrlForNetwork` implementation.
- Delete local `isLightningSupportedForNetwork` implementation.
- Import these names from `./boltz-endpoints` instead:
  - `asBoltzNetwork`
  - `boltzApiUrlForNetwork`
  - `boltzPrimaryApiUrlForNetwork`
  - `createBoltzSwapProvider`
  - `resolveBoltzSwapEndpoint`
  - `isLightningSupportedForNetwork`
  - `type BoltzSwapEndpointNotFound`

Keep re-export compatibility:

```ts
export { boltzApiUrlForNetwork, isLightningSupportedForNetwork } from "./boltz-endpoints";
```

This preserves imports in `AdvancedScreen.tsx`, `swap-mappers.ts`, and store code.

Update provider construction:

- In `buildInstance()`, replace map lookup with `boltzPrimaryApiUrlForNetwork(metadata.network)`.
- Construct provider through `createBoltzSwapProvider({ network, apiUrl })`.
- In `quoteSubmarineSwapFee()` and `quoteArkToBtcChainSwap()`, use `boltzPrimaryApiUrlForNetwork()` and `createBoltzSwapProvider()`.

Hard assertion:

- No remaining `api.ark.boltz.exchange` string may exist in `lightning.ts`.
- The legacy URL should exist only in `boltz-endpoints.ts` and docs/tests.

Verification commands:

```bash
rg -n "api\.ark\.boltz\.exchange|BOLTZ_API_URLS" app/services/arkade/lightning.ts app/services/arkade/boltz-endpoints.ts
pnpm test -- --runInBand app/services/arkade/__tests__/boltz-endpoints.test.ts
```

### 3. Make Status Refresh App-Owned And Fallback-Aware

Edit: `app/services/arkade/lightning.ts`.

Replace the current `refreshSwapsStatus()` body. Do not call `activeInstance.refreshSwapsStatus()` anymore.

Required helper:

```ts
async function refreshOneSwapStatus(swap: BoltzSwap): Promise<void>
```

Behavior:

- Skip final reverse swaps with `isReverseFinalStatus`.
- Skip final submarine swaps with `isSubmarineFinalStatus`.
- Skip final chain swaps with `isChainFinalStatus`.
- For non-final swaps, call `resolveBoltzSwapEndpoint({ network: activeNetwork, swapId: swap.id })`.
- If result is `kind: "not_found"`, record a diagnostic error and do not mutate the row.
- If result has `status`, save the status using the correct SDK helper:
  - `updateReverseSwapStatus` for reverse swaps.
  - `updateSubmarineSwapStatus` for submarine swaps.
  - `activeInstance.swapRepository.saveSwap({ ...swap, status })` for chain swaps, matching current SDK behavior.
- Catch per-swap errors and record diagnostics. Do not fail the whole refresh.

Required exports/imports:

- Import `updateReverseSwapStatus`, `updateSubmarineSwapStatus` from `@arkade-os/boltz-swap` if not already imported.
- Do not import `updateChainSwapStatus`; current SDK refresh saves chain swaps directly and the plan should match that unless a local reason exists.

`refreshSwapsStatus()` behavior:

- If `activeInstance` or `activeNetwork` is null, return.
- Read all swaps with `activeInstance.swapRepository.getAllSwaps()`.
- Run `refreshOneSwapStatus` for all swaps with `Promise.allSettled`.
- Never throw.

Tests:

- Add tests in `app/services/arkade/__tests__/lightning-endpoints.test.ts`.
- Mock repository with one non-final chain swap.
- Primary not-found plus legacy status saves legacy status.
- Primary generic error does not call legacy and does not save.
- Final chain swap is skipped by refresh.

### 4. Add Recovery Endpoint Classification

Edit: `app/services/arkade/recovery.ts` and `app/services/arkade/lightning.ts`.

Add this exported type in `lightning.ts`, not `recovery.ts`, so `recovery.ts` can import it without creating a reverse dependency:

```ts
export type ChainSwapRecoveryEndpointState =
  | { kind: "resolved"; source: "primary" | "legacy"; apiUrl: string }
  | { kind: "not_found" }
  | { kind: "unknown"; error: string };
```

Extend `RecoveryItem` with optional fields:

```ts
endpointSource?: "primary" | "legacy";
endpointState?: "resolved" | "not_found" | "unknown";
materialState?: "complete" | "incomplete";
```

Add exported helper in `lightning.ts`:

```ts
export function canAttemptArkChainRefund(swap: BoltzChainSwap): boolean
```

Exact true conditions:

- `swap.type === "chain"`
- `swap.request.from === "ARK"`
- `swap.request.to === "BTC"`
- `typeof swap.request.preimageHash === "string" && swap.request.preimageHash.length > 0`
- `typeof swap.response.lockupDetails?.lockupAddress === "string" && swap.response.lockupDetails.lockupAddress.length > 0`
- `typeof swap.response.lockupDetails?.serverPublicKey === "string" && swap.response.lockupDetails.serverPublicKey.length > 0`
- `swap.response.lockupDetails?.timeouts != null`

Do not accept `timeoutBlockHeight` as a substitute for `timeouts`.

Add exported helper in `lightning.ts`:

```ts
export async function resolveChainSwapRecoveryEndpoint(swapId: string): Promise<ChainSwapRecoveryEndpointState>
```

Behavior:

- Use `resolveBoltzSwapEndpoint({ network: activeNetwork, swapId })`.
- Map resolved to `{ kind: "resolved", source, apiUrl }`.
- Map `kind: "not_found"` to `{ kind: "not_found" }`.
- Catch errors and return `{ kind: "unknown", error: message }`.

Update `scanRecoveryState()`:

- After `refreshSwapsStatus()`, recovery currently reads sources and classifies synchronously.
- Keep `classifyRecovery()` pure.
- Add an async enrichment step before returning the scan:
  - For each chain item with refundable status, look up the original swap from `sources.swaps`.
  - Compute `materialState` using `canAttemptArkChainRefund`.
  - Resolve endpoint with `resolveChainSwapRecoveryEndpoint`.
  - If material incomplete or endpoint not found or endpoint unknown, replace `actions` with `["support_bundle"]`, set severity to `attention`, and set detail text to the specific reason.
  - If endpoint resolved and material complete, keep `actions: ["refund_chain_ark", "support_bundle"]` and set `endpointSource`.

Specific detail text:

- Material incomplete: `Swap <short> expired, but local refund details are incomplete`.
- Endpoint not found: `Swap <short> is not known by the configured Boltz endpoints`.
- Endpoint unknown: `Swap <short> could not be verified with Boltz`.
- Legacy resolved and material complete: append ` - legacy endpoint` to existing detail.

Tests:

- Add `app/services/arkade/__tests__/recovery.chain.test.ts`.
- Test pure `classifyRecovery()` still creates a chain item for refundable ARK -> BTC status.
- Test async scan enrichment removes `refund_chain_ark` when `timeouts` is missing.
- Test async scan enrichment removes `refund_chain_ark` when endpoint is not found.
- Test async scan enrichment keeps `refund_chain_ark` and sets `endpointSource: "legacy"` when legacy resolves and material is complete.

### 5. Make `ActivityDetailsScreen` Use The Same Material Guard

Edit: `app/screens/ActivityDetailsScreen.tsx`.

Current behavior derives `refundableChainSwap` from activity metadata/status. Tighten it.

Required change:

- Add `getChainRefundReadinessById(swapId: string)` in `lightning.ts`. It reads the stored chain swap, validates ARK -> BTC direction, validates `isChainSwapRefundable`, and returns `"ready"` only when `canAttemptArkChainRefund(swap)` is true. It returns `"missing_material"`, `"not_refundable"`, or `"not_found"` otherwise. `ActivityDetailsScreen` must use this helper before rendering the refund button.
- The button must be visible only when activity says chain refund is available, a swap id exists, and `getChainRefundReadinessById(swapId)` returns `"ready"`.

If the activity says refund available but material is incomplete:

- Show informational copy with no refund button.
- Copy: `This swap expired, but this device is missing the refund details needed to build the Arkade recovery transaction. Export a support bundle from Profile -> Recovery.`

Do not duplicate guard logic in the screen. Import the shared helper from `lightning.ts`.

Tests:

- Existing UI tests do not cover this screen. Add a service-level test for the selector/helper instead of shallow-rendering the screen.

### 6. Restore From Primary And Legacy

Edit: `app/services/arkade/lightning.ts`.

Add helper for legacy endpoints only:

```ts
async function restoreLightningActivityFromLegacyEndpoint(args: {
  wallet: Awaited<ReturnType<typeof getWallet>>;
  swapRepository: SwapRepository;
  network: NetworkName;
  apiUrl: string;
}): Promise<{
  source: "legacy";
  apiUrl: string;
  reverseSwaps: BoltzReverseSwap[];
  submarineSwaps: BoltzSubmarineSwap[];
  chainSwaps: BoltzChainSwap[];
}>
```

Implementation requirements:

- In `restoreLightningActivity(walletId)`, call `const wallet = await getWallet()` once after `getLightning()` succeeds. Pass that wallet into every endpoint restore helper. Do not call `getWallet()` or `ensureWallet()` inside the per-endpoint helper.
- Create a temporary `ArkadeSwaps` instance, not `ExpoArkadeSwaps`, for non-active restore endpoints:
  - `ArkadeSwaps.create({ wallet, swapProvider, swapRepository, swapManager: false })`
- Do not register background tasks.
- Do not attach swap manager subscriptions.
- Do not replace `activeInstance`.

Update `restoreLightningActivity(walletId)`:

1. Ensure active primary instance still exists through `getLightning()`.
2. Build endpoint list with `boltzApiUrlsForNetwork(activeNetwork)`.
3. Call primary restore through the active instance first. Then call `restoreLightningActivityFromLegacyEndpoint` for each legacy endpoint sequentially, not in parallel. Sequential keeps provider/API errors easier to reason about and avoids rate-limit bursts.
4. Call every configured endpoint even if primary restore fails. Restore is best-effort and historical recovery is the point. Record every failure with endpoint host and source. If all endpoints fail, throw `ArkadeError("swap_restore_failed", "Boltz restore failed for all configured endpoints")` after recording the failures.
5. Merge swaps by id with deterministic precedence:
   - Primary object wins by default.
   - If primary object lacks `response.lockupDetails.timeouts` and legacy object has it, merge that field into the primary object.
   - If primary object lacks `response.claimDetails.timeouts` and legacy object has it, merge that field too.
   - Keep first non-empty `preimage`, `ephemeralKey`, `toAddress`, and request pubkeys.
6. Save merged swaps once with `swapRepository.saveSwap`.
7. Record restored metadata once per merged swap id.
8. Run linkage only once per merged reverse/submarine swap.

Tests:

- Primary and legacy both return same swap id: one row saved.
- Primary lacks timeouts and legacy has timeouts: saved row has timeouts.
- Legacy-only swap is saved and metadata recorded.
- Failed legacy restore records error and does not fail primary restore result.

### 7. Execute Chain Refund Through The Resolved Endpoint

Edit: `app/services/arkade/lightning.ts`.

Replace `refundChainSwapById(swapId)` internals.

Required sequence:

1. Get active lightning with `getLightning()`.
2. Load `target` from active repository by id and type `chain`.
3. Validate ARK -> BTC direction.
4. Validate `isChainSwapRefundable(target)`.
5. Validate `canAttemptArkChainRefund(target)`. If false, throw `ArkadeError("swap_refund_failed", "Chain swap is missing refund details on this device")`.
6. Resolve endpoint with `resolveBoltzSwapEndpoint({ network: activeNetwork, swapId })`.
7. If endpoint result is `kind: "not_found"`, throw `ArkadeError("swap_refund_failed", "Chain swap was not found on primary or legacy Boltz endpoints")`.
8. If endpoint source is primary, call `active.refundArk(target)`.
9. If endpoint source is legacy:
   - Get wallet with `getWallet()`.
   - Create temporary `ArkadeSwaps.create({ wallet, swapProvider: createBoltzSwapProvider({ network, apiUrl }), swapRepository: active.swapRepository, swapManager: false })`.
   - Call `temporary.refundArk(target)`.
   - Do not dispose active instance.
10. Wrap thrown errors through `toArkadeError("swap_refund_failed", "Chain swap refund failed", e)` only at the outer boundary.

Test exact cases:

- Primary resolved calls active `refundArk` once.
- Legacy resolved creates temporary instance and calls temporary `refundArk` once.
- Missing `timeouts` throws before endpoint resolution.
- All endpoints not found throws the not-found message.
- Non-ARK->BTC swap throws existing direction error.

### 8. Diagnostics And Support Bundle Context

Edit likely files:

- `app/services/diagnostics/bundle.ts`
- `app/services/arkade/recovery.ts`
- `app/services/diagnostics/recorder.ts` only if the existing recorder cannot carry enough detail.

Add redacted diagnostic facts:

- Count of chain recovery rows by `endpointState`.
- Count of chain recovery rows by `materialState`.
- Count of rows resolved on legacy.
- For errors, include endpoint host only, never full URL with path.

Do not add raw swap ids to new diagnostics unless the support bundle already includes the same ids through existing swap snapshots.

Tests:

- Bundle includes aggregate endpoint/material counts.
- Bundle does not include full swap URL for `L4Kx9HZscpJ9`.

### 9. Advanced Screen Endpoint Copy

Edit: `app/screens/AdvancedScreen.tsx`.

Current display uses `boltzApiUrlForNetwork(lightningNetwork)`. Keep it as primary.

Add optional fallback text only when legacy URLs exist:

- Label: `Boltz API`
- Value: primary URL.
- Subtext: `Legacy recovery fallback: api.ark.boltz.exchange`.

Do not make fallback look selectable. Do not expose a custom endpoint input.

### 10. SDK Timeout Fix Gate

Before marking Issue 5 complete, verify one of these is true:

- `@arkade-os/boltz-swap` has been bumped to a version where restored chain swaps populate `response.lockupDetails.timeouts` for ARK -> BTC refund details.
- Or a local package patch exists and is documented.
- Or recovery intentionally remains support-only for restored chain swaps without timeouts, and this limitation is documented in `ISSUES.md` or this file.

Verification command after package bump or patch:

```bash
rg -n "lockupDetails.*timeouts|timeoutBlockHeights.*lockupDetails|refundDetails" node_modules/.pnpm/@arkade-os+boltz-swap*/node_modules/@arkade-os/boltz-swap/dist -S
```

Manual verification:

- Restore historical swap `L4Kx9HZscpJ9`.
- Inspect stored chain swap JSON.
- Confirm `response.lockupDetails.timeouts` exists before expecting the refund button to appear.

## Final Test Matrix

Run these before closing the issue:

```bash
pnpm test -- --runInBand app/services/arkade/__tests__/boltz-endpoints.test.ts
pnpm test -- --runInBand app/services/arkade/__tests__/recovery.chain.test.ts
pnpm test -- --runInBand app/services/arkade
pnpm test -- --runInBand app/store/__tests__/useAppStore.test.ts
pnpm check
```

Manual smoke checklist:

- Mainnet fee quote hits `https://api.boltz.exchange`.
- New mainnet ARK -> BTC swap creation hits `https://api.boltz.exchange`.
- Legacy swap `L4Kx9HZscpJ9` resolves on legacy after primary not-found.
- A legacy-only swap with complete local material refunds through a legacy-bound temporary instance.
- A legacy-only swap with missing `lockupDetails.timeouts` shows support-only recovery UI.
- Primary 500 or network failure does not try legacy for quote/create/status refresh.
- Mutinynet endpoint behavior is unchanged.
- Advanced screen shows primary endpoint and legacy fallback as informational only.
- Support bundle has aggregate endpoint/material diagnostics and no new unredacted swap URLs.

## Completion Definition

Issue 5 is complete only when all of the following are true:

- `api.ark.boltz.exchange` is not used for new operations.
- Legacy fallback exists for historical swap-id operations only.
- Recovery actions run through the endpoint where the swap exists.
- Recovery and Activity Details never show a refund button for incomplete local refund material.
- Restored chain-swap timeout handling is fixed upstream, locally patched, or explicitly documented as support-only until the package is fixed.
- All tests in the final matrix pass.
