# LNURL-pay from a POS fails: `lightning:`-prefixed LNURL rejected as "Not a valid LNURL identifier"

## Summary

Paying a Lightning point-of-sale LNURL-pay (Opago POS, `api.opago.com`) from
Trixie fails on the **Amount** screen with **"Not a valid LNURL identifier"**.
The amount field is stuck at `0` and the payment can never be attempted — which
is exactly why earlier the failure looked silent ("no error in the logs, it
just didn't pay"): Trixie never resolves the endpoint, never fetches params,
never mints an invoice.

**Confirmed root cause:** the QR at the POS encodes the LNURL as a
`lightning:LNURL1…` URI (the standard LN URI scheme). Trixie's parser correctly
classifies it as LNURL for *display* (it shows `SENDING VIA LNURL`), but stores
the **scheme-prefixed** string as `option.raw`. The LNURL resolver only accepts
a bare `lnurl1…` or a `user@host` lightning address — it does not strip the
`lightning:` (or `lnurl:`) scheme — so resolution rejects it.

This is a *different* bug from the amount-drift problem the sibling wallets hit
(see "Latent downstream issue" below). Trixie fails strictly earlier, at
identifier resolution, before any amount logic runs.

## Evidence

Screenshots in this folder (`docs/issue-ln-invoice-btc-prague-2026/`):

- **`trixie-error.png`** *(the new one)* — Trixie Amount screen:
  `SENDING VIA LNURL · LNURL1DP68GURN…87L6M6`, a red banner
  **"Not a valid LNURL identifier"**, amount `0 sats`, balance 24,124 sats.
  The destination renders as a clean `LNURL1…` (no scheme) because the display
  path strips it — but the resolver receives the scheme-prefixed `raw`.
- **`invoice.jpg`** — the Opago POS terminal (`Kč 200`, `₿ 14,908`).
- **`arkade-wallet-error.png`** — Arkade Wallet shows the recipient as
  **`lightning:LNURL1DP68GURN8GHJ7CTSDYHX7URPVAHJU…`** — direct confirmation the
  scanned payload carries the `lightning:` prefix.
- **`bluewallet-error.png`** — BlueWallet's later amount-mismatch error (the
  downstream issue, not this one).

## Root cause (Trixie)

The identifier resolver recognises a bare `lnurl1…` or a lightning address, but
not a scheme-prefixed URI:

`app/services/arkade/lnurl.ts` —

```ts
const LNURL_PREFIX_RE = /^lnurl1/i;                 // anchored at start

export function resolveLnurlEndpoint(input: string): LnurlEndpoint | null {
  const v = input.trim();                            // trims whitespace only — not a scheme
  if (isLightningAddress(v)) { … }                   // needs '@', so "lightning:lnurl1…" fails
  if (!isBech32Lnurl(v)) return null;                // LNURL_PREFIX_RE.test("lightning:lnurl1…") === false
  …
}
```

`fetchLnurlParams` turns that `null` into the visible error
(`app/services/arkade/lnurl.ts:146`):

```ts
const endpoint = resolveLnurlEndpoint(input);
if (!endpoint) throw new Error("Not a valid LNURL identifier");
```

The scheme prefix reaches the resolver because the parser stores the **raw,
prefixed** input on the option while only cleaning the value used for display:

`app/services/paymentParser.ts` —

```ts
// parsePaymentInput: lightning: scheme branch
if (scheme === "lightning") {
  const value = rest.replace(/^\/\//, "");           // value = "LNURL1…" (clean)
  const sub = detectBareType(value);
  if (sub === "lnurl") return buildBareLnurl(trimmed, value);   // trimmed = "lightning:LNURL1…"
}

function buildBareLnurl(rawInput, lnurl) {
  return { options: [{
    type: "lnurl",
    raw: rawInput,                  // ← keeps the "lightning:" prefix
    destination: shortenAddress(lnurl),   // ← display uses the clean value
    …
  }]};
}
```

`SendAmountScreen` then resolves with the prefixed `raw`
(`app/screens/send/SendAmountScreen.tsx:216`):

```ts
fetchLnurlParams(option.raw, controller.signal)   // option.raw = "lightning:LNURL1…"
```

So `detectBareType(value)` classifies the *clean* value as `lnurl` (screen says
"SENDING VIA LNURL"), but `resolveLnurlEndpoint(option.raw)` receives the
*prefixed* string and rejects it.

