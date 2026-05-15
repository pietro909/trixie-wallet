# Milestone 16: Mainnet Support

Goal: let users choose between mutinynet and Bitcoin mainnet when creating or
restoring a wallet.

This milestone should prove:

- A user creating a new wallet sees a network selector (mutinynet / mainnet)
  and the choice is reflected in the wallet's persisted `network` field.
- A user restoring from a seed phrase sees the same selector.
- A user restoring from a backup file has the network sourced from the
  backup; no network selector is rendered during the backup-password flow.
- The correct server URLs (Ark, Boltz, Explorer, LNURL where available) are
  used for each network at runtime.
- The payment parser prevents cross-network sends (e.g., a `tark1` address is
  non-payable from a mainnet wallet).

## Current State

- The default Ark server URL is `https://mutinynet.arkade.sh`
  (`DEFAULT_ARK_SERVER_URL` in `app/services/arkade/network.ts`). The
  Advanced screen exposes a custom-URL editor today (removed in §3 of
  this milestone); the create/restore UX assumes mutinynet.
- The sister app `../wallet` (`src/lib/constants.ts:8-9`) hard-codes both
  defaults: `testServer = "https://mutinynet.arkade.sh"`,
  `mainServer = "https://arkade.computer"`. Mirror those — `arkade.money` is
  the brand site, not the arkd endpoint.
- The backup format (v2) **already carries** `wallet.network` (see
  `app/services/backup/serializer.ts:38, 75, 202-220`). No payload change is
  required; the import path just needs to honor it.
- `ArkadeWalletMetadata.network: string` is already populated from
  `probeServer().network` at `useAppStore.ts:1001, 1089, 2016`, and
  `buildMnemonicIdentity(mnemonic, isMainnet)` (`identity.ts:95`) already
  derives the BIP32 path from `isMainnetForNetworkName(probed.network)`.
- The Landing screen (`app/screens/LandingNoWallet.tsx`) and Restore screen
  (`app/screens/RestoreWallet.tsx`) show the current `arkServerUrl` but have
  no network selector. The Restore-from-backup path goes through
  `RestoreBackupPassword` → `importBackup`.
- `parsePaymentInput` already takes `{ network }` via `ParsePaymentOptions`
  and uses it for Bitcoin address validation, but `ARKADE_RE` accepts both
  `ark1` and `tark1` regardless of network at three call sites:
  `detectBareType` (line 142), `parseArkadeBody` (line 278), and the BIP21
  `ark`/`arkade` param branch in `parseBitcoinBody` (line 429).
- `app/services/activity-details/explorer.ts:14, 20` currently maps both
  `bitcoin` and the lowercase `mainnet` alias to `arkade.space` /
  `mempool.space`. Milestone 16 should remove the `mainnet` alias and keep
  SDK `NetworkName` values only.
- `app/services/arkade/lightning.ts:52` already sets
  `BOLTZ_API_URLS.bitcoin = "https://api.ark.boltz.exchange"`.
- `CURRENT_SCHEMA_VERSION` is already `6` (`useAppStore.ts:150`,
  `types.ts:186`) and stays `6` for this milestone. The persisted shape does
  not change.

## Product Rules

- **No Persistence Change:** Per `FOUNDATION.md`, do not write `migrate()`
  logic and do not bump `CURRENT_SCHEMA_VERSION`. This milestone reuses the
  existing `arkServerUrl` and wallet `network` fields; no new persisted slice
  or backup payload field is introduced.
- **Network Gating:** Never connect a mainnet seed to a mutinynet node, or
  vice versa. The BIP32 derivation path differs (`buildMnemonicIdentity`
  branches on `isMainnet`), so picking the wrong network silently produces
  a different wallet.
- **Parser Enforcement:** An `ark1` address must be non-payable on
  Mutinynet; a `tark1` address must be non-payable on Mainnet. Surface a
  descriptive warning, do not silently drop.
- **Mainnet Naming:** Use `bitcoin` as the canonical internal and persisted
  network name for Bitcoin mainnet, matching `@arkade-os/sdk`'s
  `NetworkName`. "Mainnet" is user-facing UI copy only. No alias-acceptance
  shims — at alpha, lowercase `mainnet` is not a value the codebase produces
  or accepts internally.
- **Backup Restore Source of Truth:** A backup restore must ignore the
  current UI-selected network. The encrypted backup payload's `wallet.network`
  is authoritative after decrypt. No network selector is rendered in the
  backup-password flow.
- **Visual Gating:** Mainnet and mutinynet wallets must be visually
  distinct so a user cannot mistake which network they are on.

