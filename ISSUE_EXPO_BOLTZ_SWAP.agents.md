# Split Expo Background Into an Opt-In Entrypoint

## Summary

Refactor `@arkade-os/boltz-swap` so platform adapters stay opt-in and bundler-safe:

- `@arkade-os/boltz-swap` remains platform-neutral.
- `@arkade-os/boltz-swap/expo` remains Expo foreground-only.
- `@arkade-os/boltz-swap/expo/background` owns Expo OS background-task integration and statically imports `expo-task-manager` and `expo-background-task`.

This is a breaking change for the old `/expo` background exports and the old automatic OS scheduler registration behavior.

## Key Changes

- Create a new `@arkade-os/boltz-swap/expo/background` entrypoint for OS background integration.
- Move `defineExpoSwapBackgroundTask`, `registerExpoSwapBackgroundTask`, `unregisterExpoSwapBackgroundTask`, and `swapsPollProcessor` runtime exports to `/expo/background`.
- Keep `SWAP_POLL_TASK_TYPE` exported from `/expo`; it is a foreground-safe queue constant with no `expo-task-manager` / `expo-background-task` dependency.
- Replace lazy/dynamic `require()` usage with static imports inside `/expo/background`:

  ```ts
  import * as TaskManager from "expo-task-manager";
  import * as BackgroundTask from "expo-background-task";
  ```

- Remove background runtime exports from `@arkade-os/boltz-swap/expo`; `/expo` should export foreground APIs only, such as `ExpoArkadeSwaps`, `ExpoArkProvider`, `ExpoIndexerProvider`, and `SWAP_POLL_TASK_TYPE`.
- Remove auto OS register/unregister from `ExpoArkadeSwaps.setup()` / `dispose()`.
- Keep foreground queue seeding, foreground polling, and `taskQueue.persistConfig(...)` in `ExpoArkadeSwaps.setup()` so the OS task can still rehydrate when `/expo/background` runs.
- Remove `taskName` and `minimumBackgroundInterval` from `ExpoSwapBackgroundConfig`; they belong to explicit consumer calls to `/expo/background`, not foreground setup.
- Add `expo-task-manager` and `expo-background-task` as optional peer dependencies and dev dependencies:

  ```json
  "peerDependencies": {
    "expo-task-manager": "*",
    "expo-background-task": "*"
  },
  "peerDependenciesMeta": {
    "expo-task-manager": { "optional": true },
    "expo-background-task": { "optional": true }
  }
  ```

- Add the new `./expo/background` package export for ESM, CJS, and types.
- Add the new entrypoint to the `tsup` build command.

## Consumer Migration

Expo apps should consume background support explicitly:

```ts
import { ExpoArkadeSwaps, SWAP_POLL_TASK_TYPE } from "@arkade-os/boltz-swap/expo";
import {
  defineExpoSwapBackgroundTask,
  registerExpoSwapBackgroundTask,
  unregisterExpoSwapBackgroundTask,
} from "@arkade-os/boltz-swap/expo/background";
```

Foreground setup should no longer pass OS scheduler fields:

```ts
const swaps = await ExpoArkadeSwaps.setup({
  // existing foreground/core config
  background: {
    taskQueue,
    foregroundIntervalMs: 60_000,
  },
});
```

OS scheduler setup should be explicit:

```ts
const SWAP_BACKGROUND_TASK_NAME = "app-boltz-swap-poll";

defineExpoSwapBackgroundTask(SWAP_BACKGROUND_TASK_NAME, {
  taskQueue,
  swapRepository,
  identityFactory,
});

await registerExpoSwapBackgroundTask(SWAP_BACKGROUND_TASK_NAME, {
  minimumInterval: 15,
});
```

Cleanup is now explicit. Consumers that relied on `ExpoArkadeSwaps.dispose()` to unregister the OS scheduler must call:

```ts
await unregisterExpoSwapBackgroundTask(SWAP_BACKGROUND_TASK_NAME);
await swaps.dispose();
```

## Test Plan

- Build package and inspect generated ESM and CJS output:
  - `dist/expo/index.js` and `dist/expo/index.cjs` must not import `expo-task-manager`, `expo-background-task`, or the background entry/chunk.
  - `dist/index.js` and `dist/index.cjs` must not import Expo background modules.
  - `dist/expo/background/index.js` and `dist/expo/background/index.cjs` must statically import or require `expo-task-manager` and `expo-background-task`.
  - `rg "__require\\(" dist` should return no matches; this verifies the esbuild renamed-require shim no longer appears.
- Add or adjust smoke tests:
  - Import `@arkade-os/boltz-swap` in a non-Expo/web-like environment without installing Expo background packages.
  - Import `@arkade-os/boltz-swap/expo` without installing `expo-task-manager` or `expo-background-task`.
  - Import `@arkade-os/boltz-swap/expo/background` in package tests after adding the Expo background packages to dev dependencies and verify exported functions exist.
- Run existing package checks: `pnpm build`, `pnpm test`, `pnpm lint`.
- In this React Native app, update imports to use `/expo/background`, remove `taskName` and `minimumBackgroundInterval` from foreground setup config, remove the pnpm patch, run `pnpm install`, and verify Metro can bundle.

## Assumptions

- Breaking the old `/expo` background exports is acceptable because clean opt-in adapter boundaries are more important than preserving accidental coupling.
- Explicit OS background registration is acceptable; documentation must include the migration snippet above so Expo consumption remains straightforward.
- `SWAP_POLL_TASK_TYPE` stays in `/expo` because foreground code uses it for queue seeding and it has no OS scheduler dependency.

## Design Notes

- **M2 — Issue options.** This plan implements option 1 from the upstream issue: OS task registration and unregistration are explicit consumer calls from `/expo/background`, not lazy dynamic imports inside `ExpoArkadeSwaps.setup()` / `dispose()`. Option 2 (keep the dynamic edge but isolate it) was rejected because the dependency graph stays cleanest when the background path is reachable only through a single opt-in entrypoint, with no static or dynamic edges from `/expo`. This also makes the bundle smoke test trivial: a single grep on `dist/expo/index.{js,cjs}` proves the boundary holds.

- **M3 — Module top-level requirement.** `defineExpoSwapBackgroundTask` MUST be invoked at module top level — typically in the app's entry file — before React mounts. This is an Expo TaskManager constraint: the task handler must be registered synchronously at JS startup so an OS-scheduled wake can find it. `registerExpoSwapBackgroundTask` and `unregisterExpoSwapBackgroundTask` may be called from normal app lifecycle code. The migration snippet above shows the calls together for brevity, but in practice `defineExpoSwapBackgroundTask` belongs at the top of `index.ts` / `App.tsx` and the register/unregister calls belong in setup/teardown flows. Documentation should reproduce this distinction.
