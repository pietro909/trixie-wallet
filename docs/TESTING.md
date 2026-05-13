# TESTING.md

How tests are organised and written in this repo today. Descriptive, not prescriptive — every pattern below was established by code that currently lives in `app/services/arkade/__tests__/`. Update this doc when you introduce a new pattern; remove what no longer matches reality.

## Status

Jest is set up via the `jest-expo` preset (`jest.config.js`). As of writing there are 9 test files and 157 tests, all under `app/services/arkade/__tests__/`. There is no UI test layer — no React Native testing-library, no component snapshots — so anything below the service line is currently unverified by automated tests.

```bash
pnpm test               # Run the full suite once
pnpm test:watch         # Re-run on change
pnpm test:coverage      # Coverage report (scope below)
npx jest <path>         # Run a single file or directory
```

## What we test, and what we don't

| Layer | Tested? | Notes |
|---|---|---|
| Pure helpers in `app/services/**` | Yes | All current suites live here. |
| Service modules with side effects (storage, fetch) | Yes, via mocks | See `tx-cache.test.ts` and `lnurl.fetch.test.ts`. |
| Hooks, store actions | No | Possible to add (Zustand makes this easy), nothing currently does. |
| Screens, components | No | No RN testing-library; UI is validated by manual on-device runs. |
| End-to-end | No | Manual smoke testing only; the milestone docs' "Verification Plan" sections are the closest thing to an E2E checklist. |

The line is at "deterministic, no-UI service code." Anything that hits the renderer or the navigator is exercised manually.

## File layout

Tests are co-located with the module they exercise under `__tests__/`:

```
app/services/arkade/
  activity-history.ts
  tx-cache.ts
  lnurl.ts
  __tests__/
    activity-history.builder.test.ts
    activity-history.cache.test.ts
    activity-history.divergences.test.ts
    activity-history.helpers.test.ts
    activity-history.parity.test.ts
    activity-history.trixie.test.ts
    tx-cache.test.ts
    lnurl.test.ts
    lnurl.fetch.test.ts
    fixtures/
      transaction_history.json
```

Naming is `<module>.<facet>.test.ts`. Splitting by facet is the convention when a module has more than one distinct kind of test (see next section). A single file is fine when there's one facet — `tx-cache.test.ts` and `lnurl.test.ts` are flat.

## The four-facet split (Activity History precedent)

For non-trivial modules that have a known reference behavior plus our own extensions, the `activity-history.*.test.ts` files demonstrate a four-way split. Use the same split when a new module hits the same shape; otherwise leave it flat.

| Facet | File | Purpose |
|---|---|---|
| `helpers` | `activity-history.helpers.test.ts` | Pure aggregation functions (`sumValue`, `subtractAssets`, etc.). One assertion per branch, no I/O. |
| `builder` | `activity-history.builder.test.ts` | Synthetic VTXO fixtures driving the full builder. Verifies the row shape per branch. |
| `parity` | `activity-history.parity.test.ts` | Real-world fixture (`fixtures/transaction_history.json`, lifted from the SDK) replayed through the builder, asserting parity with an upstream reference. |
| `divergences` | `activity-history.divergences.test.ts` | Pinned tests for behaviors that intentionally differ from the reference. Each test names the divergence (`DIV-2`, `DIV-3`, …) so removing it silently fails red. |

The `cache` facet (`activity-history.cache.test.ts`) was added later to lock the `previousActivities` reuse path. Add a new facet file rather than mixing concerns when a self-contained feature lands inside an existing module.

## Patterns

### Synthetic fixture builders

Most builder/cache tests construct VTXOs with a one-line helper that fills in defaults, then overrides only the relevant fields. Reproduce this when authoring tests for any new builder.

```ts
const vtxo = (over: Partial<VirtualCoin> = {}): VirtualCoin =>
  ({
    txid: "x",
    vout: 0,
    value: 0,
    status: { confirmed: false },
    virtualStatus: { state: "preconfirmed" },
    createdAt: baseDate,
    isUnrolled: false,
    isSpent: false,
    ...over,
  }) as VirtualCoin;
```

A single base date (`new Date("2026-05-12T12:00:00Z")`) is reused across cases; ordering tests offset from it.

### `it.each` for one-gate-many-inputs

When a single validation gate has multiple equivalent input shapes, use `it.each` instead of N near-duplicate tests. The labels become the documentation.

```ts
it.each([
  ["pending",  ...],
  ["info",     ...],
  ["failed",   ...],
  ["refunded", ...],
])("C-4: prior rows with status=%s are not reused", async (status) => { ... });
```

