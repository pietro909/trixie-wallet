# Milestone 30: Message Signing & QR Login (BIP-322, LNURL-auth, Nostr NIP-46)

**Status:** Draft (2026-06-29).

## Goal

Give Trixie Wallet a "sign / authenticate" surface built on the wallet's
existing secp256k1 identity, in three phases of increasing scope:

1. **Sign / verify a message** — produce and check BIP-322 signatures for an
   arbitrary text message, fully SDK-backed.
2. **QR login via LNURL-auth** — scan a website's login QR and authenticate
   with a per-domain linking key (LUD-04/LUD-05).
3. **QR login via Nostr NIP-46** — act as a remote signer ("bunker") for Nostr
   clients that connect by QR / connection string.

This milestone should prove:

- A user can sign a text message and produce a signature any Bitcoin wallet can
  verify, and can verify a third-party message/signature/address triple in-app.
- A user can scan an LNURL-auth QR and log into a website without the website
  learning anything beyond a domain-scoped public key.
- A user can pair a Nostr client by QR and approve signing requests, with the
  wallet holding a Nostr identity derived from the same seed.
- None of the above weakens the existing lock/secret posture: raw key material
  is read through a single audited chokepoint, gated behind `AuthGate`, never
  logged, and never persisted outside `expo-secure-store`.

## Context

### SDK surface (verified against `@arkade-os/sdk` 0.4.35)

1. **BIP-322 message signing is built in.**
   ```ts
   // node_modules/@arkade-os/sdk/dist/index.d.ts:2638
   namespace BIP322 {
     function sign(message: string, identity: Identity, network?: BTC_NETWORK): Promise<string>; // base64
     function verify(message: string, signature: string, address: string, network?: BTC_NETWORK): boolean;
   }
   ```
   `wallet.identity` satisfies `Identity`, so Phase 1 is a thin wrapper. The
   signature is bound to an *address*, which is the property that makes it
   externally verifiable.

2. **Low-level message signing also exists.**
   ```ts
   // node_modules/@arkade-os/sdk/dist/ark-D6sau_6-.d.ts:130
   signMessage(message: Uint8Array, signatureType: "schnorr" | "ecdsa"): Promise<Uint8Array>;
   ```
   plus `xOnlyPublicKey()` / `compressedPublicKey()` on `ReadonlyIdentity`. This
   is available if a raw schnorr/ecdsa signature over caller-controlled bytes is
   needed, but BIP-322 is preferred for the user-facing "sign message" feature.

3. **No encryption / ECDH / key-derivation primitives are exposed.** Grep of the
   `.d.ts` files finds no `encrypt`, `decrypt`, `ecdh`, `nip04`, `nip44`,
   `sharedSecret`. LNURL-auth's linking-key derivation, Nostr key derivation, and
   NIP-44 transport encryption must be built in the app layer on the `@noble` /
   `@scure` primitives below.

4. **`Identity` is opaque to the raw key.** `SingleKey` exposes `.toHex()`, but
   `MnemonicIdentity extends SeedIdentity` does **not** expose the seed or
   per-path keys. LNURL-auth (`m/138'`) and NIP-06 (`m/44'/1237'`) derivation
   therefore cannot go through the SDK identity; they must derive from the raw
   secret read out of `secret-store.ts`.

### App surface (verified)

- **Secret storage / chokepoint.** `app/services/arkade/secret-store.ts`
  `readSecret(walletId): Promise<StoredSecret>` returns
  `{ kind: "mnemonic" | "singleKey"; mnemonic?; privateKeyHex? }` from
  `expo-secure-store`. This is the *only* place raw key material lives.
- **Identity construction.** `app/services/arkade/identity.ts`
  `buildIdentityFromSecret()` builds `MnemonicIdentity` / `SingleKey`.
- **Active wallet.** `app/services/arkade/runtime.ts`
  `ensureWallet({ metadata, behavior })` returns the live `Wallet` with
  `.identity`.
- **Re-auth gate.** `app/components/AuthGate.tsx` already wraps sensitive
  surfaces (AdvancedScreen, VtxoDetailScreen, ProfileBackup, ProfileReset) with
  password/biometric re-auth. Reuse it for any raw-key operation.
