# Milestone 8: Background Claim, Refund, and Resume

Goal: make pending Lightning and related swap state continue progressing after
the app is suspended, restarted, or unlocked again.

This milestone should prove:

- Reverse swaps can still be claimed after the app comes back to the foreground.
- Submarine swaps can still refund or settle after suspension.
- Pending state survives restart and is resumed idempotently.
- The user does not need to manually babysit every pending Lightning action.

## Current State

- `app/services/arkade/lightning.ts` already wires a foreground swap manager.
- `scheduleLightningRestore()` exists as a best-effort foreground restore hook.
- Background task wiring is not yet part of the app.
- The wallet lock gate can interrupt runtime work, so resume logic matters.

## Product Rules

- Resume logic must be idempotent. Running it twice should not create duplicate
  claims or refunds.
- Background work must not block the visible UI.
- Pending Activity rows must remain visible while the wallet is in flight.
- If the platform cannot guarantee true background execution, resume on unlock
  and foreground as a fallback rather than pretending otherwise.

## Selected Direction

Wire a proper pending-state runner that:

- refreshes local swap metadata on app start and unlock;
- retries claim/refund/restore flows for the active wallet;
- updates Activity after each terminal transition;
- records the last resume result so support can see whether background work is
  healthy.