See `activity-history.cache.test.ts` (status gate) and `lnurl.fetch.test.ts` (parametric ERROR responses, min/max coercion, comment-allowed coercion).

### Mocking a sibling module

For modules whose dependency would drag in expo-sqlite or other native bindings, mock the sibling at module scope with a stub executor. `tx-cache.test.ts` is the canonical example: `./storage` is replaced with an in-memory `Map` plus a `throwMode` toggle, exposed via `__mockHandle` / `__mockExec` for per-test control.

```ts
jest.mock("../storage", () => {
  const store = new Map<string, number>();
  let throwMode: ThrowMode = "none";
  const exec = { run: jest.fn(...), get: jest.fn(...), all: jest.fn(...) };
  const handle = { reset: () => { ... }, setThrowMode: (m) => { throwMode = m; } };
  return { getSharedSqlExecutor: () => exec, __mockHandle: handle, __mockExec: exec };
});
```

`throwMode` includes a `run-once` variant for testing retry-after-failure paths without rewiring mocks mid-test.

### Mocking `global.fetch`

For network code, replace `globalThis.fetch` per test with a typed `jest.fn`. `lnurl.fetch.test.ts` ships two helpers:

```ts
const mockJsonOnce = (body, status?) => fetchMock.mockResolvedValueOnce({
  ok: status >= 200 && status < 300, status: status ?? 200,
  json: async () => body,
});

const mockAbortableFetch = () => fetchMock.mockImplementationOnce((_url, init) =>
  new Promise((_, reject) => {
    init?.signal?.addEventListener("abort", () => {
      const err = new Error("aborted"); err.name = "AbortError"; reject(err);
    });
  }),
);
```

`afterAll` restores the original fetch so the mock doesn't leak to other files. `mockAbortableFetch` makes external-abort and timeout tests deterministic without real timers.

### `jest.resetModules()` for module-level state

When the SUT keeps module-level state (e.g. `tx-cache.ts`'s lazy `initPromise`), call `jest.resetModules()` and re-`require` it in each `beforeEach` so retry-after-init-failure paths can observe a fresh first call.

```ts
beforeEach(() => {
  jest.resetModules();
  const { handle } = loadModules();
  handle.reset();
});
```

### Pinning current behavior with a named divergence

When our behavior intentionally differs from a reference (the SDK, a spec), the divergence file labels each test with an opaque ID (`DIV-N`) and the rationale lives in the test comment. Removing the divergence requires editing the labelled test — silent regressions are caught.

`activity-history.divergences.test.ts` covers `DIV-2` (multi-leaf-per-commitment collapse) and `DIV-3` (BTC offchain receive status). The IDs cross-reference `docs/ACTIVITY_HISTORY.specs.md` §9.3.

## Pitfalls

- **ESM-only deps need to be allowlisted in `transformIgnorePatterns`.** When a new test imports something the bundler hasn't seen, expect a `SyntaxError: Cannot use import statement outside a module`. Add the package to the negative-lookahead group in `jest.config.js`. Current allowlist: `@arkade-os/*`, `@scure/*`, `@noble/*`, `micro-packed`, plus the React Native / Expo baseline.
- **No RN testing-library setup.** The `jest-expo` preset gives us Jest and TypeScript transforms but not the renderer; importing a screen module will pull in real-RN exports that fail under Node. Tests should target services, not screens.
- **No live timers, no real network.** Use `mockAbortableFetch` for abort/timeout contracts; don't `setTimeout(..., 15000)`. If a test needs to advance time, prefer `jest.useFakeTimers()` over real waits.
- **Module-level caches survive within a file.** A test that touches global state (like `tx-cache.ts`'s `initPromise`) must reset modules in `beforeEach`, otherwise the next test starts mid-state.

## Coverage policy

`jest.config.js` has `collectCoverageFrom` scoped to two files today:

```js
collectCoverageFrom: [
  "app/services/arkade/activity-history.ts",
  "app/services/arkade/swap-mappers.ts",
],
```

This is intentional. We add a path here only when the module has a sustained suite that's worth tracking over time. Coverage is a feedback signal — "did this PR drop us 5 points?" — not a gate. There is no minimum-coverage CI check.

## Reference

- `docs/ACTIVITY_HISTORY.specs.md` — the Activity History contract: SDK parity expectations, pinned divergences (DIV-N), fixture plan, invariants. Historical, kept as-is for discoverability when navigating the four-facet split for that module. Newer test work doesn't need to be specced at this level of formality unless it's similarly contract-bound.
