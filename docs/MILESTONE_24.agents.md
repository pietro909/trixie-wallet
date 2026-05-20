# Milestone 24: Contract Manager

**Status:** Delivered.

## Goal

Replace the lightweight `AddressesScreen` (accessible only from the VTXO list) with a proper Contract Manager section under Profile, giving users a filterable list of all wallet contracts and a detail view that exposes every field — including biometric-gated params and inline label editing.

This milestone should prove:

- Every contract registered against the wallet is discoverable from Profile without navigating through the VTXO list.
- Contracts can be filtered by state (active/inactive) and type (default/delegate) simultaneously.
- Sensitive contract params are never visible without biometric or password confirmation, matching the nsec-reveal pattern in Profile → Backup.
- Labels can be set or updated directly from the detail screen, survive an encrypted backup → restore round-trip, and mark backup dirty on edit.
- VHTLC contracts are silently excluded (no UI entry point) until the Boltz-swap feature that creates them is first-class.
- The old `AddressesScreen` is gone with no dangling imports or nav entries.

## Current State

- `app/screens/addresses/AddressesScreen.tsx` lists contracts as "addresses": type/state pills, truncated address, relative timestamp, optional label. Tap copies the address. Reachable only via "Show all my addresses" in `VtxoListScreen`.
- `app/services/arkade/addresses.ts` provides `loadOwnedAddresses(wallet): Promise<OwnedAddress[]>`, a params-stripped projection of the SDK `Contract` type. The store wraps this in `loadWalletAddresses()` with a per-wallet snapshot cache; `VtxoListScreen` calls that action to cross-reference VTXOs with address data.
- No contract detail view exists. `params`, `metadata`, and label editing are not surfaced anywhere.
- The SDK `ContractManager` exposes `getContracts()`, `updateContract(script, updates)`, and `updateContractParams(script, updates)`. Label updates go through `updateContract(script, { label })`.

## Product Rules

- **Sensitive params stay behind auth.** `pubKey`, `serverPubKey`, `delegatePubKey`, and `csvTimelock` must not be readable without completing `AuthGate`. They must also not be in component state, memoized values, or any other in-memory projection before auth succeeds — fetched fresh on reveal, cleared on blur. This mirrors the secret-reveal pattern in `ProfileBackup`, where `readSecret()` runs only inside the AuthGate `onSuccess` callback and the secret state is null until then. The list/summary projection in `app/services/arkade/addresses.ts` already enforces this by stripping `params` at the service boundary; the new contract service follows the same split.
- **VHTLCs are invisible for now.** Filter them out at the service layer. Do not render placeholder rows or mention them in copy.
- **Labels belong to the user, and they survive restore.** The SDK supports optional labels; the detail screen must make them easy to set and update inline without leaving the screen. Labels are user data — they participate in the encrypted backup envelope and are re-applied on import (see §8). Editing a label also marks backup dirty, so the Profile → Backup screen shows the "stale" warning until the user re-exports, matching every other persisted user edit (`walletBehavior`, `importedAssetIds`, etc.).
- **Clean deletion.** `AddressesScreen` and the `Addresses` nav route are removed outright. No redirects or backwards-compat stubs.
- **The store owns runtime access; screens call store bridge actions.** `AppState['wallet']` is `ArkadeWalletMetadata` (not an SDK `Wallet`), and every runtime-backed read in the app — `loadWalletAddresses`, `loadWalletVtxos`, balance reads, intent submissions — flows through a store action that calls `ensureWallet({ metadata, behavior })` and then delegates to a service function. The new contract screens follow the same pattern via `loadWalletContractSummaries` / `loadWalletContractParams` / `updateWalletContractLabel` (see §1b). Screens never import the SDK `Wallet` type or call service functions directly. The existing `loadWalletAddresses` is left untouched — `VtxoListScreen` still uses its `OwnedAddress` projection for VTXO cross-referencing — and contract data itself is **not** stored in Zustand: the SDK `ContractManager` is the source of truth, and the bridge actions re-fetch on demand rather than caching.
- **No pagination.** A wallet carries a small number of contracts (typically two: default + delegate). A flat list is correct.

## Selected Direction

Two new screens under `app/screens/contracts/`, a thin service module at `app/services/arkade/contracts.ts`, three new store bridge actions in `app/store/useAppStore.ts` (so screens consume runtime-backed reads via the store like every other Wallet-touching screen), and surgical updates to navigation, the Profile menu, and `VtxoListScreen`.

### ContractsScreen

Filterable list of all non-VHTLC contracts. Entry point: Profile → "Contracts" (new `Layers` icon menu item, inserted between Preferences and Backup).

Filter bar above the list (horizontal scroll, combinable):
- State: `All` · `Active` · `Inactive`
- Type: `All` · `Default` · `Delegate`

Both rows lead with an explicit `All` chip — selected by default — so the `"all"` value of each filter state (see §2) is reachable from the UI. Deselecting a specific chip returns to `All`; chips are mutually exclusive within a row.

Each row shows type pill + state badge + address (mono, `ellipsizeMode="middle"`) + relative timestamp + optional label. Pull-to-refresh. Empty state varies per filter combo. Tap → `ContractDetail`.

### ContractDetailScreen

Full view of a single contract identified by `script`. Fetches fresh data on mount.

