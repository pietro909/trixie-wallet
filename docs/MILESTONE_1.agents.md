# Milestone 1: Direct Arkade SDK Wallet Prototype

Goal: replace the mock wallet core with a working direct `@arkade-os/sdk`
prototype for iOS and Android. Use the SDK `Wallet` class directly. Do not use
`ServiceWorkerWallet` or any service-worker related path.

This milestone should prove:

- A user can create either a mnemonic seed wallet or a single-key wallet.
- The app can persist enough metadata to recreate the SDK wallet after app
  restart/unlock.
- The app can show real SDK-derived Arkade and boarding addresses.
- Balance/history refresh calls the SDK instead of mock data.
- Arkade-to-Arkade send calls `wallet.send(...)`.

## Current State

- `app/store/useAppStore.ts` creates a mock wallet via `generateMockWallet()`.
- `app/services/receive.ts` generates deterministic fake Arkade, Bitcoin,
  Lightning, and LNURL payloads from the mock wallet id.
- `app/services/sendExecutor.ts` simulates sends, random failures, fees, and
  transactions.
- `app/screens/NetworksScreen.tsx` is only a placeholder.
- The app already depends on `@arkade-os/sdk`, but the SDK is not wired into
  runtime wallet creation or persistence.

## SDK Findings

Use these SDK APIs:

- `Wallet.create(...)` from `@arkade-os/sdk`.
- `SingleKey.fromRandomBytes()`, `SingleKey.fromHex(...)`, and `toHex()`.
- `MnemonicIdentity.fromMnemonic(mnemonic, { isMainnet })`.
- `ExpoArkProvider` and `ExpoIndexerProvider` from
  `@arkade-os/sdk/adapters/expo`.
- `SQLiteWalletRepository` and `SQLiteContractRepository` from
  `@arkade-os/sdk/repositories/sqlite`.

The installed SDK docs recommend Expo providers for React Native streaming and
SQLite repositories for Expo/React Native persistence.

The sibling `../wallet` app uses the same identity split in its wallet provider:

- mnemonic credentials become `MnemonicIdentity.fromMnemonic(...)`;
- private-key credentials become `SingleKey.fromPrivateKey(...)`;
- the web app then passes that identity into `ServiceWorkerWallet.setup(...)`.

For Trixie, keep the identity logic but pass it to direct `Wallet.create(...)`.

## Dependencies And Bootstrap

Add native prerequisites:

- `expo-crypto`
- `expo-sqlite`
- direct `@scure/bip39` dependency if not already hoisted safely

Add the crypto polyfill before SDK imports. The first import path should be a
small setup module imported from `index.ts` before `App`.

Example shape:

```ts
import * as Crypto from "expo-crypto";

if (!global.crypto) {
  global.crypto = {} as Crypto;
}

global.crypto.getRandomValues = Crypto.getRandomValues;
```

Keep this isolated in something like `app/polyfills/crypto.ts`, then import it
first in `index.ts`.

## Network Configuration

Add a minimal Arkade network config layer.

Initial default for prototype:

```ts
const DEFAULT_ARK_SERVER_URL = "https://mutinynet.arkade.sh";
```

Rationale: mutinynet is safer than mainnet for a first working prototype.

Persist:

- `arkServerUrl`
- SDK-reported `network`
- optional `esploraUrl` override
- server reachability/loading/error state

Turn `NetworksScreen` into a small operational screen:

- current server URL
- detected network
- connection status
- refresh/test connection action

Use `new ExpoArkProvider(arkServerUrl).getInfo()` to derive network before
wallet creation. Use that network to choose `isMainnet` for mnemonic wallets.

`isMainnet` should be false for `testnet`, `mutinynet`, `signet`, and
`regtest`; true only for `bitcoin`.

## Runtime SDK Wallet Layer

Create an SDK runtime module, for example:

- `app/services/arkade/runtime.ts`
- `app/services/arkade/storage.ts`
- `app/services/arkade/identity.ts`
- `app/services/arkade/mappers.ts`

The runtime owns the non-serializable SDK `Wallet` instance.

Responsibilities:

- build identity from persisted encrypted secret;
- create the SQLite executor and repositories;
- create Expo providers;
- call `Wallet.create(...)`;
- expose `getWallet()`, `ensureWallet()`, `refreshWalletSnapshot()`,
  `disposeWallet()`, and `clearWalletData()`;
