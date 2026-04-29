# Milestone 6: Backup and Reset Safety

Goal: make reset survivable. A user should be able to export the recovery
material needed to rebuild the wallet before they wipe the device, and then
import it back on a new install without losing pending state.

This milestone should prove:

- A user can export an encrypted backup bundle from the wallet.
- A user can restore that bundle into a fresh install.
- The backup covers wallet secrets plus recovery-critical state such as swap
  preimages, invoices, and pending claim/refund metadata.
- Reset warns or blocks when unrecoverable pending state still exists.
- Backup import is versioned and rejects malformed or stale bundles cleanly.

## Current State

- `app/screens/ProfileBackup.tsx` only reveals and copies the wallet secret.
- `app/screens/ProfileReset.tsx` exists, but it does not rely on a backup
  bundle model.
- `app/store/useAppStore.ts` persists the wallet and activities in plain app
  state, but there is no export/import flow.
- `app/services/arkade/swap-storage.ts` already stores local swap metadata,
  which is part of the recovery surface.

## Product Rules

- The backup bundle must be encrypted before it leaves the device.
- Never place secrets, preimages, or invoices into logs or plain AsyncStorage.
- The bundle format must be versioned so future schema changes can be handled.
- A reset must not silently destroy pending state that can still be recovered.
- Keep cloud sync out of this milestone. Local backup comes first.

## Selected Direction

Define one canonical local backup format and make every later recovery feature
depend on it.

Suggested shape:

- serializer for wallet identity and metadata;
- serializer for swap-recovery material and any other pending-state payload;
- restore path that rehydrates the store, swap metadata, and wallet label;
- confirmation gate before reset when the backup state is incomplete.

