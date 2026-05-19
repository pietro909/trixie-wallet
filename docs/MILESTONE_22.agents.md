# Milestone 22: VTXO List Grouped by Contract

**Status:** PAUSED

**Paused reason:** the original framing ("group the VTXO list by owning contract")
was a UI restructuring around a problem that turned out to be narrower than the
milestone proposed. The concrete bug the user is hitting today — the screen
calling itself "VTXOs at this address" while aggregating VTXOs across every
contract the wallet owns (today: `default` + `delegate` when delegated renewal
is on; VHTLCs used by `@arkade-os/boltz-swap` are not registered through
`ContractManager` yet, pending a future SDK-space refactor), and the explorer
link pointing only at the default address — is now tracked separately as an
issue in [ISSUES.md](../ISSUES.md) and can be fixed without restructuring the
list.

The grouped-sections design also outgrew this milestone's scope while under
review (filter-parity with the current spendable-only view, ContractVtxo vs.
ExtendedVirtualCoin typing, cache invalidation on contract events, inactive
contract noise over time, per-section explorer/copy affordances). Promoting it
into a "Contracts Management" feature — where contracts are first-class objects
the user can list, label, inspect, and close — is the more honest next step.
Until that feature is scoped, this milestone is paused. The plan below is
retained as design context only.

Do not implement this milestone while it is paused.

## Goal
Group the VTXO list by owning contract so the user can see, at a glance, which contract a virtual output belongs to. More than one contract can exist at any given time (`default`, `vhtlc`, future custom types), and each can hold VTXOs independently. The flat list hides that structure today.

This milestone should prove:
- The VTXO list is grouped by contract, with one section per contract.
- Each section header shows the contract `type`, `state`, and a label/address shorthand.
- Each section can be collapsed and expanded; collapsed state is per-section and survives a pull-to-refresh.
- Empty contracts are still shown as empty sections (so the user can see a registered VHTLC contract that has not yet received its claim VTXO).
- The user can copy the contract `script` and `address` from the header with one tap, with toast confirmation.
- The existing per-VTXO row UI (amount, status pill, outpoint, age) is unchanged — only the surrounding container is restructured.

## Current State

- **UI:** `app/screens/vtxos/VtxoListScreen.tsx` renders a flat `FlatList<ClassifiedVtxo>` keyed by outpoint. It uses a custom `header` component for the title and status legend.
- **Data Fetching:** `app/services/arkade/vtxo-listing.ts:loadVtxos` calls `wallet.getVtxos({ withRecoverable, withUnrolled })`, which returns a flat array of VTXOs. In the current SDK this is still backed by the contract layer: `wallet.getVtxos()` internally calls `wallet.getContractManager().getContractsWithVtxos()`, then `flatMap`s every contract's VTXOs and applies spendable/recoverable/unrolled filtering. The VTXO list is **not** using an explorer as its data source; the grouping is lost because the app consumes the SDK's flattened convenience method.
- **Store:** `app/store/useAppStore.ts` implements `loadWalletVtxos` which manages an in-memory `vtxoSnapshotCache`. The cache is a flat list: `{ walletId: string; items: ClassifiedVtxo[]; fetchedAt: number; }`.
- **Detail Dependency:** `app/screens/vtxos/VtxoDetailScreen.tsx` also calls `loadWalletVtxos({ maxAgeMs: 30_000 })` and expects a flat array for `list.find((v) => v.outpoint === outpoint)`.
- **SDK Precedent:** `app/services/arkade/activity-history.ts` already uses `wallet.getContractManager().getContractsWithVtxos()` to pull VTXOs through the contract layer, but it currently `flatMap`s them immediately to process a flat list of activities.
- **Visuals:** `app/services/vtxo-status.ts` provides `vtxoStatusVisuals` for VTXO-level pills. There is no equivalent helper for Contract-level visuals yet.

## Product Rules

- **Grouped by Contract:** Every VTXO must belong to exactly one section. VTXOs that don't belong to a specific user-defined contract belong to the `default` contract.
- **ContractManager Source:** The grouped list must call `wallet.getContractManager().getContractsWithVtxos()` directly and preserve the returned contract sections. Do not reconstruct sections from `wallet.getVtxos()`, because that API has already flattened the contract structure.
- **Section Visibility:** All known contracts should be visible, even if they have zero VTXOs. This is critical for tracking VHTLC contracts during lightning swaps.
- **Read-Only:** The VTXO list remains a read-only view. No contract management (labeling, closing) is added in this milestone.
- **Persistent Section State:** Collapse/expand state is kept in memory at the component level. It should survive pull-to-refresh but is not persisted across app restarts or navigation away from the screen.
- **Information Disclosure:** Section headers must only show public fields: `type`, `state`, `script`, `address`, `label`, `createdAt`. Never show preimages or witness data.