- never put the SDK wallet instance into Zustand or AsyncStorage.

Prototype `Wallet.create(...)` shape:

```ts
const wallet = await Wallet.create({
  identity,
  arkServerUrl,
  arkProvider: new ExpoArkProvider(arkServerUrl),
  indexerProvider: new ExpoIndexerProvider(arkServerUrl),
  esploraUrl,
  storage: {
    walletRepository: new SQLiteWalletRepository(executor),
    contractRepository: new SQLiteContractRepository(executor),
  },
  settlementConfig: false,
});
```

Use `settlementConfig: false` for milestone 1 so there is no surprise automatic
settlement while the UI is still being wired.

SQLite executor shape for `expo-sqlite`:

```ts
const db = SQLite.openDatabaseSync("trixie-arkade.db");

const executor = {
  run: (sql, params) => db.runAsync(sql, params ?? []),
  get: (sql, params) => db.getFirstAsync(sql, params ?? []),
  all: (sql, params) => db.getAllAsync(sql, params ?? []),
};
```

Use stable table prefixes per active wallet if multiple wallets are kept in
the existing `WalletContainer` model.

## Persisted State

Bump the app schema from v1 to v2.

Do not persist SDK objects. Persist public metadata and encrypted secret
references only.

Suggested wallet metadata:

```ts
type WalletIdentityKind = "mnemonic" | "singleKey";

type ArkadeWalletMetadata = {
  id: string;
  type: "arkade";
  label: string;
  identityKind: WalletIdentityKind;
  publicKeyHex: string;
  arkServerUrl: string;
  network: string;
  arkAddress: string;
  boardingAddress: string;
  balanceSats: number;
  transactions: Transaction[];
  backup: {
    hasMnemonic: boolean;
    hasPrivateKey: boolean;
  };
};
```

Secret storage must change before this becomes a real wallet.

Minimum milestone approach:

- use `expo-secure-store` for the mnemonic or private-key hex;
- store only a `secretId` / wallet id in AsyncStorage;
- never store plaintext mnemonic/private key in `app_state_v1`.

Follow-up hardening can replace or augment this with password-derived
encryption, but do not keep the existing `simpleHash()` as protection for real
wallet secrets.

## Create Wallet Flow

Replace the single "Create new wallet" action with a choice:

- "Create seed phrase wallet"
- "Create single key wallet"

Seed phrase wallet:

1. Generate a BIP39 mnemonic with `generateMnemonic(wordlist)`.
2. Fetch server info and derive `isMainnet`.
3. Build `MnemonicIdentity.fromMnemonic(mnemonic, { isMainnet })`.
4. Create the SDK wallet.
5. Fetch and persist:
   - compressed public key;
   - `wallet.getAddress()`;
   - `wallet.getBoardingAddress()`;
   - initial `wallet.getBalance()`;
   - initial `wallet.getTransactionHistory()`.
6. Store mnemonic in secure storage.
7. Persist public metadata in app state.

Single-key wallet:

1. Generate `const identity = SingleKey.fromRandomBytes()`.
2. Persist `identity.toHex()` in secure storage.
3. Use the same SDK wallet creation and metadata refresh path.

Keep the existing staged loading UX, but use real stages:

- "Connecting to Arkade..."
- "Generating wallet..."
- "Creating addresses..."
- "Syncing balance..."

## Restore Wallet Flow

Replace the disabled restore screen with support for:

- 12/24 word mnemonic;
- 64-char hex private key;
- optional `nsec1...` later if a dependency is added for decoding.

For milestone 1, hex and mnemonic are enough.

Validation:

- mnemonic: `validateMnemonic(value, wordlist)`;
- hex key: exactly 64 hex chars.

After validation, reuse the same `createSdkWalletFromIdentity` path and persist
metadata/secrets exactly like creation.

## Read Model Refresh

Add one central refresh path that maps SDK data into the app's current UI data:

```ts
const balance = await wallet.getBalance();
const history = await wallet.getTransactionHistory();
const arkAddress = await wallet.getAddress();
const boardingAddress = await wallet.getBoardingAddress();
```

Map `balance.total` or `balance.available` into the screen depending on UI copy.
For the first prototype, show:

