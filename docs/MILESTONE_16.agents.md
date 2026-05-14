# Milestone 16: Mainnet Support

Goal: let users choose between mutinynet and Bitcoin mainnet when creating or
restoring a wallet.

This milestone should prove:

- A user creating a new wallet sees a network selector (mutinynet / mainnet)
  and the choice is persisted with the wallet.
- A user restoring from a seed phrase sees the same selector.
- A user restoring from a backup file has the network pre-selected from the
  backup and the selector is disabled.
- The correct server URLs are used for each network at runtime.

## Current State

- The app is hardcoded to mutinynet.
- The sister app `../wallet` already holds the mainnet and mutinynet server
  URLs; they should be imported or mirrored here.
- The backup format (v2, from Milestone 10) does not carry a `network` field.
- The Restore Wallet screen has no network selector.

## Product Rules

- Never connect a mainnet seed to a mutinynet node, or vice versa.
- The chosen network must survive app restarts and full backup/restore cycles.
- When a backup encodes a network, that value is authoritative — the selector
  must be pre-filled and read-only.
- Mainnet and mutinynet wallets must be visually distinguished in the UI so a
  user cannot mistake which network they are on.

## Selected Direction

Add a `network` field (`'mutinynet' | 'mainnet'`) to the wallet store and to
the backup payload (bump `schemaVersion`). Surface a network selector in the
Create and Restore-from-seed flows. When restoring from a backup file, read
the `network` field and lock the selector. Pull server URLs from the sister
app's constants rather than duplicating them.

## Technical Refinement & Actionable Plan

### 1. Store & Persistence Updates

- **Schema Bump:** Increment `CURRENT_SCHEMA_VERSION` to `6` in `app/store/useAppStore.ts`.
- **State Changes:**
  - Add `selectedNetwork: 'mainnet' | 'mutinynet'` to `AppState["network"]`.
  - Initialize `selectedNetwork` in `DEFAULT_STATE` to `'mutinynet'`.
  - Update `migrate()`: If `fromVersion < 6`, infer `selectedNetwork` from the existing `arkServerUrl` (if it contains "mutinynet", set to `'mutinynet'`, otherwise `'mainnet'`).
- **Actions:**
  - `setNetwork(network: 'mainnet' | 'mutinynet')`: Updates both `selectedNetwork` and `arkServerUrl` to their respective default production URLs.
  - `createWallet` & `restoreWallet`:
    - After `probeServer()`, compare `probed.network` with the `selectedNetwork`.
    - **Gating Rule:** Throw an error if the user selected "Mainnet" but the server reports a testnet/mutinynet network, and vice versa. This prevents seed leakage across network types.
  - `importBackup`:
    - Read `network` from the backup payload.
    - Set `selectedNetwork` and `arkServerUrl` accordingly.
    - Apply the same gating rule during the post-import `probeServer()` check.

### 2. Networking & Services

- **Constants (`app/services/arkade/network.ts`):**
  - Export `MAINNET_ARK_SERVER_URL = "https://arkade.money"`
  - Export `MUTINEYNET_ARK_SERVER_URL = "https://mutinynet.arkade.sh"`
- **Lightning/Boltz (`app/services/arkade/lightning.ts`):**
  - Verify `BOLTZ_API_URLS` correctly maps `bitcoin` to the mainnet API (`https://api.ark.boltz.exchange`).
- **Explorer (`app/services/activity-details/explorer.ts`):**
  - Ensure `MAINNET` and `MUTINEYNET` URLs are distinct and correctly mapped.

### 3. UI/UX Implementation

- **Network Selector Component (`app/components/NetworkSelector.tsx`):**
  - A segmented control allowing the user to toggle between "Mainnet" and "Mutinynet".
  - Shows the target Ark server URL as a sub-label for transparency.
  - Disables itself when a wallet already exists (multi-network support is out of scope for now).
- **Landing Screen (`app/screens/LandingNoWallet.tsx`):**
  - Place the `NetworkSelector` at the top of the action area.
  - Selecting a network updates the store's `selectedNetwork` and `arkServerUrl` immediately.
- **Restore Screen (`app/screens/RestoreWallet.tsx`):**
  - Show the `NetworkSelector` for the "Restore from seed" path.
  - Ensure the "Restore from backup" flow bypasses the manual selector (the network is discovered only after decryption).
- **Visual Gating (`app/screens/WalletScreen.tsx`):**
  - Enhance the `networkTag` with conditional styling.
  - **Mainnet:** Use a high-contrast badge (e.g., brand color background with white text) or a "Mainnet" label in the header.
  - **Mutinynet:** Use a "Mutinynet" label with a subtle/warning color to indicate its experimental nature.

### 4. Verification Plan (E2E)

1. **Create New (Mutinynet):** Select Mutinynet -> Create -> Verify server is `mutinynet.arkade.sh` and UI shows Mutinynet.
2. **Create New (Mainnet):** Select Mainnet -> Create -> Verify server is `arkade.money` and UI shows Mainnet.
3. **Restore Seed (Mainnet):** Select Mainnet -> Paste seed -> Verify wallet restores on Mainnet.
4. **Restore Backup (Cross-check):** Export a Mutinynet backup -> Reset -> Import -> Verify the app automatically switches to Mutinynet and locks the selector during the flow.
5. **Network Mismatch Guard:** Set server to `arkade.money` but select "Mutinynet" in UI -> Attempt Create -> Verify it fails with a network mismatch error.
6. **Persistence:** Kill app -> Restart -> Verify the selected network persists.