## Technical Analysis

### 1. Data Layer: Grouped Listing Service
- **File:** `app/services/arkade/vtxo-listing.ts`
- **New Types:**
  ```typescript
  export type ContractSection = {
    contract: Contract; // From @arkade-os/sdk
    vtxos: ClassifiedVtxo[];
  };
  ```
- **New Function:** `loadVtxosByContract(wallet, opts, dustSats): Promise<ContractSection[]>`
  - Call `const cm = await wallet.getContractManager()`.
  - Call `cm.getContractsWithVtxos()` directly. This is the key change from the current list path: preserve the SDK's `{ contract, vtxos }` shape instead of using `wallet.getVtxos()`, which already `flatMap`s it.
  - Use `classifyVtxo` on each coin and attach display fields (`amountSats`, `outpoint`) using the same rules as the existing flat loader.
  - Sort sections: `default` first, then by `createdAt` desc.
  - Sort VTXOs within each section by amount desc.
  - Preserve empty sections. Current SDK behavior already returns every contract with a `vtxos` array, including `[]`; add a unit test for this rather than fetching `getContracts()` separately unless the SDK behavior changes.
  - Keep `loadVtxos()` available as the flat convenience path for `VtxoDetailScreen` and any other callers that need `ClassifiedVtxo[]`.

### 2. Store: Cache Update
- **File:** `app/store/useAppStore.ts`
- Add a grouped cache and store action, e.g. `loadWalletVtxoSections(opts?: { maxAgeMs?: number }): Promise<ContractSection[]>`.
- Keep `loadWalletVtxos(opts?: { maxAgeMs?: number }): Promise<ClassifiedVtxo[]>` flat so `VtxoDetailScreen` does not regress. It can either retain the existing `wallet.getVtxos()` implementation or flatten the grouped snapshot when fresh.
- Cache invalidation logic remains the same (invalidated on lock/reset).

### 3. UI: SectionList Rework
- **File:** `app/screens/vtxos/VtxoListScreen.tsx`
- Switch from `FlatList` to `SectionList`.
- **Section Header Component:**
  - Left: Contract Type Pill (e.g. "DEFAULT", "VHTLC").
  - Center: Label (if exists) or truncated Address.
  - Right: State Pill (e.g. "ACTIVE", "INACTIVE"), Chevron.
  - Long-press or Tap Actions: Show "Copy Script" and "Copy Address" options.
- **Collapse Logic:** Use `useState<Record<string, boolean>>` (keyed by contract script) to toggle section visibility.

### 4. Visuals: Contract Status
- **File:** `app/services/vtxo-status.ts`
- Add `contractStatusVisuals(contract: Contract, theme: AppTheme)` to provide consistent colors for contract types and states.

## Implementation Phasing

### Phase 1: Data Shape & Unit Tests
- Implement `loadVtxosByContract` in `vtxo-listing.ts`.
- Add unit tests in `app/services/arkade/__tests__/vtxo-listing.test.ts` (if it exists, else create it) to verify grouping and sorting.
- Ensure empty contracts are preserved in the output.
- Ensure `loadVtxos()` still returns the existing flat shape for detail-screen lookup.

### Phase 2: Store & Screen Wiring
- Update `useAppStore` to expose grouped loading for the list while keeping the flat `loadWalletVtxos` API for detail lookup.
- Rework `VtxoListScreen.tsx` to use `SectionList`.
- Implement basic section headers without collapse/copy actions yet.
- **Checkpoint:** Verify the list shows grouped sections on a test wallet.

### Phase 3: Interaction & Polish
- Add collapse/expand functionality to section headers.
- Implement "Copy Address" and "Copy Script" with toast feedback.
- Add `contractStatusVisuals` for themed pills in the header.
- **Checkpoint:** Full manual test on Android and iOS (via simulator) for both light and dark modes.

## Out of Scope
- Editing contract labels (Issue 7).
- Manual closing of contracts.
- Filtering contracts (e.g., "hide inactive").
- Per-contract balance totals in the header.
- Linking to a dedicated "Contract Detail" screen.