- total balance as the primary balance;
- available / boarding as smaller stats if useful.

Map SDK `ArkTransaction` into the existing `Transaction` UI type:

- stable id from `boardingTxid || commitmentTxid || arkTxid`;
- direction from SDK `type`;
- amount from SDK `amount`;
- timestamp from SDK `createdAt`;
- status from SDK `settled`.

Keep the mapper isolated so the UI can stay mostly unchanged.

## Receive Integration

Replace fake receive payload generation:

- Arkade receive: `wallet.getAddress()`.
- Bitcoin/on-chain receive: `wallet.getBoardingAddress()`.

For milestone 1:

- keep Lightning disabled or clearly unavailable;
- keep LNURL disabled or clearly unavailable;
- remove fake LN invoice generation from user-visible flows.

The QR screen should become async:

- show skeleton/loading while `ensureWallet()` and address calls run;
- show a retry/error state if SDK setup or address generation fails.

## Send Integration

Replace mock `executeSend()` with SDK-backed Arkade send for Arkade addresses:

```ts
const txId = await wallet.send({
  address: option.rawOrAddress,
  amount: amountSats,
});
```

For milestone 1:

- support only `option.type === "arkade"`;
- mark Bitcoin, Lightning, and LNURL options as not payable or route them to a
  "coming later" error;
- refresh balance/history after successful send;
- keep the existing send result screen shape.

Fee display:

- remove fake fixed estimates where they imply real fees;
- show "calculated by SDK during send" or hide fee until result if SDK does not
  expose a preflight estimate in this path.

## Lock, Unlock, Reset

Lock:

- dispose the SDK wallet runtime;
- keep public metadata;
- keep secrets in secure storage.

Unlock:

- existing password/biometric gate can still control app access;
- after unlock, recreate SDK wallet from secure storage + metadata;
- refresh balance/history.

Reset:

- clear AsyncStorage app state;
- delete secure wallet secrets;
- clear SDK wallet and contract repositories;
- dispose runtime instance.

## Error Handling

Every SDK boundary should return typed app-level errors:

- server unreachable;
- network mismatch;
- invalid mnemonic/key;
- SDK wallet initialization failed;
- insufficient balance;
- unsupported payment rail;
- send failed.

Show errors through existing toast/inline UI. Avoid silent catch blocks around
wallet creation, refresh, and send.

## Verification

Run:

```bash
pnpm lint
pnpm exec tsc --noEmit
pnpm android
```

Manual acceptance:

1. Fresh install opens no-wallet landing.
2. User can choose seed phrase or single key.
3. Wallet creation connects to the configured Arkade server.
4. Wallet screen shows real SDK-derived address metadata and balance.
5. Receive Arkade QR encodes `wallet.getAddress()`.
6. Receive Bitcoin QR encodes `wallet.getBoardingAddress()`.
7. App restart/unlock recreates the SDK wallet and refreshes data.
8. Reset removes app metadata, secure secrets, and SDK repository data.
9. If a second test wallet is available, Arkade send calls `wallet.send(...)`
   and refreshes balance/history.

## Out Of Scope For Milestone 1

- Service worker integration.
- Lightning invoice generation.
- LNURL pay/receive.
- Boltz swaps.
- Asset issuance/reissue/burn.
- Background task processing.
- Delegation.
- Production-grade password-derived encryption migration.
- Fiat-rate replacement.

## Main Risks

- Native crypto setup must happen before SDK imports.
- The SDK wallet instance cannot be serialized; runtime recreation must be
  reliable.
- Existing app state stores secrets in plaintext mock backup fields; this must
  be removed before real secrets are persisted.
- React Native streaming support depends on Expo providers and `expo/fetch`.
- SQLite table names/prefixes need to be stable if multiple wallets are kept.
- Mainnet default would be risky; use mutinynet for the first prototype.

## Update — 2026-04-28: Network → Advanced tab

Scope grew beyond the original "small operational screen" brief. The Networks
tab became an Advanced surface aimed at power users: server config plus the
runtime/protocol facts the wallet relies on, plus raw exports for debugging.
Route renamed `Networks` → `Advanced`, lucide tab icon swapped to
`SlidersHorizontal`. File renamed
`app/screens/NetworksScreen.tsx` → `app/screens/AdvancedScreen.tsx`.