## Selected Direction

Surface a network selector in the Create and Restore-from-seed flows that
sets `arkServerUrl` to one of two known defaults. When restoring from a
backup file, the backup's `wallet.network` field is the source of truth;
no network selector is rendered during the backup-password flow. Harden
the payment parser to gate ark HRPs by the active network. Visually
differentiate mutinynet from mainnet via the network badge color so the
user cannot confuse the two.

This wallet only works with Arkade servers; the user can pick the
environment (mainnet / mutinynet) but cannot point at a custom server. The
existing custom-URL editor on `AdvancedScreen` is removed as part of this
milestone.

## Technical Refinement & Actionable Plan

### 1. Store & Persistence Updates

- **No schema bump.** Leave `CURRENT_SCHEMA_VERSION` and the typed
  `schemaVersion` literal at `6`; the persisted app-state shape is unchanged.
- **No new persisted slice.** The user's network choice flows through
  the existing `arkServerUrl` field.
- **Canonical network values.** Persist `bitcoin` for Bitcoin mainnet and
  `mutinynet` for Mutinynet (SDK `NetworkName` strings). Display layer
  translates `bitcoin` → "Mainnet" for user-facing copy.
- **New action `setArkadeNetwork(network: 'bitcoin' | 'mutinynet')`:**
  The only user-facing way to change the Ark server. Writes the matching
  canonical URL into `arkServerUrl`, resets `detectedNetwork`,
  `serverInfo`, and `status` (same shape as the existing
  `setArkServerUrl` at `useAppStore.ts:945-949`). The existing
  `setArkServerUrl` action can be removed (it is referenced only by
  `AdvancedScreen`, which is being changed — see §3).
- **`createWallet` / `restoreWallet`:** No structural change. The
  existing probe-then-derive-`isMainnet` flow
  (`useAppStore.ts:988-989, 1074-1075`) already enforces the rule:
  whatever the server reports is what we derive against. The selector
  just makes sure the user is pointing at the right server before
  pressing Create. Do not persist or pass an Esplora URL for default
  networks; omit `esploraUrl` and let the SDK use `ESPLORA_URL[network]`.
- **`importBackup`:** Treat `payload.wallet.network` (already parsed by
  `serializer.parseWallet`) as the source of truth. Derive the canonical Ark
  server URL from that network (`bitcoin → MAINNET_ARK_SERVER_URL`,
  `mutinynet → MUTINYNET_ARK_SERVER_URL`) and probe the derived URL. The
  backup's saved `wallet.arkServerUrl` is legacy/diagnostic data only; do not
  use it to choose the restore server now that custom servers are removed.
  Compare `payload.wallet.network` with `probed.network` — both are SDK
  `NetworkName` strings, compared as-is. On mismatch, throw a descriptive
  `ArkadeError`. Do not persist or re-save SDK default Esplora URLs from
  backups; default networks should rely on the SDK's `ESPLORA_URL[network]` at
  runtime.
- **Atomic backup restore:** Stage the entire backup import in local variables
  before mutating persisted Zustand state. Decrypt, parse, derive canonical
  Ark URL, probe, compare networks, derive identity, create the wallet runtime,
  rebuild metadata, and normalize restored assets/preferences first. Only
  after all validation and restore work succeeds should `importBackup` perform
  one final `set()` that commits `wallet`, `network.arkServerUrl`,
  `network.detectedNetwork`, `network.serverInfo`, `walletBehavior`,
  `preferences`, `assets`, and `security.lastBackupAt`, followed by
  `persist(get())`.
- **Rollback boundary:** Any external side effects written before the final
  store commit must be tracked and cleaned up on failure: delete the staged
  secret, dispose the wallet runtime, and clear restored swap/metadata rows for
  that wallet (or restore them inside a transaction if the repository supports
  it). Avoid using `network.status = "connecting"` as import progress unless
  the previous network slice is restored on every failure; the backup password
  screen already has loading stages. Post-commit work such as scheduling
  lightning restore happens after persistence and must not roll back an
  otherwise successful import.

### 2. Networking & Services

