# RESOLVED

# ISSUE: LNURL Receive — Session-Based Flow

**Status:** RESOLVED  
**Confirmed lnurl-server (mutinynet):** `https://lnurl.mutinynet.arkade.sh`

> Implemented in:
> - `app/services/arkade/network.ts` (`lnurlServerUrlForNetwork`)
> - `app/hooks/useLnurlSession.ts`
> - `app/screens/receive/ReceiveQRScreen.tsx` (LNURL branch)
> - `app/screens/receive/ReceiveSelectScreen.tsx` (option enabled when a server URL is configured for the active network)
> - `app/services/receive.ts` (`makeLnurlPayload` removed; `"lnurl"` case now throws)
>
> The rest of this file is kept as a record of the root cause and protocol reference.

---

## Root cause

`makeLnurlPayload` in `app/services/receive.ts` constructs a bech32 that encodes
`https://{arkServerHost}/.well-known/lnurlp/{arkAddress}`. That URL does not exist
on the Ark server — it never did. The Ark server implements no LNURL-pay endpoints.

The bech32 inside a real LNURL is not a static address; it is a **pointer to a live
server session**. The session must be created by the wallet at receive-screen mount
time and kept alive (via SSE) until the screen unmounts or a payment lands.

The placeholder was disabled in `ReceiveSelectScreen` (the `unavailable: true` flag
the user removed), which masked the breakage. LNURL **send** (Trixie paying to an
Arkade LNURL) works correctly and is unrelated to this issue.

---

## How the correct protocol works (observed in `../wallet`)

### Step 1 — create session

```
POST https://lnurl.mutinynet.arkade.sh/lnurl/session
(no body, no auth header)
→ 200 OK  Content-Type: text/event-stream
```

The response body is an SSE stream. The wallet reads it with
`response.body.getReader()` — raw line-by-line parsing, no `EventSource` API.
The first event arrives almost immediately:

```
event: session_created
data: {"sessionId":"3737f4c1caab8384f7c79cbf38d53a90",
       "lnurl":"LNURL1DP68GURN8GHJ7MRWW4EXCTNDW46XJMNEDEJHGTNPWF4KZER99EEKSTMVDE6HYMP0XVMNXDMXX33NZCMPV93RSVECX3NRWCEH893KYE3N8PJR2VMP8YCQT6U0TK",
       "token":"72ddd0ba2f0f5ddd215d95086b5179ed3086ae81fadb3de11415298e332add2f"}
```

The wallet stores `sessionId` and `token` in refs, sets `lnurl` state → **this
is the string displayed as the QR code / shared with the sender.**

### Step 2 — sender requests payment

When the sender scans the LNURL and wants to pay, the server pushes a second
event over the same still-open stream:

```
event: invoice_request
data: {"amountMsat":50000,"comment":"optional text"}
```

The wallet calls its `onInvoiceRequest` handler with `{ amountMsat, comment }`.
In Arkade wallet this creates a Boltz reverse swap (Lightning → Ark) and returns
the `bolt11` invoice string. Trixie reuses the existing Lightning receive path
for this — `createLightningInvoice(...)` + `recordSwapMetadata(...)` from
`app/services/arkade/lightning.ts`, matching `ReceiveLightningAmountScreen`.

### Step 3 — post invoice (or error) back to server

Success path:
```
POST /lnurl/session/{sessionId}/invoice
Authorization: Bearer {token}
Content-Type: application/json
Body: {"pr":"lnbc500n1..."}
```

Failure path (swap creation failed, abort signal fired, etc.):
```
POST /lnurl/session/{sessionId}/invoice
Authorization: Bearer {token}
Content-Type: application/json
Body: {"error":"Failed to create invoice"}
```

The server hands the invoice (or error) to the waiting sender.

### Step 4 — session lifetime

The SSE stream stays open until:
- the wallet's `AbortController` fires (component unmounts), or
- the connection drops (server-side timeout / network loss).

On cleanup the hook aborts the controller; the `finally` block resets all state
(`lnurl → ""`, `active → false`). No explicit DELETE call is needed.

---

## Reference implementation (`../wallet/src/hooks/useLnurlSession.ts`)

The Arkade wallet hook is a near-complete blueprint. Key points:

- Uses `response.body.getReader()` + `TextDecoder({ stream: true })` — no
  `EventSource` dependency, so it is compatible with React Native / Hermes.
- External abort signals are forwarded to the internal `AbortController`, so the
  in-flight fetch is actually cancelled on unmount rather than just discarded.
- `onInvoiceRequest` is kept in a ref so the latest closure is always called even
  if the effect never re-runs.
- Errors during invoice creation are caught and posted back as `{ error }` so the
  sender gets a clean failure rather than a timeout.

---

## React Native / Hermes considerations

- `response.body.getReader()` is available in Expo SDK 55 + RN 0.83 on Hermes.
  Test that `reader.cancel()` triggered via `AbortController` actually terminates
  the stream on device — Hermes's cancellation behaviour differs slightly from V8.
- `TextDecoder` with `{ stream: true }` is polyfilled in Expo; verify it handles
  multi-chunk SSE lines correctly on a slow connection.
- The SSE connection is long-lived. Keep it in a `useEffect` with a cleanup
  function, exactly as the Arkade implementation does.
