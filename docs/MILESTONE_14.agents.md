# Milestone 14: LNURL

Goal: Add support for LNURL-pay and Lightning Addresses, enabling users to pay via human-readable identifiers and dynamic invoice fetching.

This milestone should prove:
- Lightning Address inputs (e.g., `user@domain.com`) are recognized and correctly resolved.
- LNURL bech32 strings are decoded and the initial parameters (min/max, metadata) are fetched.
- The app handles the LNURL-pay callback flow to fetch a BOLT11 invoice for a specific amount.
- The Send flow dynamically adapts to LNURL constraints (min/max sendable amounts).
- Clear error handling for malformed identifiers or failed network fetches.

## Current State

### Input Parsing
- `app/services/paymentParser.ts` recognizes `lnurl1...` bech32 strings but does not support Lightning Addresses.
- `detectBareType` identifies `lnurl` but does not perform any validation beyond the regex.
- BIP-21 `bitcoin:` URIs with `lnurl=` parameters are recognized but not actionable.

### Resolution & Service Logic
- No `lnurl.ts` service exists.
- The `SendAmountScreen` currently treats `lnurl` as a static destination and doesn't know how to fetch parameters or invoices.
- `sendExecutor.ts` explicitly marks `lnurl` as "not available yet" in `unsupportedReasonFor`.

### Reference Implementation
- Sibling app `../wallet` (Arkade Wallet) uses a `lnurl.ts` helper that handles bech32 decoding and HTTP resolution.

## Implementation Plan

### Phase 1: Parsing & Identifier Resolution
- [ ] **Lightning Address Support**: Add regex and logic to `paymentParser.ts` to recognize `user@domain.com`.
- [ ] **Identifier Normalization**: Create a helper to convert Lightning Addresses to their underlying `.well-known/lnurlp/` URLs.
- [ ] **Bech32 Decoding**: Integrate a bech32 decoder (or use existing SDK helpers) to resolve `lnurl1...` to actionable URLs.

### Phase 2: LNURL Service (`app/services/arkade/lnurl.ts`)
- [ ] **Fetch Params**: Implement `fetchLnurlParams(url: string)` to get `LnurlPayParams` (min/max, metadata, callback).
- [ ] **Fetch Invoice**: Implement `fetchLnurlInvoice(callback: string, amountSats: number, comment?: string)` to get the BOLT11 invoice.
- [ ] **Validation**: Ensure fetched invoices match the requested amount and have valid metadata.

### Phase 3: Send Flow UI Integration
- [ ] **SendAmount Hook**: Add logic to `SendAmountScreen` to fetch LNURL params when an LNURL option is selected.
  - Show a loading spinner during resolution.
  - Display the provider domain or metadata description.
  - Apply `minSendable` and `maxSendable` as validation bounds for the amount input.
- [ ] **Review Transition**: When "Review" is clicked for an LNURL destination:
  - Fetch the BOLT11 invoice from the callback.
  - Navigate to `SendReview` with the newly fetched invoice (effectively treating it as a `lightning` type from that point forward).
- [ ] **Metadata Display**: Ensure `SendReview` and `SendResult` display the human-readable identifier (Lightning Address or domain) instead of the raw bech32 string.

### Phase 4: Error Handling & Polish
- [ ] **Network Safety**: Handle fetch timeouts and malformed JSON responses with user-friendly errors.
- [ ] **Comment Support**: If the LNURL params specify a `commentAllowed` length, show an optional comment field.
- [ ] **Success Logic**: Ensure the Activity feed correctly associates the LNURL identifier with the resulting swap.
