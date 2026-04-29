# Milestone 9: Disaster Recovery Tooling

Goal: add operational recovery tools for dangling VHTLCs, claimable or
refundable swaps, and stranded wallet outputs.

This milestone should prove:

- A user can inspect pending recoverable state before taking recovery actions.
- The wallet can sweep or reconcile dangling outputs that can still be claimed
  or refunded.
- Recovery actions are explicit and confirmed.
- The app can surface enough state to support manual rescue after a bad reset.

## Current State

- Swap metadata is already tracked in `app/services/arkade/swap-storage.ts`.
- Activity rows already carry swap and wallet-event lineage.
- There is no dedicated recovery surface in the current app.

## Product Rules

- Recovery tooling is operational, not cosmetic.
- Never auto-trigger destructive recovery actions without confirmation.
- Show txids, swap ids, timestamps, and status so the user can understand what
  is actually recoverable.
- Prefer a narrow set of explicit actions over a broad hidden “fix everything”
  button.

## Selected Direction

Add a recovery screen or Advanced-section panel that can:

- scan for claimable/refundable Lightning state;
- sweep dangling VHTLC-related outputs when they are still valid;
- surface unresolved pending state after a reset;
- hand off to the logs export flow when the issue needs support attention.

