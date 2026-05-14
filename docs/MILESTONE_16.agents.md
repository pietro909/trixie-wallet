# Milestone 16: Mainnet Support

Goal: let users choose between mutinynet and Bitcoin mainnet when creating or
restoring a wallet.

This milestone should prove:

- A user creating a new wallet sees a network selector (mutinynet / mainnet)
  and the choice is persisted with the wallet.
- A user restoring from a seed phrase sees the same selector.
- A user restoring from a backup file has the network pre-selected from the
  backup and the selector is disabled.
- The correct server URLs (Ark, Boltz, Explorer, LNURL) are used for each network at runtime.
- The payment parser prevents cross-network sends (e.g., sending mainnet sats to a mutinynet address).

## Current State

- The app is hardcoded to mutinynet.
- The sister app `../wallet` already holds the mainnet and mutinynet server
  URLs; they should be mirrored here.
- The backup format (v2, from Milestone 10) does not carry a `network` field.
- The Restore Wallet screen has no network selector.
- The payment parser (`paymentParser.ts`) accepts both `ark1` and `tark1` prefixes regardless of the active network.

## Product Rules

- **No Silent Migrations:** Per `FOUNDATION.md`, do not write `migrate()` logic. Bump `CURRENT_SCHEMA_VERSION` to `6` and let the app trigger the schema mismatch modal. Users must wipe and re-onboard (or restore from a v6 backup).
- **Network Gating:** Never connect a mainnet seed to a mutinynet node, or vice versa.
- **Parser Enforcement:** An `ark1` address is invalid on Mutinynet; a `tark1` address is invalid on Mainnet.
- **Visual Gating:** Mainnet and mutinynet wallets must be visually distinct so a user cannot mistake which network they are on.

## Selected Direction

Add a `network` field (`'mutinynet' | 'mainnet'`) to the wallet store and to
the backup payload. Surface a network selector in the Create and Restore-from-seed flows. When restoring from a backup file, read the `network` field and lock the selector. Harden the payment parser to validate HRPs against the active network.

## Technical Refinement & Actionable Plan

### 1. Store & Persistence Updates

- **Schema Bump:** Increment `CURRENT_SCHEMA_VERSION` to `6` in `app/store/useAppStore.ts`.
- **State Changes:**
  - Add `selectedNetwork: 'mainnet' | 'mutinynet'` to `AppState["network"]`.
  - Initialize `selectedNetwork` in `DEFAULT_STATE` to `'mutinynet'`.
- **Actions:**
  - `setNetwork(network: 'mainnet' | 'mutinynet')`: Updates both `selectedNetwork` and `arkServerUrl` to their respective default production URLs.
  - `createWallet` & `restoreWallet`:
    - **Pre-flight Check:** Probe the server *before* requesting seed entry if possible.
    - **Gating Rule:** Compare `probed.network` with `selectedNetwork`. Throw an error if they mismatch.
  - `importBackup`:
    - Read `network` from the backup payload.
    - Set `selectedNetwork` and `arkServerUrl` accordingly.
    - Apply the same gating rule during the post-import `probeServer()` check.

### 2. Networking & Services

- **Constants (`app/services/arkade/network.ts`):**
  - Export `MAINNET_ARK_SERVER_URL = "https://arkade.money"`
  - Export `MUTINEYNET_ARK_SERVER_URL = "https://mutinynet.arkade.sh"`
  - Update `LNURL_SERVER_URLS` to include `mainnet: "https://lnurl.arkade.money"`.
- **Lightning/Boltz (`app/services/arkade/lightning.ts`):**
  - Verify `BOLTZ_API_URLS` correctly maps `bitcoin` to `https://api.ark.boltz.exchange`.
- **Explorer (`app/services/activity-details/explorer.ts`):**
  - Ensure `bitcoin` maps to `arkade.space` / `mempool.space`.
- **Parser (`app/services/paymentParser.ts`):**
  - Update `ARKADE_RE` detection to be network-aware.
  - If `network === 'mainnet'`, only `ark1` is `isPayable`.
  - If `network === 'mutinynet'`, only `tark1` is `isPayable`.
  - Add a descriptive `warning` when a mismatch is detected (e.g., "This is a Mutinynet address, but you are on Mainnet").

### 3. UI/UX Implementation

- **Network Selector Component (`app/components/NetworkSelector.tsx`):**
  - A segmented control (Mainnet / Mutinynet) with the Ark server URL as a sub-label.
  - Disables itself when a wallet exists.
- **Landing Screen (`app/screens/LandingNoWallet.tsx`):**
  - Place `NetworkSelector` at the top. Selecting updates the store immediately.
- **Visual Distinction (`app/screens/WalletScreen.tsx`):**
  - **Mainnet:** Use the brand primary color (`#ff007f`) for the network badge.
  - **Mutinynet:** Use a "Caution" style (e.g., amber/yellow badge) or a persistent "Experimental / Play Money" header to prevent confusion.
- **Safety Feedback:** Ensure the `SendEntryScreen` prominently displays the "Wrong network" warning from the parser.

### 4. Verification Plan (E2E)

1. **Schema Wipe:** Install old version -> Update -> Verify "Schema Mismatch" modal appears and Wipe works.
2. **Create New (Mutinynet):** Select Mutinynet -> Create -> Verify server is `mutinynet.arkade.sh` and parser rejects `ark1` addresses.
3. **Create New (Mainnet):** Select Mainnet -> Create -> Verify server is `arkade.money` and parser rejects `tark1` addresses.
4. **Network Mismatch Guard:** Set server to `arkade.money` but select "Mutinynet" in UI -> Attempt Create -> Verify it fails with a network mismatch error.
5. **Backup Restore:** Export Mutinynet backup -> Import -> Verify app switches to Mutinynet and locks selector.