- **Constants (`app/services/arkade/network.ts`):**
  - Export `MAINNET_ARK_SERVER_URL = "https://arkade.computer"` (matches
    sister wallet, `wallet/src/lib/constants.ts:9`).
  - Export `MUTINYNET_ARK_SERVER_URL = "https://mutinynet.arkade.sh"`
    (current value of `DEFAULT_ARK_SERVER_URL`). Either re-point
    `DEFAULT_ARK_SERVER_URL` to this new name or keep both exports;
    the default for first-launch stays mutinynet.
  - Narrow `MAINNET_NETWORK_NAMES` / `isMainnetForNetworkName` to SDK
    `NetworkName` values only: `bitcoin` is mainnet; lowercase `mainnet`
    is not accepted as an internal alias.
  - Extend `LNURL_SERVER_URLS` with
    `bitcoin: "https://lnurl.arkade.sh"`. Helper keys follow SDK
    `NetworkName` directly — no alias handling. The existing test in
    `app/services/arkade/__tests__/network.test.ts:14-22` needs to move
    `"bitcoin"` out of the "returns null" list and into a positive assertion.
  - Do not introduce an app-owned Esplora default or persist SDK defaults in
    wallet metadata. Where a diagnostic screen needs to display the default,
    read it from the SDK's `ESPLORA_URL[network]` map (already imported by
    `AdvancedScreen.tsx:1`).
- **Lightning / Boltz (`app/services/arkade/lightning.ts`):** No code
  change needed — `BOLTZ_API_URLS.bitcoin` is already set. Add a manual
  smoke check with a tiny mainnet wallet to E2E.
- **Explorer (`app/services/activity-details/explorer.ts`):** Keep the
  `bitcoin` mappings to `arkade.space` / `mempool.space`, and remove the
  lowercase `mainnet` alias entries so explorer helpers consume SDK
  `NetworkName` values only.
- **Parser (`app/services/paymentParser.ts`):**
  - Split `ARKADE_RE` into two:
    - `MAINNET_ARKADE_RE = /^ark1[02-9ac-hj-np-z]{20,}$/i`
    - `MUTINYNET_ARKADE_RE = /^tark1[02-9ac-hj-np-z]{20,}$/i`
  - Keep a combined `ANY_ARKADE_RE` for the "is this an arkade address at
    all" branch in `detectBareType`.
  - Add an `isArkadeAddressForNetwork(address, network)` helper that
    mirrors the existing `isBitcoinAddressForNetwork` (line 27).
  - Update the three call sites:
    - `detectBareType` (line 142): keep matching with `ANY_ARKADE_RE`,
      but the bare-arkade builders below must check the network.
    - `parseArkadeBody` (line 275): if the HRP belongs to a different
      network than the active one, return a single non-payable option
      with `warning: "This is a Mainnet address, but you are on Mutinynet"`
      (or the reverse). Use Title Case "Mainnet" / "Mutinynet" in
      user-facing copy — the parser owns the translation from internal
      `bitcoin` / `mutinynet` to display labels.
    - BIP21 `ark`/`arkade` param branch in `parseBitcoinBody` (line 428):
      same treatment — wrong-HRP arkade params become non-payable, not
      silently absent.
  - `SendEntryScreen` (line 95) already passes `network` to
    `parsePaymentInput` and surfaces single-option `warning` text
    (line 112); no UI change required.

### 3. UI/UX Implementation

- **Network Selector Component (`app/components/NetworkSelector.tsx`):**
  - A segmented control (Mainnet / Mutinynet) with the resolved Ark
    server URL shown as a sub-label.
  - Only rendered in the no-wallet branch (`Landing`, `RestoreWallet`).
    `RootStack.tsx` already swaps the route tree once a wallet exists,
    so the component does not need its own gating. It is **not** rendered
    in the backup-password flow (`RestoreBackupPassword`).
  - Selection calls `setArkadeNetwork(value)`.
- **Landing Screen (`app/screens/LandingNoWallet.tsx`):**
  - Insert `NetworkSelector` above (or just below) the welcome block.
    Replace the existing `Server: …` hint with the selector's sub-label
    so the URL is not shown twice.
- **Restore Wallet (`app/screens/RestoreWallet.tsx`):**
  - Place `NetworkSelector` at the **top** of the screen. Add helper copy
    immediately below it with this scope: "This selection applies only to
    seed phrase or private-key restore. Backup files restore using the network
    saved inside the backup." The selector is not rendered on
    `RestoreBackupPassword`.
- **Visual Distinction (`app/screens/WalletScreen.tsx` + theme):** Recolor
  the existing network tag at `WalletScreen.tsx:187-189`:
  - Mainnet: `#ff007f` (brand primary).
  - Mutinynet: an amber/warning color (introduce a `theme.colors.warning`
    if one is not already present; otherwise reuse the closest cautionary
    token). No banner, no app-wide color flip — only the badge.
  Render the tag using a high-contrast style so it remains the obvious
  network identifier across light and dark themes.