- **Lock gate.** All cryptographic actions must branch on
  `state.security.isLocked` (the SDK wallet stays alive while locked; do not gate
  on wallet availability — see Milestone 29).
- **QR scan.** `app/screens/send/SendEntryScreen.tsx:191` —
  `expo-camera` `CameraView` with
  `barcodeScannerSettings={{ barcodeTypes: ["qr"] }}`, a focus check, and a
  scan-lock ref to debounce duplicate scans.
- **QR display.** `app/screens/receive/ReceiveQRScreen.tsx:577` —
  `react-native-qrcode-svg` `<QRCode value={payload} size={...} />`.
- **Navigation.** `app/navigation/RootStack.tsx` (modal routes) +
  `RootTabs.tsx` (Advanced / Wallet / Profile). New screens slot under the
  **Advanced** tab as a "Sign & Connect" section.
- **Schema.** `CURRENT_SCHEMA_VERSION = 8` in `app/store/useAppStore.ts`. Only
  Phase 3 adds persisted state and therefore bumps the schema.

### Crypto dependencies

Already direct dependencies (verified in `package.json`):

| Package | Version | Used for |
| --- | --- | --- |
| `@noble/ciphers` | `^2.2.0` | ChaCha20 (NIP-44 v2 transport) |
| `@noble/hashes` | `^2.2.0` | sha256, hmac-sha256, hkdf (NIP-44, LUD-05) |
| `@scure/base` | `^2.2.0` | bech32 decode/encode (LNURL, npub/nsec) |
| `@scure/bip39` | `^2.2.0` | mnemonic → seed |
| `@scure/btc-signer` | `^2.2.0` | exposes `HDKey` for BIP-32 derivation |

