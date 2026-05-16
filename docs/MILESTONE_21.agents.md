# Milestone 21: Non-default Wallet Behavior

**Status:** Planned (promoted from Issue 11)

## Goal
Verify and formalize the behavior of the wallet when core automation features are disabled. Specifically, ensure the SDK Settlement Manager respects the "VTXO auto-renewal" and "VTXO delegate" toggles without introducing safety risks or state inconsistencies.

## Context
In `app/services/arkade/runtime.ts`, the `settlementConfig` is currently passed to the SDK `Wallet.create` based on these toggles:

```typescript
const settlementConfig =
  behavior.vtxoAutoRenewal || behavior.delegatedRenewal
    ? {
        vtxoThreshold: 60 * 60 * 24 * 3,
        boardingUtxoSweep: true,
        pollIntervalMs: 60_000,
      }
    : false;
```

When both are `false`, `settlementConfig` is `false`, which should disable the SDK's internal automated background settlements.

## Strategy
1. **Static Implementation Audit:** Verify that `behavior.vtxoAutoRenewal` and `behavior.delegatedRenewal` correctly propagate to all relevant SDK providers (Indexer, Delegator, etc.).
2. **Behavioral Verification:** Confirm that with automation off, the app correctly transitions to a "Manual" mode where users must initiate settlements or sweeps.
3. **Safety Check:** Ensure that disabling these does not prevent the user from receiving funds or exfiltrating assets (unilateral exit).

### Implementation Checklist
- [ ] Audit `runtime.ts` and `storage.ts` for any leaked settlement side-effects when config is `false`.
- [ ] Prepare a testing matrix for the 4 states:
    - [ ] Auto-renew: ON, Delegate: ON (Default)
    - [ ] Auto-renew: ON, Delegate: OFF
    - [ ] Auto-renew: OFF, Delegate: ON
    - [ ] Auto-renew: OFF, Delegate: OFF
- [ ] Implement unit tests in `app/services/arkade/__tests__/runtime.test.ts` (or equivalent) to exercise the configuration builder.
- [ ] Perform manual end-to-end tests on a device/emulator.

## Expected Outcomes
- Clear UX indicators for manual settlement if automation is disabled.
- No unexpected background activity (data usage/CPU) from the Settlement Manager when configured `false`.
- Safe path to re-enable automation without state corruption.
