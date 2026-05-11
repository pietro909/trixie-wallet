# Milestone 13: LNURL

Goal: add LNURL and Lightning Address support after the immutable activity
model is stable.

This milestone should prove:

- A user can paste or scan LNURL inputs in supported send flows.
- Lightning Address inputs are recognized and resolved.
- The wallet can fetch a Lightning invoice from an LNURL-pay endpoint.
- Unsupported or malformed LNURLs are rejected with a clear error.

## Current State

- Lightning invoice support already exists.
- `../wallet/src/lib/lnurl.ts` shows the sibling app's LNURL helper shape.
- Trixie does not yet have a local LNURL helper or parsing path.

## Product Rules

- Keep BOLT11 and LNURL paths distinct.
- Validate the input early with the active wallet network in mind.
- Do not leak swap internals into the user-facing LNURL flow.
- Prefer a shared helper for parsing and callback resolution over one-off logic
  in screens.

## Selected Direction

Add a small LNURL module that handles:

- bech32 LNURL parsing;
- Lightning Address resolution;
- invoice fetch and validation;
- optional Arkade-specific method handling if the product needs it later.

