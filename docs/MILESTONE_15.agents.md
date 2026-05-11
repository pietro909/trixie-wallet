# Milestone 15: Multiple Wallets and Labels

Goal: move from a single-wallet app model to a real wallet list with labels and
account naming.

This milestone should prove:

- A user can create and switch between multiple wallets.
- Each wallet has its own secrets, backup state, and Activity history.
- The active wallet can be renamed with a user-visible label.
- Reset and restore only affect the selected wallet.

## Current State

- `app/store/types.ts` still models one `wallet` at a time.
- `app/store/useAppStore.ts` persists a single wallet record and its metadata.
- The current backup and recovery work is scoped to that single record.

## Product Rules

- Wallet data must be isolated by wallet id.
- Labels are user-owned metadata, not part of the secret material.
- Switching wallets must not leak Activity, backup state, or pending work
  across accounts.
- The unlock flow should remain predictable even when more than one wallet is
  stored.

## Selected Direction

Introduce a wallet collection in the store, then layer on:

- wallet picker / switcher UI;
- per-wallet secret storage namespaces;
- per-wallet Activity and backup state;
- rename / label actions for account naming.

