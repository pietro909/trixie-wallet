# SDK Feedback

Feedback from implementing legacy Boltz endpoint support in Trixie Wallet.

## Keep Legacy Endpoint Policy Out of the SDK

Trixie-specific historical endpoint fallback should remain app-owned. The SDK should stay provider-driven and should not encode Arkade legacy Boltz endpoint policy directly.

## Recommended SDK Improvements

### 1. Add a provider factory for Expo background tasks

```ts
defineExpoSwapBackgroundTask(taskName, {
  taskQueue,
  swapRepository,
  identityFactory,
  providerFactory: ({ network, apiUrl }) => swapProvider,
});
```

The foreground SDK accepts a custom `swapProvider`, but the Expo background task reconstructs `new BoltzSwapProvider(...)` internally. This makes app-level provider behavior impossible without copying the task wrapper.

A typed `providerFactory` or broader `depsFactory` hook would let apps inject custom provider behavior while keeping SDK-owned polling, claim, refund, task result, and queue handling intact.

### 2. Export a background dependency builder

The SDK background wrapper contains useful private setup logic:

- Ark provider and indexer construction
- background wallet shim construction
- background address generation
- task execution through `runTasks`
- result acknowledgement
- poll task re-seeding

Exporting a stable helper for this setup would let apps customize one dependency without duplicating the whole Expo task body.

### 3. Make SwapManager not-found handling configurable

Repeated provider 404 currently means the swap can be marked `swap.expired`. For multi-endpoint or app-specific provider setups, "unknown to this provider" is not necessarily the same fact as "expired".

A policy callback or option would let apps decide whether to:

- mark the swap failed or expired
- keep it pending
- surface a diagnostic state
- retry through app-specific endpoint logic

### 4. Export a robust swap-not-found helper

The SDK exposes `SwapNotFoundError`, but app code still needs to identify equivalent API-shaped errors across environments and tests.

A public helper such as `isSwapNotFoundError(error)` would avoid duplicated parsing logic in apps.

### 5. Document endpoint ownership

The SDK docs should clarify that:

- new swaps use the configured provider endpoint
- historical or multi-endpoint support belongs in a custom provider
- foreground and background paths must use equivalent provider behavior
- background tasks currently reconstruct their own provider unless the SDK adds a factory hook

## Highest-Value Change

The most useful SDK-side change is a typed `providerFactory` or `depsFactory` for `defineExpoSwapBackgroundTask`. That would remove the largest Trixie-side duplication while keeping legacy endpoint policy outside the SDK.