### Sections, top to bottom

1. **Server** (sole elevated card) — URL input, status pill folding
   `Online · network · vX.Y.Z` into one line, Apply / Test buttons.
2. **Endpoints** — Ark server, Indexer, Esplora, Delegate. Each row has icon,
   label, subtitle, truncated mono URL, copy button. Indexer URL is the same
   host as the Ark server; Esplora falls back to the SDK
   `ESPLORA_URL[network]` default; Delegate is shown as `Off` and inert
   because no `delegatorProvider` is wired today.
3. **Server details** (collapsible) — version, network, signer pubkey
   (copyable), forfeit address (copyable), dust threshold, unilateral exit
   (formatted as `Xd Yh`), tx fee rate. Sourced from `ArkadeServerInfo`.
4. **Wallet behaviour** — vtxo auto-renewal `Off` (we pass
   `settlementConfig: false`) and delegated renewal `Off`. Subtitles use
   product language, not API names.
5. **Diagnostics** — SDK versions (`@arkade-os/sdk`, `@arkade-os/boltz-swap`),
   app commit (copyable), app tag (rendered only when an exact tag exists at
   HEAD), then JSON copy actions for live server info, wallet record, and
   persisted app state (`passwordHash` redacted to `"[redacted]"`).

### Supporting changes outside the screen

- **`app/store/types.ts`** — new `ArkadeServerInfo` type (network, version,
  signer pubkey, forfeit address, dust sats, unilateral exit seconds, tx fee
  rate). Added `network.serverInfo: ArkadeServerInfo | null` to `AppState`.
- **`app/services/arkade/runtime.ts`** — `probeServer` returns the full info;
  new `fetchRawServerInfo` re-fetches and walks the response converting any
  `bigint` to string so the Diagnostics JSON copy works.
- **`app/store/useAppStore.ts`** — captures `serverInfo` on `refreshServer`,
  `createWallet`, and `restoreWallet`; clears it on URL change; persists.
- **`app/services/arkade/network.ts`** — new `normalizeServerUrl` accepts
  `mutinynet.arkade.sh`, `localhost:7070`, `192.168.1.5:7070`, etc. Picks
  `http` for loopback / RFC1918 hosts, `https` everywhere else. Validates via
  the `URL` constructor and drops trailing slashes. `setArkServerUrl` runs
  every input through it.
- **`app.config.ts`** (new) — wraps `app.json` via `ConfigContext`, injects
  `extra.versions` and `extra.git` at config-resolution time. Package versions
  are read via `fs.readFileSync` against `node_modules/<pkg>/package.json`
  because the SDK's exports map does not expose `./package.json`. A `compact`
  helper drops null fields before insertion — Expo's schema otherwise rewrites
  `null` in `extra` to `{}`, which would have made the screen think a tag
  exists when one does not. Read at runtime via `expo-constants`.

### UX behaviours worth remembering

- Test connection probes the normalized **draft** URL, not the persisted one.
  If the draft equals persisted, the action also runs through `refreshServer`
  so the status pill updates; otherwise it is a non-mutating probe and only
  the toast reports the result.
- Server URL input gets `inputMode="url"`, `autoComplete="url"`,
  `placeholder="mutinynet.arkade.sh"`, `returnKeyType="done"` with
  `onSubmitEditing` bound to apply (when dirty) or test.
- A "Will use {url}" hint appears under the input when the typed string
  normalizes to something different — non-destructive preview, no auto-edit
  while typing.
- Version segment of the status pill and Server-details "Version" row both
  guard against empty strings — mutinynet currently reports `version: ""` and
  the previous code rendered a bare `v`.
- Copy Pressables carry `accessibilityRole="button"` and explicit
  `accessibilityLabel`; the Server-details disclosure carries
  `accessibilityState={{ expanded }}`.
- Visual hierarchy is intentional: only the Server card has `shadow("card")`;
  the rest are bordered panels with no elevation.

### Picked up explicitly out of scope (for now)

- Esplora editor in-line (currently read-only; the override only lives on
  wallet metadata).
- Wiring `RestDelegatorProvider` (no auto-discovery from `ArkInfo`; would need
  a chosen URL).
- Surfacing `ArkInfo.serviceStatus` per-service.
- "Open URL externally" affordance on Endpoints.