### Reproduced

```
RESOLVES    "LNURL1DP68GURN8GHJ7CTSDYHX"          ← bare paste works today
REJECTED    "lightning:LNURL1DP68GURN8GHJ7CTSDYHX" ← scanned POS QR fails
REJECTED    "LIGHTNING:LNURL1DP68"
REJECTED    "lnurl:LNURL1DP68"
```

A bare-pasted LNURL works (no-scheme path: `raw === trimmed === "LNURL1…"`); a
scanned `lightning:`-prefixed QR does not. POS terminals emit the `lightning:`
URI form, so scanning at a register always hits this.

## Proposed fix (Trixie)

Make LNURL resolution tolerate the standard URI schemes — the surgical,
boundary-hardening fix:

1. **Strip a leading `lightning:` / `lnurl:` scheme (case-insensitive, optional
   `//`) at the top of `resolveLnurlEndpoint`**, before the
   `isLightningAddress` / `isBech32Lnurl` checks. This fixes scanned LNURLs and
   scheme-prefixed lightning addresses (`lightning:user@host`) regardless of
   what `option.raw` carries, and it's the single place LNURL identifiers are
   interpreted.

   ```ts
   export function resolveLnurlEndpoint(input: string): LnurlEndpoint | null {
     const v = input.trim().replace(/^(lightning|lnurl):(\/\/)?/i, "");
     …
   }
   ```

   Keep `identifier: v` as the cleaned value so the rest of the flow (and the
   `LnurlPayParams.identifier` shown on Review) uses the bare form.

2. **(Belt and suspenders) normalise in the parser too.** Pass the cleaned
   `value` (not the prefixed `trimmed`) as `raw` in the `lnurl` case of
   `buildBareLnurl`, so `option.raw` is the bare identifier. Note the analogous
   `lightning:`+bolt11 path also keeps the prefix in `raw` and pays via
   `sendLightning(option.raw, …)` — worth confirming Boltz tolerates a
   `lightning:`-prefixed BOLT11, or strip there as well.

3. **Regression tests** in `app/services/arkade/__tests__/lnurl.test.ts`:
   `resolveLnurlEndpoint` returns a non-null endpoint for `lightning:LNURL1…`,
   `LIGHTNING:LNURL1…`, `lnurl:LNURL1…`, and `lightning:user@host`, and remains
   `null` for genuinely invalid input. Add a parser test asserting the `lnurl`
   option's `raw` is the bare identifier.

Fix #1 alone resolves the reported failure; #2 hardens the boundary.

## Latent downstream issue (will surface once resolution is fixed)

Once Trixie resolves the endpoint, it will reach the params-fetch and
invoice-mint stage and can then hit the **fiat-pinned amount drift** that
BlueWallet and Arkade Wallet already show:

- The merchant pins a *fiat* price (Kč 200) and recomputes sats live, so the
  advertised `min/maxSendable`, the requested amount, and the minted BOLT11's
  amount can differ by a few sats (BlueWallet: requested 14921, got an invoice
  for 14908 → mismatch error; the QR/order amount was 14908).
- In Trixie, `SendAmountScreen.handleContinue` forwards `amountSats: sats` (the
  *requested* value) to Review, discarding the decoded invoice amount
  (`decoded.amountSats`), so Review's displayed amount, fiat estimate, fee
  quote (`SendReviewScreen.tsx:271`) and balance check run on a figure that
  isn't what settles. Settlement itself pays the invoice verbatim
  (`useAppStore.ts:1471` calls `sendLightningPayment({ invoice })`), so the
  amounts decouple silently. `fetchLnurlInvoice` also never validates the
  returned invoice against the request (`app/services/arkade/lnurl.ts:224`).
- Fix direction: make the **decoded BOLT11 the source of truth** — forward
  `decoded.amountSats` to Review, validate the callback response is within
  `[minSendable, maxSendable]`, and (for the fiat-pinned POS case) treat the
  minted invoice as authoritative rather than erroring on a within-range
  mismatch. Opago ignoring the requested amount is arguably LUD-06
  non-compliant; worth a courtesy report upstream regardless.

These two can land as separate PRs: **#1 (resolution) is the blocker** for the
reported error; the amount-drift hardening can follow.
