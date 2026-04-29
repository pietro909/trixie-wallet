# Milestone 7: Logs Export

Goal: let a user export a support bundle that explains what the app was doing
without exposing wallet secrets.

This milestone should prove:

- A user can export a log bundle from the app.
- The bundle includes enough context to debug failed sends, restores, and
  background work.
- The bundle redacts secrets, preimages, mnemonics, and private keys.
- Export works independently from backup and reset.

## Current State

- The Advanced tab already covers server and diagnostic visibility.
- There is no dedicated logs export flow in the current app.
- `app/store/useAppStore.ts` already holds the app-level state that can be
  summarized in a support bundle.

## Product Rules

- Logs are a support artifact, not a recovery artifact.
- Redact secrets by default. A support bundle should be safe to share.
- Include timestamps, wallet id, network, app version, server state, and recent
  error summaries.
- Keep the output deterministic enough that support can compare bundles.

## Selected Direction

Add a dedicated export path that assembles a text or JSON bundle from:

- recent app and runtime errors;
- wallet/network metadata;
- non-secret recovery status;
- recent Activity ids and statuses.

If the app already has a generic share/export sheet, reuse it here instead of
inventing a second export UX.

