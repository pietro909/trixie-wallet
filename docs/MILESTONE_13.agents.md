# Milestone 13: Cloud Backup

Goal: add optional encrypted cloud backup on top of the local backup format.

This milestone should prove:

- A user can sync an encrypted backup blob to a cloud service.
- A user can restore that blob on a new device.
- The cloud provider never sees plaintext wallet secrets.
- Local backup remains the canonical recovery format.

## Current State

- Milestone 6 defines the local backup format and restore path.
- There is no cloud sync transport yet.
- The app already has the wallet metadata and recovery primitives needed to
  produce a portable encrypted bundle.

## Product Rules

- Cloud sync is transport only. It must not become the secret store.
- Never send mnemonics, private keys, or preimages unencrypted.
- Validate bundle version and wallet ownership before import.
- Keep provider-specific auth separate from the wallet model.

## Selected Direction

Add a cloud transport layer that uploads and downloads the encrypted backup
bundle produced by Milestone 6. Support can be provider-specific, but the
wallet-facing format should stay stable.