| Section | Content |
|---|---|
| Header | Type pill + state badge |
| Label | Tappable row: shows current label or "Tap to add label" placeholder; tapping opens inline `TextInput` with a Save button; saving calls `updateContractLabel` |
| Address | Mono value + Copy button |
| Script | Truncated mono value + Copy button |
| Created at | Relative timestamp |
| **Params** | Locked by default — "Reveal" button triggers `AuthGate`. On success: each param as a labeled row with Copy. Hidden again on screen blur. |
| Metadata | Collapsible section, only rendered when `metadata` is non-null/non-empty; raw JSON in mono box |
| Actions | "View in Explorer" button (address-based, same `explorerUrl` helper as `AddressesScreen`) |

Human-readable param labels:

| SDK key | Display label |
|---|---|
| `pubKey` | Your Public Key |
| `serverPubKey` | Server Public Key |
| `delegatePubKey` | Delegate Public Key |
| `csvTimelock` | CSV Timelock |

Any param key not in the table above is rendered as-is (title-cased).

## Implementation Plan

### 1. Service layer — `app/services/arkade/contracts.ts`

The service is split into a **public-fields-only** loader (for the list and the detail screen's non-sensitive sections) and an **auth-gated params loader** (called only from inside an `AuthGate.onSuccess` handler). Screens never receive the full SDK `Contract` shape, so `params` cannot leak into component state by accident.

Create this file with three exports:

**`loadContractSummaries(wallet: Wallet): Promise<ContractSummary[]>`**
- Calls `wallet.getContractManager()` → `cm.getContracts()`.
- Filters out contracts where `contract.type === "vhtlc"`.
- Sorts: `default` first, remaining by `createdAt` descending.
- Projects each `Contract` to `ContractSummary` (defined below) — **drops `params`**.
- Throws `toArkadeError("contracts_fetch_failed", ...)` on SDK errors.

```ts
export type ContractSummary = {
  type: string;
  state: ContractState;
  address: string;
  script: string;
  label?: string;
  createdAt: number;
  metadata?: Record<string, unknown>;
};
```

This is structurally `OwnedAddress` plus `metadata`. The existing `OwnedAddress` in `addresses.ts` is left alone (still used by `VtxoListScreen`); we intentionally duplicate the small shape rather than couple the two surfaces.

**`loadContractParams(wallet: Wallet, script: string): Promise<Record<string, string>>`**
- Calls `wallet.getContractManager()` → `cm.getContracts({ script })`, takes the first result.
- Throws `toArkadeError("contracts_params_not_found", ...)` if no contract matches.
- Returns just the `params` map. Nothing else from the `Contract` is exposed.
- Throws `toArkadeError("contracts_fetch_failed", ...)` on SDK errors.

This function is contract-callers-must-AuthGate-first by convention. Document this in the function's JSDoc and confirm in code review that every call site is wrapped in `requestAuth(...)`.

**`updateContractLabel(wallet: Wallet, script: string, label: string): Promise<void>`**
- Calls `wallet.getContractManager()` → `cm.updateContract(script, { label: label.trim() || undefined })`.
- Passing `undefined` clears the label (empty string after trim → remove it).
- Throws `toArkadeError("contracts_update_failed", ...)` on SDK errors.

**`loadContractLabelsForBackup(wallet: Wallet): Promise<ContractLabelBackup[]>`**
- Calls `wallet.getContractManager()` → `cm.getContracts()`.
- Filters out VHTLCs (consistent with the rest of this milestone).
- Filters to contracts where `contract.label` is a non-empty string.
- Returns `{ script, label }` for each. Used only by the backup export path (§8).
- Throws `toArkadeError("contracts_fetch_failed", ...)` on SDK errors.

`ContractLabelBackup` is the cross-boundary shape consumed by the serializer; defined alongside the service:

```ts
export type ContractLabelBackup = { script: string; label: string };
```

`ContractSummary` is exported for screen use. The screens do **not** import `Contract` from the SDK — they only see the summary projection plus the bare `Record<string, string>` returned by `loadContractParams`.

The service functions all take a runtime SDK `Wallet`. Screens never get a `Wallet` directly — they go through the store bridge actions in §1b, which call `ensureWallet({ metadata, behavior })` and then delegate to the service. This matches `loadWalletAddresses` (`app/store/useAppStore.ts:2437`), `loadWalletVtxos`, and the other runtime-backed store actions.

### 1b. Store bridge — `app/store/useAppStore.ts`

`AppState['wallet']` is `ArkadeWalletMetadata`, not an SDK `Wallet`. Screens use store actions that hold the metadata + behavior and convert to a `Wallet` via `ensureWallet` on each call. Add three actions next to `loadWalletAddresses`.

**`loadWalletContractSummaries(): Promise<ContractSummary[]>`**
- Reads `metadata = get().wallet`; throws `ArkadeError("wallet_not_ready", "No wallet available")` when null.
- Throws `ArkadeError("wallet_not_ready", "Unlock the wallet first")` when `get().security.isLocked`.
- `const wallet = await ensureWallet({ metadata, behavior: get().walletBehavior })`.
- Returns `loadContractSummaries(wallet)`.
- **No snapshot cache.** Wallets typically have 2 contracts; the fetch is cheap and label edits + state changes can invalidate freshness. `useFocusEffect` re-runs this on every focus.

**`loadWalletContractParams(script: string): Promise<Record<string, string>>`**
- Same `metadata` + lock guards as above.
- `ensureWallet` → `loadContractParams(wallet, script)`.
- **No cache, ever.** Each call hits the SDK fresh. The detail screen only invokes this from inside `AuthGate.onSuccess` and clears the returned bytes on blur.
- Document in JSDoc that this action returns sensitive material and must only be called from an authenticated path.

**`updateWalletContractLabel(script: string, label: string): Promise<void>`**
- Same guards.
- `ensureWallet` → `updateContractLabel(wallet, script, label)`.
- **After the SDK update resolves**, atomically commit *both* backup-state writes in a single `set()`, then `await persist(get())`:

  ```ts
  set((s) => ({
    security: {
      ...s.security,
      dirtyForBackup: true,
      latestContractLabelWriteAt: Date.now(),
    },
  }));
  await persist(get());
  ```

  Two reasons for inlining the dirty flag into this `set()` rather than calling the `markDirtyForBackup()` helper:

  1. **`markDirtyForBackup` is fire-and-forget-safe only when the caller has a later `await persist(get())` that supersedes its internal chain.** The helper returns a `Promise<void>` and calls `persist(useAppStore.getState())` itself (`app/store/useAppStore.ts:211-218`). `setWalletBehavior`, `importAsset`, and `forgetAsset` all get away with not awaiting it because each does its own subsequent `await persist(get())` — that second persist coalesces via `persistChain`'s dedup and ends up writing the final state. Mirroring that here would mean either (a) awaiting `markDirtyForBackup` then writing the timestamp then awaiting persist again — two serialized writes — or (b) firing it without await alongside our own persist — two writes racing through the persist queue with the same end state but wasted work. Both shapes are messier than one `set()` + one `await persist(get())`.
  2. **It matches the pattern `importBackup` already uses** for its atomic commit (`app/store/useAppStore.ts:2135-2153`), where `lastBackupAt`, `dirtyForBackup: false`, and the wallet/preferences slices are all written in a single `set()` followed by one `await persist(get())`. Same surface, same write semantics — one less helper, one less invariant to remember.

  The label change is user data that diverges the wallet from any previously-exported backup, so the Profile → Backup "stale" warning must fire — `dirtyForBackup: true` does that. The timestamp signal lets `getBackupHealth` recognize labels as backup-worthy material — without it, the Profile → Backup screen would render the misleading "Nothing to back up yet" copy for a wallet whose only material is labels (see §8 "Backup health"). The timestamp is set on every label write — including clears — to mirror how swap-metadata timestamps work (`getLatestSwapMetadataWriteAt`): the existence of a write is the signal, not the current population. A wallet that once had labels but cleared them all stays in `"fresh"` / `"stale"` / `"outdated"` rather than dropping back to `"no-material"`, same as a wallet that once had swaps.

  > **If a future refactor splits these two writes**, the dirty-flag setter must either be awaited or be followed by another awaited persist of the same scope. Fire-and-forgetting `markDirtyForBackup()` without a later persist would leave the dirty flag set in memory but not on disk — a hard-to-find bug where the stale warning vanishes after an app restart.

- Does not otherwise write to the contract data — that lives in the SDK `ContractManager`. After this resolves, the detail screen calls `loadWalletContractSummaries()` to pick up the new label.

Type additions to `AppState` (above `setTheme`, mirroring the existing `loadWalletAddresses` declaration on line 475):

```ts
loadWalletContractSummaries: () => Promise<ContractSummary[]>;
loadWalletContractParams: (script: string) => Promise<Record<string, string>>;
updateWalletContractLabel: (script: string, label: string) => Promise<void>;
```

Imports in the store: add `ContractSummary`, `loadContractSummaries`, `loadContractParams`, `updateContractLabel` from `../services/arkade/contracts`. (The existing `loadOwnedAddresses` import stays — `loadWalletAddresses` is unchanged.)

### 2. ContractsScreen — `app/screens/contracts/ContractsScreen.tsx`

State:
- `contracts: ContractSummary[]` — list from `loadContractSummaries` (no `params`)
- `loading: boolean` / `refreshing: boolean` / `error: string | null`
- `stateFilter: "all" | "active" | "inactive"` (default `"all"`)
- `typeFilter: "all" | "default" | "delegate"` (default `"all"`)

Data loading:
- `useFocusEffect` triggers initial load.
- The screen calls the store's `loadWalletContractSummaries()` action — same pattern as `VtxoListScreen` reaching for `loadWalletAddresses`. The action handles `ensureWallet` + lock-state checks internally. The screen does not import the SDK `Wallet` type.
- Filter the loaded list client-side so switching chips does not refetch.
- `params` are never fetched on this screen — only the detail screen, behind AuthGate, ever touches them.

Derived list: `contracts.filter(c => stateMatch && typeMatch)`.

Filter bar: two horizontal `ScrollView`-or-`View` chip rows (one for state, one for type). Chips use the same pill shape as existing type/state pills; selected chip uses `theme.colors.primary` background + `theme.colors.onPrimary` text.

Row layout — `FlatList` item:
- Left cluster: type pill + state badge, same visual as current `AddressesScreen`.
- Center: mono address with `ellipsizeMode="middle"`, optional label in `textSubtle`.
- Right: relative timestamp.
- Full row is a `Pressable` that navigates to `ContractDetail` passing `{ script: item.script }`.
- `ChevronRight` icon at the trailing edge.

Navigation type for this screen:
```ts
type Nav = NativeStackNavigationProp<RootStackParamList, "Contracts">;
```

### 3. ContractDetailScreen — `app/screens/contracts/ContractDetailScreen.tsx`

Receives `route.params.script: string`. Mounts → `loadWalletContractSummaries()` (store action) → find by `script`. The summary covers everything the screen renders by default: header, label, address, script, createdAt, metadata, explorer link. `params` are **not** fetched at this point.

Auth + params state — identical structure to `ProfileBackup`'s `readSecret`-after-auth flow:
```ts
const [authVisible, setAuthVisible] = React.useState(false);
const [authAction, setAuthAction] = React.useState<{ run: () => void } | null>(null);
const [params, setParams] = React.useState<Record<string, string> | null>(null);
const [paramsLoading, setParamsLoading] = React.useState(false);
const [paramsError, setParamsError] = React.useState<string | null>(null);

function requestAuth(onSuccess: () => void) {
  setAuthAction({ run: onSuccess });
  setAuthVisible(true);
}

async function handleReveal() {
  if (params) {
    // Already revealed — tapping again hides.
    setParams(null);
    return;
  }
  requestAuth(async () => {
    setParamsLoading(true);
    setParamsError(null);
    try {
      const fresh = await loadWalletContractParams(script);
      setParams(fresh);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not load params";
      setParamsError(msg);
      showToast(msg, "error");
    } finally {
      setParamsLoading(false);
    }
  });
}
```

`loadWalletContractParams` is the store action (see §1b), selected via `useAppStore((s) => s.loadWalletContractParams)`. The screen does not pull a `Wallet` from anywhere — the store does the `ensureWallet` + lock check, and the only thing crossing back into screen state is the `Record<string, string>` of params.

The `params` boolean-and-state pattern matters: `params === null` means "not revealed" AND "not in memory". We never keep a separate `paramsRevealed: boolean` that could drift from the actual presence of the bytes.

On screen blur, **clear the params bytes**, not just a visibility flag:
```ts
useFocusEffect(
  React.useCallback(() => {
    return () => {
      setParams(null);
      setParamsError(null);
    };
  }, []),
);
```

If the user re-enters the screen and re-reveals, `loadContractParams` re-fetches from the SDK. The fetch is cheap (a single `getContracts({ script })` filter) and means sensitive bytes never outlive an active AuthGate session.

Label editing state:
```ts
const [editingLabel, setEditingLabel] = React.useState(false);
const [labelDraft, setLabelDraft] = React.useState("");
const [labelSaving, setLabelSaving] = React.useState(false);
```

On "Tap to add label" or tapping the existing label, set `editingLabel = true` and `labelDraft = summary.label ?? ""`. Save button calls the store's `updateWalletContractLabel(script, labelDraft)`, then calls `loadWalletContractSummaries()` and refinds the entry by `script` to refresh the local summary, then exits edit mode. The reload uses the summary action — label edits never need a params refetch.

Copy helper — identical to existing screens: `Clipboard.setStringAsync` + `Haptics.selectionAsync` + `showToast("… copied", "success")`.

Params section render (only when `params !== null`):
```ts
const PARAM_LABELS: Record<string, string> = {
  pubKey: "Your Public Key",
  serverPubKey: "Server Public Key",
  delegatePubKey: "Delegate Public Key",
  csvTimelock: "CSV Timelock",
};

function paramLabel(key: string): string {
  return PARAM_LABELS[key] ?? key.replace(/([A-Z])/g, " $1").trim();
}
```

While `params === null` and `paramsLoading === false`, render the locked-state row with a "Reveal" button. While `paramsLoading === true`, render an inline spinner. While `params !== null`, render each entry as a labeled row with a Copy button, and a "Hide" toggle that clears `params` back to `null`.

Metadata section: only rendered when `summary.metadata && Object.keys(summary.metadata).length > 0`. Use a `useState<boolean>` for collapsed/expanded. Display `JSON.stringify(summary.metadata, null, 2)` in a mono `Text` with `selectable`.

Explorer action: calls `explorerUrl("arkade_address", summary.address, network)` from `app/services/activity-details/explorer` (same import as the old `AddressesScreen`).

Place `<AuthGate ... />` at the root level of the return, same as `ProfileBackup`.

Navigation type:
```ts
type Nav = NativeStackNavigationProp<RootStackParamList, "ContractDetail">;
type Route = RouteProp<RootStackParamList, "ContractDetail">;
```

### 4. Navigation — `app/navigation/RootStack.tsx`

**`RootStackParamList` changes:**
- Add `Contracts: undefined`
- Add `ContractDetail: { script: string }`
- Remove `Addresses: undefined`

**Imports:** add `ContractsScreen` and `ContractDetailScreen`; remove `AddressesScreen`.

**Stack registrations** (inside the main app flow, near the other Profile screens):
```tsx
<Stack.Screen
  name="Contracts"
  component={ContractsScreen}
  options={{ ...headerOptions, title: "Contracts" }}
/>
<Stack.Screen
  name="ContractDetail"
  component={ContractDetailScreen}
  options={{ ...headerOptions, title: "Contract" }}
/>
```

Remove the `Addresses` `Stack.Screen` registration.

### 5. Profile menu — `app/screens/ProfileScreen.tsx`

- Import `Layers` from `lucide-react-native` (add to existing import).
- Extend `MenuRoute`: add `"Contracts"`.
- Add to `MENU_ITEMS` between Preferences and Backup:
  ```ts
  { label: "Contracts", icon: Layers, route: "Contracts" },
  ```

### 6. VtxoListScreen — `app/screens/vtxos/VtxoListScreen.tsx`

One-line change: `nav.navigate("Addresses")` → `nav.navigate("Contracts")`. No other changes — `loadWalletAddresses` usage for VTXO cross-referencing stays as-is.

### 7. Delete `AddressesScreen`

- Delete `app/screens/addresses/AddressesScreen.tsx`.
- Delete `app/screens/addresses/` directory if empty.
- Confirm no remaining imports of `AddressesScreen` or `OwnedAddress` in any file other than `app/services/arkade/addresses.ts`, `app/store/useAppStore.ts`, and `app/screens/vtxos/VtxoListScreen.tsx` (which intentionally keeps the existing projection).

### 8. Label durability — backup & restore

Contract labels are user data. The encrypted backup envelope must carry them, and import must re-apply them to the freshly-bootstrapped `ContractManager`. The serializer follows the same v1 → v2 → v3 pattern used when `importedAssetIds` was added.

**Serializer changes — `app/services/backup/serializer.ts`:**

- Bump `PAYLOAD_VERSION` from `2` to `3`.
- Extend `SUPPORTED_VERSIONS` to `new Set<number>([1, 2, 3])` so older backups still import.
- Import `ContractLabelBackup` from `app/services/arkade/contracts.ts` — that file is the single source of truth (declared in §1). The serializer does **not** redefine it, re-export it, or wrap it. Importing a type from the service into a sibling-service module is consistent with how the existing serializer imports `LocalSwapMetadata` from `../arkade/swap-storage` and `BoltzSwap` from `@arkade-os/boltz-swap`.
- Define `BackupPayloadV3`:
  ```ts
  export type BackupPayloadV3 = Omit<BackupPayloadV2, "version"> & {
    version: 3;
    contractLabels: ContractLabelBackup[];
  };
  export type BackupPayload = BackupPayloadV3;
  ```
- Extend `BuildPayloadInput` and `buildBackupPayload` to include `contractLabels`.
- In `parseBackupPayload`, after the existing `importedAssetIds` line:
  ```ts
  const contractLabels =
    r.version < 3 ? [] : parseContractLabels(r.contractLabels);
  ```
- Add `parseContractLabels(raw): ContractLabelBackup[]` — mirrors `parseImportedAssetIds`: `Array.isArray` check, each entry must have `script: string` (non-empty) and `label: string` (non-empty after trim); dedupes by `script`; no hard cap needed (wallets carry tiny N).

**Export — `exportBackup` in `app/store/useAppStore.ts`:**

Around line 1973 (alongside the existing `swapMetadata` / `boltzSwaps` snapshots):

```ts
const wallet = await ensureWallet({
  metadata,
  behavior: get().walletBehavior,
});
// Fail loud: a label-fetch error must not produce a backup file, because
// `markBackupCompleted` clears `dirtyForBackup` unconditionally on export
// success. Silently writing `contractLabels: []` would let the user trust
// a file that will lose labels at restore — directly contradicting the
// milestone invariant on line 14 ("labels survive restore"). The throw
// propagates to the caller (`ProfileBackup`), which already shows a toast
// for export errors; the dirty flag stays `true` so the stale warning
// remains visible and the user can retry once the SDK recovers.
const contractLabels = await loadContractLabelsForBackup(wallet);
```

Pass `contractLabels` into `buildBackupPayload`.

> **Asymmetry note.** The pre-existing `swapMetadata` / `boltzSwaps` snapshots use `.catch(() => [])` (lines 1973-1974). That pattern has the same theoretical hole — a fetch failure produces a backup that omits swap context, then `markBackupCompleted` marks the wallet clean. It is intentionally out of scope for this milestone: changing it ripples into surfaces this PR is not touching, and the existing behavior was a deliberate "let the secret back up even if companion data is unavailable" choice. We diverge for `contractLabels` because (a) labels are a stated invariant of *this* milestone, and (b) labels are a separate user-data surface, not crash-state of an in-flight swap. Track the swap-side asymmetry in a follow-up issue rather than here.

**Import — `importBackup` in `app/store/useAppStore.ts`:**

Label restoration is **post-commit, best-effort** — the inverse posture from the export path above. Export must fail loud (no silent dirty-flag clearing on a misleadingly-empty backup); import must fail soft (a per-label restore error must not unwind a successful funds/history import). Runs alongside `scheduleLightningRestore(walletId)` (around line 2158), *after* the atomic `set()` writes the wallet metadata. Rationale:

- Contract registration (default + delegate per restored `walletBehavior`) happens inside `createWalletInstance` → `cm` is warm by the time we get back to `importBackup`.
- Label restoration is non-critical: a failure leaves the user with restored funds + history and an unlabeled contract. Surface via `recordError("backup", ...)`; do not roll back the import.
- Doing it pre-commit would entangle a soft-fail with the all-or-nothing rollback the import path already implements (`secretSaved` / `swapMetadataRestored` / `walletRuntimeCreated` flags).

```ts
// Post-commit: re-apply contract labels. Best-effort; failures are logged
// but do not undo an otherwise-successful import.
if (payload.contractLabels.length > 0) {
  void (async () => {
    try {
      const wallet = await ensureWallet({
        metadata,
        behavior: payload.walletBehavior,
      });
      for (const entry of payload.contractLabels) {
        try {
          await updateContractLabel(wallet, entry.script, entry.label);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          recordError(
            "backup",
            `contract_label_restore_failed: ${entry.script}: ${msg}`,
          );
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      recordError("backup", `contract_labels_ensure_wallet_failed: ${msg}`);
    }
  })();
}
```

`updateContractLabel` is the service function (§1), not the store bridge — we intentionally bypass `updateWalletContractLabel` because:
- The bridge calls `markDirtyForBackup()`, and we just restored from backup; dirty should remain `false` until the user makes the next edit.
- The bridge re-checks `isLocked`, but during import the wallet is being constructed and the lock-state guard isn't meaningful here.

**Backup health — labels participate in `hasBackupMaterial`.**

Without this wiring, a wallet whose only off-chain user data is labels falls through to the existing `"no-material"` branch in `statusForHealth` (`ProfileBackup.tsx:54-56`). The Profile → Backup screen then renders "Nothing to back up yet" (`ProfileBackup.tsx:690`), directly contradicting the encrypted file that just shipped the labels off-device. The dirty flag isn't sufficient on its own — once the user exports, `markBackupCompleted` clears it, and the next visit to Backup with no swaps/assets and only labels would display the misleading state.

Mechanism — mirror the existing swap-storage write-timestamp pattern (`getLatestSwapMetadataWriteAt`, `getLatestBoltzSwapWriteAt`), but keep the signal in Zustand instead of SQLite since labels live in the SDK and we already touch the store at every label write:

1. **New persisted field** in `AppState["security"]`: `latestContractLabelWriteAt?: number | null`. Optional/nullable so existing alpha installs load without a schemaVersion bump (treats `undefined` as `null`, same shape as `dirtyForBackup?: boolean`).
2. **`updateWalletContractLabel`** sets it (see §1b).
3. **`importBackup`** sets it from the restored payload: `latestContractLabelWriteAt = payload.contractLabels.length > 0 ? envelope.createdAt : null`. Goes into the atomic commit `set()` alongside `lastBackupAt` and `dirtyForBackup: false`.
4. **`getBackupHealth`** folds it into the existing `hasBackupMaterial` calculation:

```ts
const latestLabelTs = get().security.latestContractLabelWriteAt ?? null;
const hasLabelMaterial = latestLabelTs != null;
const hasBackupMaterial =
  hasSwapMaterial || importedAssetIds.length > 0 || hasLabelMaterial;
// Fold into staleness too — if the user edited a label after the last
// backup, `latest` should reflect that even when swap timestamps are absent.
const latest = Math.max(metaTs ?? 0, boltzTs ?? 0, latestLabelTs ?? 0);
```

The asymmetry from a wallet that "cleared all labels" — `latestContractLabelWriteAt` persists, so `hasBackupMaterial` stays `true` and the screen no longer says "Nothing to back up yet" — is intentional and matches the existing comment at `useAppStore.ts:2196-2200` on the same behavior for swaps. The rationale travels: "the backup file still references state that the wallet no longer matches, so the warning has to fire regardless of `hasBackupMaterial`."

**Why not an SDK round-trip in `getBackupHealth`.** `getBackupHealth` is called from `ProfileBackup` mount + on state-flip (4 effect-dependency triggers) and `ProfileReset` mount. None are hot loops, but adding `ensureWallet` would warm the wallet runtime on Backup screen open, which currently doesn't. The timestamp-in-Zustand approach is free at read time, accurate at write time, and stays consistent with how the codebase already tracks "did the user write something worth backing up" for every other surface.

### 9. Verification

- `pnpm check` — no lint or type errors.
- `pnpm test` — no regressions, **and** the new suites below land green.

#### Automated tests

This milestone adds a service module, three store bridge actions, and a payload-version bump. Each surface gets a focused suite — same shape as `app/services/arkade/__tests__/addresses.test.ts` (the closest precedent), `app/services/backup/__tests__/serializer.test.ts` (round-trip + version fallback), and `app/store/__tests__/useAppStore.test.ts` (store-action guards).

**`app/services/arkade/__tests__/contracts.test.ts`** — mirrors `addresses.test.ts`. Uses a `fakeWallet(getContracts, updateContract?)` helper exposing `getContractManager()` with stubbed `getContracts(filter?)` and `updateContract(script, updates)`. Cases:

- `loadContractSummaries`:
  - **summary projection**: returns rows that match `ContractSummary` exactly — `type`, `state`, `address`, `script`, `createdAt`, optional `label`, optional `metadata`. Assert `expect("params" in row).toBe(false)` for each, even when the source `Contract` has `params: { pubKey: "leak" }` — mirrors the assertion in `addresses.test.ts:52`.
  - **VHTLC rejection**: a mixed list of `default` + `delegate` + `vhtlc` yields a result where `rows.every(r => r.type !== "vhtlc")` is true; the VHTLC count is dropped, not surfaced separately.
  - **sort**: default-first, then `createdAt` desc — parametric `it.each` with three orderings (matches the `pins the default contract to the top` test in `addresses.test.ts:61`).
  - **empty**: empty wallet returns `[]`.
  - **error wrapping**: a thrown SDK error becomes an `ArkadeError` with `kind === "contracts_fetch_failed"`.
- `loadContractParams`:
  - **params loading**: when `cm.getContracts({ script })` returns a single contract, the function returns *only* its `params` map, by reference-equality on the inner object's fields. Assert the returned value has no `type` / `address` / etc. keys.
  - **passes the script filter through**: spy on `getContracts` and assert it was called with `{ script: "abc" }` — pins the per-contract fetch contract.
  - **not-found**: when `getContracts({ script })` returns `[]`, throws `ArkadeError` with `kind === "contracts_params_not_found"`.
  - **error wrapping**: SDK throw → `kind === "contracts_fetch_failed"`.
- `updateContractLabel`:
  - **label clearing — empty string**: `updateContractLabel(wallet, "s", "")` calls `cm.updateContract("s", { label: undefined })`. Spy on the stub, assert exact args.
  - **label clearing — whitespace only**: `updateContractLabel(wallet, "s", "   ")` also passes `{ label: undefined }`.
  - **label set**: `updateContractLabel(wallet, "s", "  Primary  ")` passes `{ label: "Primary" }` (trimmed).
  - **error wrapping**: SDK throw → `kind === "contracts_update_failed"`.
- `loadContractLabelsForBackup`:
  - includes only non-VHTLC contracts with non-empty labels.
  - drops contracts with `label === undefined`, `label === ""`, or `label` whitespace-only.
  - returns `[]` when nothing qualifies.
  - **propagates SDK errors as-is** — does not catch and substitute `[]`. Spy on a `getContracts` that throws; assert the function rejects with an `ArkadeError` (`contracts_fetch_failed`). This pins the fail-loud contract that the `exportBackup` test relies on.

**`app/services/backup/__tests__/serializer.test.ts`** — extends the existing file with a new `describe("backup serializer contract labels round-trip", ...)`:

- **round-trip**: `parseBackupPayload(JSON.parse(JSON.stringify(buildBackupPayload({ ..., contractLabels: [{ script: "s1", label: "L" }] }))))` preserves the field byte-for-byte.
- **version stamp**: `buildBackupPayload({ ... })` writes `version: 3`.
- **v1 fallback**: a hand-crafted v1 raw object (no `contractLabels`, no `importedAssetIds`) parses to `{ contractLabels: [], importedAssetIds: [] }` — pins the existing v1 fallback continues working alongside the new v3 fallback.
- **v2 fallback**: a v2 raw object (with `importedAssetIds`, no `contractLabels`) parses to `contractLabels: []`.
- **parser rejects malformed**: `contractLabels: [{ script: "", label: "x" }]` (empty script) and `contractLabels: [{ script: "s", label: "" }]` (empty label) and `contractLabels: "not-an-array"` each throw `PayloadParseError` with `kind === "malformed_payload"`.
- **dedupes by script**: two entries with the same `script` collapse to one (last write wins).

**`app/store/__tests__/useAppStore.test.ts`** — adds a new `describe("useAppStore contract actions", ...)` block. Follows the same pattern the file already uses for `setArkadeNetwork` and `acknowledgeSchemaMismatchAndWipe` (direct calls into the singleton store after a controlled `set` of the relevant slice). Cases:

- **`loadWalletContractSummaries` — no wallet**: with `wallet === null`, rejects with `ArkadeError("wallet_not_ready", ...)`.
- **`loadWalletContractSummaries` — locked**: with a wallet present and `security.isLocked === true`, rejects with `ArkadeError("wallet_not_ready", ...)`.
- **`loadWalletContractParams` — same two guards**, parametrized via `it.each` over the action triple.
- **`updateWalletContractLabel` — same two guards.**
- **`updateWalletContractLabel` — atomic-commit shape on success**: stub `ensureWallet` to return a wallet whose `updateContract` resolves; pin `Date.now()` to a fixed value via `jest.spyOn(Date, "now")`; subscribe to the store before calling the action and record every state transition. Assert: (a) `get().security.dirtyForBackup === true` and `get().security.latestContractLabelWriteAt === <pinned>` after the action resolves, (b) **exactly one** transition flipped both fields together (no intermediate state where `dirtyForBackup === true && latestContractLabelWriteAt == null`), and (c) `AsyncStorage.setItem` was called at least once with a serialized payload containing both new values — pins the "single `set()` + single awaited `persist(get())`" contract. Pre-assert both fields were their nullish defaults to make the transition meaningful.
- **`updateWalletContractLabel` — does not mark dirty *or* set the timestamp on failure**: stub `updateContract` to reject; assert the action rejects AND both `dirtyForBackup` and `latestContractLabelWriteAt` remain their pre-call values AND no new `AsyncStorage.setItem` call landed (subscribe to the mock between pre-assert and the action). Pins the "only persist after the SDK edit succeeds" contract that `setWalletBehavior` / `importAsset` already follow.
- **`updateWalletContractLabel` — clear also sets the timestamp**: pass an empty-string label; assert `updateContract` is called with `{ label: undefined }` (service-level contract) AND `latestContractLabelWriteAt` advances. Pins the "any label write is a backup-worthy write" signal — clears participate too.
- **`getBackupHealth` — labels alone signal material**: pre-set `security.latestContractLabelWriteAt = 1_700_000_000_000`, no swaps, no imported assets; call `getBackupHealth()`; assert `hasBackupMaterial === true`. Without this wiring, `ProfileBackup` would render "Nothing to back up yet" for a labels-only wallet (`ProfileBackup.tsx:690`). Pre-assert the swap-storage stubs return null timestamps so the result isn't coincidental.
- **`getBackupHealth` — cleared labels still signal material**: same as above (the timestamp persists even after the user clears every label) — pins the intentional asymmetry called out in §8.
- **`getBackupHealth` — label timestamp folds into `latest`**: with `lastBackupAt = 100`, no swap timestamps, `latestContractLabelWriteAt = 200`, `dirtyForBackup = false`; assert `isStale === true` (the file references state older than the latest label write). Without folding into `latest`, the screen would say "Up to date" while the file is genuinely outdated.
- **`exportBackup` — fail-loud on label fetch error**: stub `ensureWallet` to return a wallet whose `getContracts` throws. Call `exportBackup("pw")` and assert (a) it rejects with an `ArkadeError`, (b) no file is written (the temp-file helper is not invoked — assertable via a spy), and (c) `dirtyForBackup` remains its pre-call value (the milestone's invariant from line 14). Pre-assert `dirtyForBackup` is `true` so the post-condition is a meaningful no-op rather than a coincidental match.
- **`exportBackup` — happy path includes contract labels**: stub `getContracts` to return one labeled contract; assert the resulting `BackupPayload` (decode by reading the temp file or by inspecting the `buildBackupPayload` argument via a spy) contains `version: 3` and `contractLabels: [{ script, label }]` matching the SDK state.

Mocking strategy: `ensureWallet` is the indirection point. The new test cases mock `../arkade/wallet-runtime` (or wherever `ensureWallet` lives — confirm during implementation) at module scope, similarly to how `tx-cache.test.ts` mocks `../storage` (TESTING.md §"Mocking a sibling module"). The mock returns a fake `Wallet` whose `getContractManager()` returns a stub manager with the same shape used in `contracts.test.ts`. No real SDK runtime is started — these are deterministic unit tests, not integration tests.

`TESTING.md` line 22 currently says store-action tests don't exist; that's stale (this file already has them for `setArkadeNetwork` etc.). No edit to `TESTING.md` is required for this milestone, but flag it in the PR description so the doc gets corrected the next time someone touches it.

#### Manual

- Profile → Contracts list: both default and delegate contracts visible; filter chips narrow the list; pull-to-refresh works; empty state shown when filters exclude all contracts.
- Tap a contract → detail screen: address, script, createdAt all correct; Copy toasts appear; "View in Explorer" link opens.
- Params reveal: locked by default; tapping Reveal shows AuthGate; after auth, each param is visible with its human-readable label and a Copy button; tapping Hide clears the bytes; navigating back and returning re-locks AND re-fetches on next reveal (verify by adding a temporary `console.log` in `loadContractParams` and watching it fire on each reveal, not just the first).
- Confirm via code review: the only call site of `loadWalletContractParams` (store action) is inside the `AuthGate.onSuccess` callback of `ContractDetailScreen`. `ContractsScreen` does not import it. The SDK `Contract` type and the SDK `Wallet` type are not imported by any screen — screens only ever see store actions, `ContractSummary`, and `Record<string, string>`.
- Label edit: tapping the label row enters edit mode; saving updates the label and refreshes the view; clearing the label (empty save) removes it.
- **Label durability:** after editing or clearing a label, Profile → Backup shows the "stale" warning (`dirtyForBackup === true`). Export a backup; verify the exported payload (decrypt in dev) contains `contractLabels: [...]` matching the SDK state, and that `version: 3`. Reset the wallet, restore from that backup, and confirm the labels appear in Profile → Contracts without further editing.
- **Fail-loud on label snapshot failure:** temporarily edit `loadContractLabelsForBackup` to `throw new Error("simulated")` (or interpose a dev-only env-gated throw). Trigger an export: it must fail with a visible error toast, no `.trixiebackup` file is produced, and the Profile → Backup screen continues to show the stale warning. Revert the throw and retry — the export now succeeds, labels are captured, the dirty flag clears. This pins the contract that a failed companion-data snapshot does not produce a misleadingly-clean backup state.
- **Older-payload compat:** restore a v2 backup (taken before this milestone): import succeeds, contract list renders with no labels, no crash, no error toast.
- **Labels-only backup state (Scenario F regression check):** in a wallet with no swap history and no imported assets, add a label to the default contract; export a backup; return to Profile → Backup. The screen must show "Up to date" (status `"fresh"`), not "Nothing to back up yet" (status `"no-material"`). Reload the app to confirm the `latestContractLabelWriteAt` field survives `persist()` and the status remains "Up to date" after rehydrate.
- VtxoListScreen "Show all my addresses" button now navigates to Contracts.
- `Addresses` route is gone from the stack — no crash if a stale deep-link hits it (React Navigation will simply not match).
- Light mode and dark mode.

## Out of Scope

- VHTLC contract display (deferred until Boltz swap creates them via ContractManager).
- Removing or migrating `loadWalletAddresses` from the store.
- Contract creation or manual contract registration.
- Batch label editing.
- Sorting or ordering preferences.
- Pagination or virtual lists.
