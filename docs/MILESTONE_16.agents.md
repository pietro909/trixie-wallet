# Milestone 16: Mainnet Support

Goal: let users choose between mutinynet and Bitcoin mainnet when creating or
restoring a wallet.

This milestone should prove:

- A user creating a new wallet sees a network selector (mutinynet / mainnet)
  and the choice is persisted with the wallet.
- A user restoring from a seed phrase sees the same selector.
- A user restoring from a backup file has the network pre-selected from the
  backup and the selector is disabled.
- The correct server URLs are used for each network at runtime.

## Current State

- The app is hardcoded to mutinynet.
- The sister app `../wallet` already holds the mainnet and mutinynet server
  URLs; they should be imported or mirrored here.
- The backup format (v2, from Milestone 10) does not carry a `network` field.
- The Restore Wallet screen has no network selector.

## Product Rules

- Never connect a mainnet seed to a mutinynet node, or vice versa.
- The chosen network must survive app restarts and full backup/restore cycles.
- When a backup encodes a network, that value is authoritative — the selector
  must be pre-filled and read-only.
- Mainnet and mutinynet wallets must be visually distinguished in the UI so a
  user cannot mistake which network they are on.

## Selected Direction

Add a `network` field (`'mutinynet' | 'mainnet'`) to the wallet store and to
the backup payload (bump `schemaVersion`). Surface a network selector in the
Create and Restore-from-seed flows. When restoring from a backup file, read
the `network` field and lock the selector. Pull server URLs from the sister
app's constants rather than duplicating them.