**Must be added** (currently only transitively present via the SDK — do not rely
on hoisting, pin explicitly per the project's pnpm peer-dep convention):

- `@noble/curves` (match the SDK's `2.0.1`) — secp256k1 schnorr (Nostr events),
  ECDSA (LNURL-auth), and ECDH (NIP-44 conversation key).

React Native provides a global `WebSocket`, so the Nostr relay client needs no
extra dependency.

## Product Rules

- **Single raw-key chokepoint.** All raw private-key / seed access goes through
  one new module (`app/services/auth/keyMaterial.ts`) that wraps `readSecret`.
  No other auth module calls `secret-store` directly. The module returns derived
  signing material for a specific purpose (a linking key, the Nostr key); it does
  not hand raw bytes to screens.
- **Re-auth before raw-key use.** Any operation that reads the seed/private key
  (LNURL linking-key derivation, Nostr key derivation, NIP-46 signing) must occur
  behind `AuthGate`. BIP-322 message signing goes through `wallet.identity` and
  does not touch raw material, but still requires an unlocked wallet.
- **Never log or persist raw material.** Raw key/seed bytes, derived linking
  private keys, and the Nostr secret key are never written to logs, the Zustand
  store, `AppState`, support bundles, or AsyncStorage. The Nostr key is
  *derived on demand* from the seed, not stored.
- **BIP-322 is the message-signing standard.** Phase 1 uses `BIP322.sign` /
  `BIP322.verify`, not raw `signMessage`, so signatures are interoperable and
  address-bound.
- **LNURL-auth follows LUD-04/LUD-05 exactly.** Per-domain linking key derived at
  the spec path; ECDSA signature over the `k1` challenge; the callback receives
  only `sig` + `key`. Never send the same key to two domains.
- **Nostr identity is seed-derived and separate from the Bitcoin identity.**
  Derive the Nostr key via NIP-06 (`m/44'/1237'/0'/0/0`) so it is recoverable
  from the existing mnemonic backup with no new backup artifact, and so the
  Bitcoin spend identity is never reused as a Nostr identity.
- **Single-key wallets are explicitly handled, not silently broken.** A
  `SingleKey` wallet has no HD tree, so standard LUD-05 per-domain derivation and
  NIP-06 derivation are unavailable. For these wallets, Phase 2/3 surfaces a
  clear "requires a recovery-phrase wallet" state rather than reusing the single
  key across domains (which would defeat LNURL-auth's privacy and conflate the
  Bitcoin key with a Nostr identity). Phase 1 (BIP-322) works for both wallet
  kinds.
- **NIP-46 approvals are explicit.** No request is signed without either a
  standing per-app permission the user granted at pairing, or an in-the-moment
  approval. Default-deny.
- **No schema migration.** Phases 1 and 2 add no persisted state. Phase 3
  persists Nostr pairing sessions; bump `CURRENT_SCHEMA_VERSION` `8 -> 9` so
  existing alpha installs hit the wipe-and-re-onboard modal. Do not write a
  migration path. (See FOUNDATION.md alpha policy.)
- **Phase 1 ships standalone.** BIP-322 sign/verify is independently valuable and
  must not be blocked on the auth-crypto layer that Phases 2/3 introduce.

## Implementation Plan

New service directory `app/services/auth/` holds the protocol logic; screens live
in `app/screens/auth/`. Keep all SDK/runtime access in the service layer and all
store mutations in store actions, preserving the runtime → store boundary.

### Phase 1 — BIP-322 Sign / Verify

#### 1.1 Service (`app/services/auth/bip322.ts`)

```ts
export async function signMessageBip322(message: string): Promise<{
  signature: string;     // base64
  address: string;       // the address the signature verifies against
}>;

export function verifyMessageBip322(
  message: string,
  signature: string,
  address: string,
): boolean;
```

- `signMessageBip322` acquires the wallet via `ensureWallet({ metadata, behavior })`,
  calls `BIP322.sign(message, wallet.identity, network)`, and returns the
  signature together with the address it is bound to.
- Map the app network name to `BTC_NETWORK` (`bitcoin` canonical → mainnet; see
  the Network Naming rule in CLAUDE.md). Do not accept lowercase `mainnet`.
- **Open question to resolve first:** which address `BIP322.sign` binds to. Write
  a unit test that round-trips `verify(msg, sign(msg, identity), addr)` against
  the wallet's candidate addresses (taproot/boarding/onchain derived from
  `identity.xOnlyPublicKey()`) to discover the correct `addr`, then surface
  exactly that address in the UI so the user copies a verifiable triple.

#### 1.2 Screen (`app/screens/auth/SignMessageScreen.tsx`)

- Two segments: **Sign** and **Verify**.
- *Sign*: multiline message input → "Sign" → show signature (selectable,
  copyable) + the bound address + a "Show QR" affordance rendering the signature
  with `react-native-qrcode-svg`.
- *Verify*: message + signature + address inputs → "Verify" → ✓ valid / ✗
  invalid, with no network calls.
- Gate the screen on `!security.isLocked`.

#### 1.3 Navigation

- Add a "Sign & Connect" entry in `AdvancedScreen.tsx`; register
  `SignMessage` in `RootStack.tsx`. Phases 2/3 add `AuthScan` and
  `NostrConnections` to the same section.

### Phase 2 — LNURL-auth

#### 2.1 Key material (`app/services/auth/keyMaterial.ts`)

```ts
// Behind AuthGate. Mnemonic wallets only; throws a typed error for SingleKey.
export async function deriveLnurlLinkingKey(walletId: string, domain: string): Promise<{
  privateKey: Uint8Array;
  publicKeyHex: string; // compressed
}>;
```

- Read the secret via `readSecret`; reject `kind: "singleKey"` with a typed
  `AuthUnsupportedForWalletError`.
- `seed = mnemonicToSeed(mnemonic)`; `root = HDKey.fromMasterSeed(seed)`.
- LUD-05: `hashingKey = root.derive("m/138'/0").privateKey`;
  `material = hmacSha256(hashingKey, utf8(domain))`; first 16 bytes → four
  big-endian `uint32` `p1..p4`; linking key at `m/138'/p1/p2/p3/p4`.
- Never return the seed or `root`; return only the domain-scoped linking key.

#### 2.2 Protocol (`app/services/auth/lnurlAuth.ts`)

```ts
export function parseLnurlAuth(scanned: string): { url: URL; k1: string; action?: string } | null;
export async function completeLnurlAuth(scanned: string, walletId: string): Promise<{ domain: string }>;
```

- Accept `lnurl1...` (bech32, via `@scure/base`), `lightning:lnurl1...`, and
  `keyauth://` / `https://...?tag=login&k1=...` forms; decode to the callback
  URL and `k1`.
- Derive the linking key for the URL's domain (2.1), ECDSA-sign the 32-byte `k1`
  (low-S, DER) with `@noble/curves` secp256k1, then `GET callback?sig=<derHex>&key=<linkingPubHex>`
  (preserving existing query params).
- Surface the domain prominently for user confirmation **before** signing;
  default to showing, not auto-submitting.

#### 2.3 Scanner (`app/screens/auth/AuthScanScreen.tsx`)

- One `CameraView` (reuse the `SendEntryScreen` pattern: focus check + scan-lock
  ref). Sniff the scanned string and dispatch: `lnurl`/`lightning:`/`keyauth:` →
  LNURL-auth confirm sheet; `nostrconnect://`/`bunker://` → Phase 3 handler.
- Show a confirm sheet (domain + action) → on confirm, run behind `AuthGate`,
  show progress, then success/failure copy.

### Phase 3 — Nostr NIP-46 (remote signer)

This is the heaviest phase: a persistent relay connection, encrypted transport,
session/permission state, and lifecycle management. Implement the connect +
`get_public_key` + `sign_event` happy path first; treat broad method coverage as
incremental.

#### 3.1 Nostr identity (`app/services/auth/nostrIdentity.ts`)

- NIP-06 derivation behind `AuthGate`: `m/44'/1237'/0'/0/0` from the seed →
  32-byte Nostr secret key; x-only pubkey → `npub` (bech32 via `@scure/base`).
- Mnemonic wallets only; `SingleKey` surfaces the unsupported state.
- Derived on demand; never persisted.

#### 3.2 NIP-44 v2 transport (`app/services/auth/nip44.ts`)

- Implement NIP-44 v2 to spec: conversation key =
  `hkdf_extract(ikm = ecdh_x(a, B), salt = "nip44-v2")`; per-message
  `hkdf_expand` to chacha key (32) + nonce (12) + hmac key (32); ChaCha20
  (`@noble/ciphers`) + the spec padding scheme; MAC = `hmac_sha256(aad = nonce,
  key = hmacKey, ciphertext)`; payload = `base64(version(0x02) || nonce(32) ||
  ciphertext || mac(32))`. ECDH via `@noble/curves`.
- Port the official NIP-44 test vectors into the unit suite; this is
  security-critical and must not be approximated.

#### 3.3 Remote signer (`app/services/auth/nip46.ts` + runtime relay client)

- Parse `nostrconnect://<client-pubkey>?relay=<wss>&secret=<s>&perms=<...>` (and
  `bunker://`) from the scanner.
- Open the relay `WebSocket`, subscribe to NIP-46 request events (kind 24133)
  addressed to the Nostr pubkey, decrypt with NIP-44, and handle methods:
  `connect`, `get_public_key`, `sign_event` (schnorr over the event id),
  `ping`, and the `nip44_encrypt`/`nip44_decrypt` helpers. Encrypt and publish
  responses.
- Live the relay connection in `runtime.ts` with detach-before-attach lifecycle
  (mirroring `attachIncomingFundsSubscription`); tear down on `disposeWallet()`.
  The store wires it after creation; runtime never imports the store.
- Lock clears live connections; unlock can re-establish from persisted sessions.

#### 3.4 Sessions & permissions (store)

- New persisted `AppState` field: connected Nostr sessions
  `{ clientPubkey, relays, label, permissions, createdAt }[]` (no secrets).
- Bump `CURRENT_SCHEMA_VERSION` `8 -> 9`; update the matching hydrate fixtures in
  `app/store/__tests__/useAppStore.test.ts` (mirror the Milestone 29 schema-bump
  test changes).
- Live connection state and pending approval prompts are transient `StoreState`,
  excluded from `persist()`.
- `app/screens/auth/NostrConnectionsScreen.tsx`: list paired clients, their
  permissions, and a revoke action; an approval prompt for default-deny requests.

## Verification

### Automated

- **BIP-322 round-trip:** `signMessageBip322` output verifies via
  `verifyMessageBip322` against the returned address; a tampered message,
  signature, or address fails. The address-discovery test pins which wallet
  address `BIP322.sign` binds to.
- **LUD-05 derivation:** `deriveLnurlLinkingKey` reproduces known LUD-05 test
  vectors (hashing key path, HMAC material split into four `uint32`, final path);
  the same domain is deterministic and two different domains yield different
  linking keys. `SingleKey` input throws `AuthUnsupportedForWalletError`.
- **LNURL parsing:** `parseLnurlAuth` decodes bech32 `lnurl1...`,
  `lightning:` prefixes, and `keyauth://`/HTTPS `tag=login` forms; rejects
  non-login LNURL tags and malformed input.
- **k1 signature shape:** the ECDSA signature over `k1` is low-S DER and verifies
  against the linking public key.
- **NIP-06 derivation:** Nostr key matches NIP-06 reference vectors;
  npub/nsec bech32 encode/decode round-trips.
- **NIP-44 v2:** the official NIP-44 test vectors pass for encrypt and decrypt,
  including padding and MAC; a flipped ciphertext/MAC byte fails decryption.
- **NIP-46 handlers:** with a mocked relay, `get_public_key` and `sign_event`
  produce correctly NIP-44-encrypted responses; a request from a non-paired /
  unpermitted client is denied without signing.
- **Locked gating:** every raw-key entry point and `signMessageBip322` return /
  refuse when `security.isLocked` is true.
- **Transient persistence:** live Nostr connection state and approval prompts are
  excluded from `persist()`; only the secret-free session list is persisted.
- **Schema wipe:** persisted schema `8` hits the mismatch modal under
  `CURRENT_SCHEMA_VERSION = 9` (Phase 3 only); update hydrate fixtures.

### Manual / Integration

- **Sign / verify:** sign a message, verify the triple in a third-party BIP-322
  verifier; paste an external triple into Verify and confirm the result.
- **LNURL-auth:** scan a real LNURL-auth login QR (e.g. a test login page),
  confirm the domain, authenticate, and confirm the site logs in; re-login to the
  same domain reuses the same linking key (stable identity), a different domain
  uses a different key.
- **NIP-46:** pair a Nostr client by scanning its `nostrconnect://` QR, approve a
  `sign_event` request, and confirm the client receives a valid signed event;
  revoke the session and confirm subsequent requests are denied.
- **Lifecycle:** lock/restart/unlock with a paired Nostr session; confirm the
  session list survives (Phase 3) while no secret material is persisted, and the
  relay reconnects after unlock.
- **Single-key wallet:** confirm Phase 1 works and Phases 2/3 show the clear
  "requires a recovery-phrase wallet" state instead of failing opaquely.

### Security review

This milestone introduces raw-key access and hand-rolled cryptographic transport.
Run `/security-review` on the Phase 2 and Phase 3 diffs before merge, with
specific attention to: the `keyMaterial` chokepoint not leaking raw bytes, NIP-44
conformance, low-S ECDSA, default-deny approvals, and absence of key material in
logs/persistence/support bundles.

## Out of Scope

- **Encrypt / decrypt arbitrary text as a user-facing feature.** The NIP-44
  primitives are built for NIP-46 transport only; no standalone "encrypt this
  text to a pubkey" screen in this milestone.
- **NIP-07 browser-extension signing** and in-app WebView dApp injection.
- **Multiple Nostr accounts / non-zero NIP-06 account indices.**
- **LNURL-pay / LNURL-withdraw / LNURL-channel** (only `tag=login` is in scope;
  payment LNURL flows belong to the receive/send surfaces).
- **Reusing the Bitcoin spend identity as a Nostr identity** (explicitly rejected
  by the seed-derived-Nostr-key rule).
- **Localizing new copy** through a full i18n pass; use the current
  hardcoded-string pattern until Milestone 27 lands.