- **Advanced screen cleanup (`app/screens/AdvancedScreen.tsx`):** Remove
  the editable "Server URL" section (lines ~477-525: `TextInput`, Test,
  Apply, status pill row). Keep the read-only server info card
  (detected network, signer pubkey, exit delay, etc.) and the
  `refreshServer` action — those remain useful for diagnostics. Drop
  the local `draft` / `normalizedDraft` / `setArkServerUrl` references
  and the `defaultEsploraUrl` helper if it becomes unused (the SDK
  `ESPLORA_URL` map is the source of truth post-§2).
- **Safety Feedback:** `SendEntryScreen` already surfaces single-option
  warnings; verify the wrong-network message renders legibly.

### 4. Tests

- **Unit (`app/services/__tests__/paymentParser.test.ts`):**
  - `parsePaymentInput("ark1...", { network: 'mutinynet' })` → option is
    not payable, warning mentions both networks.
  - `parsePaymentInput("tark1...", { network: 'bitcoin' })` → same.
  - `parsePaymentInput("bitcoin:bc1…?ark=tark1…", { network: 'bitcoin' })`
    → arkade option non-payable, bitcoin option payable.
- **Unit (`app/services/arkade/__tests__/network.test.ts`):**
  - Move `"bitcoin"` out of the LNURL "returns null" list and assert it
    resolves to `https://lnurl.arkade.sh`. No `"mainnet"` alias coverage —
    callers pass SDK strings only.
  - Add a regression assertion that `isMainnetForNetworkName("mainnet")` is
    false, while `isMainnetForNetworkName("bitcoin")` is true.
  - Add coverage for `MAINNET_ARK_SERVER_URL` /
    `MUTINYNET_ARK_SERVER_URL` exports.
- **Unit (`app/services/backup/__tests__/serializer.test.ts`):**
  - Add a fixture with `wallet.network: "bitcoin"` and verify it
    round-trips (the existing fixture uses `"mutinynet"`).
- **Store action (a focused unit for `setArkadeNetwork`):**
  - `setArkadeNetwork('bitcoin')` → `arkServerUrl === MAINNET_ARK_SERVER_URL`,
    `detectedNetwork === null`, `serverInfo === null`.
  - `importBackup` with a backup whose `wallet.network` disagrees with the
    server probe → throws and leaves no half-imported wallet, no mutated
    `network` / `walletBehavior` / `preferences` state, and no staged
    secret/swap metadata rows for the failed wallet.

### 5. Verification Plan (E2E, manual on a device)

1. **Existing install:** Build against a device that already has a v6 wallet
   → verify no schema mismatch modal is shown and the existing wallet still
   opens normally.
2. **Create New (Mutinynet):** Select Mutinynet → Create seed wallet →
   verify `arkServerUrl === https://mutinynet.arkade.sh`,
   `wallet.network === "mutinynet"`, and pasting an `ark1…` address into
   Send is rejected with the wrong-network warning.
3. **Create New (Mainnet):** Select Mainnet → Create seed wallet →
   verify `arkServerUrl === https://arkade.computer`,
   `wallet.network === "bitcoin"`, and pasting a `tark1…` address is
   rejected.
4. **Backup Restore (happy path):** Export a Mutinynet backup → import on
   a clean install → verify app boots on mutinynet, the amber badge is
   in place, and the backup-password flow renders no network selector.
5. **Boltz mainnet smoke:** With a small mainnet wallet, exercise one
   receive swap and one send swap through Boltz to confirm
   `https://api.ark.boltz.exchange` is functional in our flow.

## Resolved Decisions

For the record, the five open questions raised during plan review have
been resolved as follows. They are baked into the plan above; this
section is a quick reference.

1. **No `selectedNetwork` state.** The selector writes `arkServerUrl`
   directly via the new `setArkadeNetwork`. Current network is derived
   from `detectedNetwork ?? wallet?.network`.
2. **Mainnet LNURL URL:** `https://lnurl.arkade.sh` (added to
   `LNURL_SERVER_URLS` under the canonical SDK `bitcoin` key).
3. **Visual distinction:** badge recolor only — `#ff007f` mainnet,
   amber/warning mutinynet. No banner, no app-wide theme flip.
4. **Mainnet esplora:** use the SDK's `ESPLORA_URL.bitcoin`
   (`https://mempool.arkade.sh/api`) at runtime. Do not persist SDK default
   Esplora URLs in wallet metadata and do not introduce an app-owned mainnet
   Esplora constant.
5. **No custom server URL.** The wallet only connects to Arkade-operated
   servers. The Advanced screen's URL editor is removed; environment
   choice (mainnet / mutinynet) lives solely on the network selector.
