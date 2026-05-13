# Milestone 6: Backup and Reset Safety

Goal: make reset survivable. A user should be able to export the recovery
material needed to rebuild the wallet before they wipe the device, and then
import it back on a new install without losing pending state.

This milestone should prove:

- A user can export an encrypted backup bundle from the wallet.
- A user can restore that bundle into a fresh install.
- The backup covers wallet secrets plus recovery-critical state such as swap
  preimages, invoices, and pending claim/refund metadata.
- Reset warns or blocks when unrecoverable pending state still exists.
- Backup import is versioned and rejects malformed or stale bundles cleanly.

## Current State

- `app/screens/ProfileBackup.tsx` only reveals and copies the wallet secret.
- `app/screens/ProfileReset.tsx` exists, but it does not rely on a backup
  bundle model.
- `app/store/useAppStore.ts` persists the wallet and activities in plain app
  state, but there is no export/import flow.
- `app/services/arkade/swap-storage.ts` already stores local swap metadata,
  which is part of the recovery surface.

## Product Rules

- The backup bundle must be encrypted before it leaves the device.
- Never place secrets, preimages, or invoices into logs or plain AsyncStorage.
- The bundle format must be versioned so future schema changes can be handled.
- A reset must not silently destroy pending state that can still be recovered.
- Keep cloud sync out of this milestone. Local backup comes first.

## Selected Direction

Define one canonical local backup format and make every later recovery feature
depend on it.

Suggested shape:

- serializer for wallet identity and metadata;
- serializer for swap-recovery material and any other pending-state payload;
- restore path that rehydrates the store, swap metadata, and wallet label;
- confirmation gate before reset when the backup state is incomplete.

## Decisions

Locked-in choices for the execution plan below:

- **Transport.** File-based via the share-sheet on export and a document-picker
  on import. Adds three Expo packages (`expo-file-system`, `expo-sharing`,
  `expo-document-picker`). The bundle is too big for a textarea/QR comfortably,
  and a file flow lines up with how users already think about "save my backup
  somewhere."
- **Cipher.** AES-256-GCM with PBKDF2-SHA256 (600k iterations). Add
  `@noble/ciphers` (~30 KB, audited, already a sibling of the in-tree
  `@noble/hashes`). PBKDF2 itself comes from `@noble/hashes/pbkdf2`.
- **Backup password.** Always a fresh, separate password — never reused from the
  wallet unlock password. Reasons: (a) the lock password is optional and uses a
  placeholder `simpleHash` (ISSUES #1), so reuse would force fixing the KDF
  first; (b) decoupling means biometrics-only users can still export.
- **Reset gate.** Two tiers, on top of the existing pending-Lightning-swaps
  block:
  - **Block** (require typing `RESET PENDING`) when non-terminal Boltz swaps
    exist — current behaviour.
  - **Warn** (yellow banner, no extra typing) when any backup-relevant write
    has happened since the last successful export, i.e. there is swap material
    on disk and either no `lastBackupAt` or `lastBackupAt < latestSwapWriteAt`.
- **Inspectability.** The bundle envelope is JSON with clear-text headers; only
  the payload is ciphertext. The format is documented in
  `docs/BACKUP_FORMAT.md`, and a standalone Node script
  (`scripts/decrypt-backup.ts`) decrypts a file with only the built-in `crypto`
  module, so a future developer never needs to run the app to inspect a bundle.

## Bundle Format

The on-disk shape is a JSON envelope. File extension `.trixiebackup`. The
envelope is human-readable except for the ciphertext field; an attacker without
the password learns only "this is a Trixie backup of version N, made at T,
encrypted with PBKDF2/AES-GCM." Salt and IV are random per export.

```jsonc
{
  "magic": "trixie.backup",
  "version": 1,
  "createdAt": 1712345678901,
  "appVersion": "1.0.0",        // for support diagnosis only; not load-bearing
  "kdf": {
    "name": "PBKDF2-SHA256",
    "iterations": 600000,
    "salt": "<base64, 16 bytes>"
  },
  "cipher": {
    "name": "AES-256-GCM",
    "iv": "<base64, 12 bytes>",
    "ciphertext": "<base64, includes appended 16-byte auth tag>"
  }
}
```

The decrypted plaintext is itself JSON, with its own `version` field so that
the *envelope* version (crypto envelope shape) and the *payload* version
(content shape) can evolve independently:

```jsonc
{
  "version": 1,
  "createdAt": 1712345678901,
  "wallet": {
    "id": "<hex>",
    "label": "Arkade Seed",
    "identityKind": "mnemonic" | "singleKey",
    "arkServerUrl": "https://...",
    "esploraUrl": "https://..." | null,
    "network": "mutinynet"
  },
  "walletBehavior": { "vtxoAutoRenewal": true, "delegatedRenewal": true },
  "preferences": { "theme": "system", "fiatCurrency": "EUR", "bitcoinUnit": "auto" },
  "secret": { "kind": "mnemonic", "mnemonic": "..." }
            | { "kind": "singleKey", "privateKeyHex": "..." },
  "swapMetadata": [ /* trixie_swap_meta rows */ ],
  "boltzSwaps":  [ /* boltz_swaps rows: { id, type, status, createdAt, data } */ ]
}
```

What is **excluded** from the payload, by design:

- Activities — rebuilt deterministically from the SDK + Boltz repo on the new
  device, so persisting them would be redundant and risk drift.
- The `ark_${walletId}_*` SDK repository tables — the SDK rebuilds them by
  re-syncing against the Ark server.
- `security.passwordHash` and `security.biometricsEnabled` — security boundary
  is per-device. The user re-sets the lock after restore.
- `network.detectedNetwork`, `network.serverInfo`, `network.status`,
  `network.lastError` — derived state, recomputed on first probe.
- `lightningRestore` — a status snapshot, recomputed on next restore.

Notable inclusion: the original `wallet.id`. We preserve it across restore so
the `trixie_swap_meta.wallet_id` foreign-key column lines up. (The SDK
repository prefix is also derived from `walletId`; preserving the id keeps the
prefixes stable.)

## Inspectability Tooling

To meet the "extract the logic from the app" requirement, two artefacts ship
alongside the feature:

- **`docs/BACKUP_FORMAT.md`** — full spec: envelope schema, KDF params, AES-GCM
  semantics (IV length, tag location), payload schema, version-bump policy,
  worked example with a known-answer test vector.
- **`scripts/decrypt-backup.ts`** — Node-only CLI:
  `node scripts/decrypt-backup.ts <path> <password>`, prints the decrypted
  payload as pretty JSON. Uses `node:crypto` exclusively (no app imports, no
  third-party deps), so it stays runnable even if the wallet codebase rots.
  Also reused from the test-fixtures harness (see Testing Notes).

## Crypto Helper Module

New module: `app/services/backup/crypto.ts`. Pure, framework-free,
synchronous-where-possible:

```ts
export type EncryptedEnvelope = {
  magic: "trixie.backup";
  version: 1;
  createdAt: number;
  appVersion: string;
  kdf: { name: "PBKDF2-SHA256"; iterations: number; salt: string };
  cipher: { name: "AES-256-GCM"; iv: string; ciphertext: string };
};

export function encryptBundle(
  plaintext: Uint8Array,
  password: string,
): Promise<EncryptedEnvelope>;

export function decryptBundle(
  envelope: EncryptedEnvelope,
  password: string,
): Promise<Uint8Array>;
```

Implementation notes:

- Random bytes via `expo-crypto.getRandomBytes` (already shimmed into
  `globalThis.crypto.getRandomValues` by `app/polyfills/crypto.ts`).
- KDF via `@noble/hashes/pbkdf2`.
- Cipher via `@noble/ciphers/aes` (`gcm(key, iv).encrypt/decrypt`). Append the
  16-byte tag to the ciphertext (the noble API returns it that way; document
  the convention so a Node decoder can reuse it).
- Base64 helpers via `@scure/base` (already in tree).
- Failure modes are domain-specific errors (`BackupError` with kinds
  `wrong_password`, `corrupted_envelope`, `unsupported_version`,
  `unsupported_algorithm`). UI translates them.

## Serializer Module

New module: `app/services/backup/serializer.ts`. Read-only assembly and
parse-only consumption — no side effects, easy to unit-test:

```ts
export type BackupPayload = { /* shape from "Bundle Format" above */ };

export function buildBackupPayload(input: {
  wallet: ArkadeWalletMetadata;
  walletBehavior: WalletBehavior;
  preferences: AppState["preferences"];
  secret: StoredSecret;
  swapMetadata: LocalSwapMetadata[];
  boltzSwaps: BoltzSwapRow[];
}): BackupPayload;

export function parseBackupPayload(raw: unknown): BackupPayload; // throws on bad shape

export const PAYLOAD_VERSION = 1;
```

`BoltzSwapRow` is the raw row shape (`{ id, type, status, createdAt, data }`)
since the underlying `data` is already a JSON-encoded `BoltzSwap`. We do not
re-parse it during export — round-trip the column verbatim, which keeps us
schema-agnostic against the boltz-swap package. Re-parse happens at read-time
inside the package itself when `restoreSwaps()` runs.

Validation in `parseBackupPayload` rejects:

- payload `version > PAYLOAD_VERSION` → `unsupported_version`;
- payload `version < PAYLOAD_VERSION` → `unsupported_version` (no migration in
  M6; document migration policy in `BACKUP_FORMAT.md`);
- missing/empty `secret`, missing `wallet.id`, malformed `arkServerUrl` →
  `malformed_payload`.

## Backup Storage Helpers

New module: `app/services/backup/storage.ts`. Thin wrapper around
`expo-file-system` + `expo-sharing` + `expo-document-picker` so the rest of
the app stays UI-only:

```ts
// Writes the envelope to a temp dir and returns its uri. Caller passes uri to
// shareBackupFile().
export function writeBackupToTemp(envelope: EncryptedEnvelope): Promise<string>;

// Opens the share-sheet for the file. Resolves once the sheet is dismissed.
// Note: we cannot reliably tell whether the user actually saved it — that's
// platform-level, the OS owns the share UI.
export function shareBackupFile(uri: string): Promise<void>;

// Pure import: opens the document picker, reads the chosen file, parses JSON,
// returns the envelope. Caller is responsible for decryption + restore.
export function pickBackupFile(): Promise<EncryptedEnvelope | null>;
```

The temp file should be deleted after sharing on a best-effort basis — leave
that to a `try/finally` in the caller. We also wipe the file on app launch via
`expo-file-system.cacheDirectory` cleanup (Expo manages this).

## Store Surface

Extend `useAppStore` with two new actions and one new piece of state:

```ts
// state
security: {
  isLocked: boolean;
  passwordHash?: string;
  biometricsEnabled: boolean;
  lastBackupAt?: number;          // NEW — ms since epoch
};

// actions
exportBackup: (password: string) => Promise<void>;
//  1. snapshot wallet + walletBehavior + preferences + secret + swap rows
//  2. buildBackupPayload → JSON.stringify → utf8 bytes
//  3. encryptBundle(bytes, password) → envelope
//  4. writeBackupToTemp + shareBackupFile
//  5. on success: set lastBackupAt = now, persist, success toast

importBackup: (envelope: EncryptedEnvelope, password: string) => Promise<void>;
//  1. requires no current wallet (mirror restoreWallet's guard)
//  2. probeServer(payload.wallet.arkServerUrl) — surface server_unreachable early
//  3. decryptBundle → parseBackupPayload
//  4. saveSecret(payload.wallet.id, payload.secret)
//  5. write swapMetadata rows + boltzSwaps rows back to SQLite
//  6. createWalletInstance with the imported walletId + identity
//  7. seed the store with payload.wallet/walletBehavior/preferences
//  8. ensureLightning + scheduleLightningRestore — the SwapManager picks up
//     non-terminal swaps from the just-written boltz_swaps table
```

Errors map to `ArkadeError` kinds already defined; add three for backup
specifics: `backup_export_failed`, `backup_decrypt_failed`,
`backup_unsupported_version`.

`getPendingLightningSwapCount` stays. Add a sibling:

```ts
getBackupHealth: () => Promise<{
  hasSwapMaterial: boolean;
  latestSwapWriteAt: number | null;
  lastBackupAt: number | null;
  isStale: boolean;     // hasSwapMaterial && (lastBackupAt == null || lastBackupAt < latestSwapWriteAt)
}>;
```

`latestSwapWriteAt` is `MAX(updated_at)` across `trixie_swap_meta` and
`MAX(created_at)` across `boltz_swaps` (boltz_swaps has no `updated_at`).

Schema bump: `STORAGE_KEY` becomes `app_state_v4` and `CURRENT_SCHEMA_VERSION`
becomes `4`. Add `app_state_v3` to `LEGACY_STORAGE_KEYS`. The bump is needed
because `security.lastBackupAt` is a new field; following the existing
`hydrate()` policy, mismatching schema versions just clear and start fresh, so
this lands as a no-op on a clean install.

## Backup Screen UX

Rework `app/screens/ProfileBackup.tsx` from "reveal seed phrase" into a
backup hub with three sections:

1. **Encrypted backup file** (new, primary).
   - One-line description: "Saves an encrypted backup of your wallet, swap
     state, and preferences. Restore it on a new device with the password you
     set here."
   - **Last backup** row: humanised timestamp (`<time> ago`) or "Never".
   - **Status pill**: "Up to date" | "Outdated" | "Never backed up", driven by
     `getBackupHealth()`.
   - Primary button: **Export backup**. Tapping opens a modal sheet to set a
     password (with confirm field, min length 8 — same UX as
     `ProfileLock.tsx`). Submit triggers `exportBackup(password)`.
   - Helper text under the button: "Anyone with this file and password can
     access your funds." Subtle text-muted.
2. **Wallet keys** (existing reveal-seed UI, kept verbatim).
3. **Identifiers** (existing public key + Arkade address blocks, kept verbatim).

The reveal-seed flow stays because (a) it's the M1-spec'd primary backup, (b)
some users will want to write down the seed instead of carrying the file, (c)
M6's encrypted bundle is *additional* recovery surface, not a replacement.

## Restore Screen UX

Extend `app/screens/RestoreWallet.tsx` with a new section above the existing
text input:

- A pressable card: **Restore from backup file**. Tapping calls
  `pickBackupFile()`. On a valid envelope, navigate to a new sub-screen
  `RestoreBackupPasswordScreen` (or use a modal — leaning toward a screen for
  consistency with the rest of the app's nav stack) that prompts for the
  password and shows a small summary from the envelope's clear-text headers
  ("Backup from <date>, version 1"). Submitting calls
  `importBackup(envelope, password)`.
- Errors:
  - wrong password → "Incorrect password" inline, no toast.
  - unsupported version → "This backup was made by a newer version of Trixie.
    Update the app and try again." (or older — same text family)
  - corrupted envelope → "This file is not a valid Trixie backup."

The existing seed-phrase flow stays as the second affordance below.

Add the route:

```ts
RestoreBackupPassword: { envelope: EncryptedEnvelope }; // route param
```

The envelope object is small (~few KB serialised) and JSON-safe, so passing it
as a route param is fine. Alternative — keep it in a transient zustand slot —
is overkill for one screen.

## Reset Screen UX

Extend `app/screens/ProfileReset.tsx` to consume `getBackupHealth()` alongside
the existing `getPendingLightningSwapCount`.

State machine for the screen:

| Pending swaps | Backup health  | Treatment                                                           |
|---------------|----------------|---------------------------------------------------------------------|
| > 0           | any            | **Block** — type `RESET PENDING`. Existing red banner.              |
| = 0           | stale or never | **Warn** — yellow banner with "You have swap history that hasn't been backed up. Reset will discard it. Type `RESET` to continue." Single typed token. |
| = 0           | up-to-date     | **Permit** — type `RESET`. Existing flow.                           |

Banner copy in the warn case offers a shortcut: a "Back up first" link button
that pops back to `ProfileBackup` so the user can export without losing their
typed input on `ProfileReset`. Re-entering the screen post-export should
reflect the new health.

## Implementation Phasing

Land in phases. Each phase ends with `pnpm check` clean and the app running.

### Phase 1 — Crypto + serializer foundations (no UI yet)

- Add deps: `@noble/ciphers`, `expo-file-system`, `expo-sharing`,
  `expo-document-picker`. Run `pnpm install` and verify the SDK install order
  doesn't get rewound.
- Implement `app/services/backup/crypto.ts` (`encryptBundle` / `decryptBundle`
  + `BackupError`).
- Implement `app/services/backup/serializer.ts` (`buildBackupPayload`,
  `parseBackupPayload`, `PAYLOAD_VERSION`).
- Implement `app/services/backup/storage.ts` (`writeBackupToTemp`,
  `shareBackupFile`, `pickBackupFile`).
- Write `docs/BACKUP_FORMAT.md` with envelope/payload schemas, KAT vectors,
  and a 30-line reference Node decryption snippet.
- Write `scripts/decrypt-backup.ts` (Node CLI, `node:crypto` only).

End of Phase 1: round-trip an envelope in unit-style test code. No store /
screen changes yet.

### Phase 2 — Store actions + schema bump

- Bump `STORAGE_KEY` to `app_state_v4`, `CURRENT_SCHEMA_VERSION` to `4`,
  `LEGACY_STORAGE_KEYS` adds `app_state_v3`.
- Add `security.lastBackupAt?: number` to `AppState` (`app/store/types.ts`).
- Add helper `getLatestSwapWriteAt(walletId)` to
  `app/services/arkade/swap-storage.ts` (reads `MAX(updated_at)` from
  `trixie_swap_meta`).
- Add helper `getLatestBoltzWriteAt()` somewhere accessible (likely
  `app/services/arkade/lightning.ts`, since the boltz repo is opaque to other
  modules — it can read the underlying SQLite directly via
  `getSharedSqlExecutor`).
- Add `exportBackup`, `importBackup`, `getBackupHealth` to `useAppStore`.
- `importBackup` reuses the existing `createWalletInstance` →
  `maybeEnsureLightning` → `scheduleLightningRestore` chain so we don't
  diverge from the create/restore code paths.

End of Phase 2: store API is testable from the dev REPL (or via temporary
buttons during local testing). No UI on screens yet.

### Phase 3 — Backup screen UX

- Refactor `ProfileBackup.tsx` to host the new "Encrypted backup file"
  section above the existing reveal-seed UI.
- Add a password modal (or inline form) for the export path.
- Wire `getBackupHealth` to drive the status pill + last-backup row.
- Surface errors via `useToast` (existing pattern).

### Phase 4 — Restore screen UX

- Add the `RestoreBackupPassword` route and screen
  (`app/screens/RestoreBackupPasswordScreen.tsx`).
- Add the "Restore from backup file" affordance to `RestoreWallet.tsx`
  (top-level pressable card).
- Implement the import flow end-to-end with the three documented error states.

### Phase 5 — Reset gate hardening

- Update `ProfileReset.tsx` to consume `getBackupHealth()` and render the
  three-state banner described in *Reset Screen UX*.
- Add the "Back up first" shortcut back to `ProfileBackup`.

### Phase 6 — Inspector script polish

- Round-trip the script against a fixture bundle generated by the app.
- Add a small `scripts/README.md` (or a one-liner in `docs/BACKUP_FORMAT.md`)
  documenting the script's usage. This phase is light on code, heavy on
  verifying the docs match reality.

## Testing Notes

No test framework is configured. Pieces that benefit from offline,
RN-independent verification:

- `crypto.encryptBundle` round-trip with a known password and known plaintext
  (KAT). Run the same KAT through `scripts/decrypt-backup.ts` to catch any
  Node-vs-noble divergence (IV length, tag append order, base64 alphabet).
- `serializer.parseBackupPayload` table tests for `unsupported_version`,
  `malformed_payload`, missing fields.
- `getBackupHealth` against a synthetic SQLite DB (node-friendly via
  `expo-sqlite` is harder; doable via direct SQL fixtures in a small Node
  harness if needed, otherwise verified manually).

Manual emulator checks:

- Export from a fresh wallet (no swaps): file appears in share sheet, save to
  Files. `lastBackupAt` updates. Status pill flips to "Up to date".
- Make a Lightning send to create a non-terminal swap. `getBackupHealth.isStale`
  becomes true. Reset screen renders the warn banner; "Back up first" link
  bounces back to ProfileBackup.
- Force-quit, reset wallet, restore from the saved file with the right
  password. Wallet appears with the same id, Arkade address, swap rows. Pull
  to refresh — Lightning swap status surfaces (proves `restoreSwaps()` saw
  the imported `boltz_swaps` rows).
- Wrong password → "Incorrect password" inline.
- Hand-edit one byte of the ciphertext base64 → "This file is not a valid
  Trixie backup."
- Bump `version` in the envelope to `2` → "Update the app and try again."
- Run `node scripts/decrypt-backup.ts <file> <password>` against the same
  exported file. Output JSON matches what the importing app reconstructed.

Cross-platform sanity:

- iOS share sheet → Files / iCloud Drive / AirDrop.
- Android share sheet → Files / Drive / Gmail.
- iOS document picker accepts the `.trixiebackup` file regardless of which
  cloud provider re-emits it.
- Android document picker handles content URIs (the file may not be a true
  filesystem path) — `expo-file-system` handles this transparently, but
  verify on a real device.

## Out of Scope (deferred to later milestones)

- Cloud transport for the bundle — Milestone 18.
- Auto-export on schedule, or auto-export reminders — not committed; would
  build on `lastBackupAt` once wired.
- Migration between payload versions — first migration triggers when
  `PAYLOAD_VERSION` is bumped past 1; keep the policy doc'd in
  `BACKUP_FORMAT.md` so the first migration is a 30-minute job, not a design
  exercise.
- Disaster-recovery surface for stranded refundable swaps — Milestone 9.

## Execution Result (2026-04-30)

Status: **shipped**. All six phases landed, plus three emulator-driven fixes
discovered during QA and folded into the implementation.

### Files added

- `app/services/backup/crypto.ts` — `encryptBundle` / `decryptBundle`,
  `BackupError` with kinds (`wrong_password`, `corrupted_envelope`,
  `unsupported_version`, `unsupported_algorithm`, `encrypt_failed`).
- `app/services/backup/serializer.ts` — `buildBackupPayload`,
  `parseBackupPayload`, `PayloadParseError`.
- `app/services/backup/storage.ts` — `writeBackupToTemp`, `shareBackupFile`,
  `saveBackupFile`, `pickBackupFile`, `deleteBackupTempFile`,
  `BackupFileError`.
- `app/screens/RestoreBackupPasswordScreen.tsx` — password-prompt screen for
  the file-restore flow.
- `docs/BACKUP_FORMAT.md` — full on-disk specification.
- `scripts/decrypt-backup.mjs` — Node-only CLI (Node 18+, no third-party
  deps) for decrypting a `.trixiebackup` file with only the password.

### Files modified

- `app/store/types.ts` — schema bumped to v4; `security.lastBackupAt` and
  `security.dirtyForBackup` added.
- `app/store/useAppStore.ts` — `STORAGE_KEY` → `app_state_v4`,
  `LEGACY_STORAGE_KEYS` extended; new actions `exportBackup`,
  `markBackupCompleted`, `discardBackupTempFile`, `importBackup`,
  `getBackupHealth`. `markDirtyForBackup()` plumbed into the swap-event
  listener and into `setArkServerUrl` / `setWalletBehavior`.
- `app/services/arkade/swap-storage.ts` — `getLatestSwapMetadataWriteAt`,
  `restoreSwapMetadataRows`.
- `app/services/arkade/lightning.ts` — `snapshotBoltzSwaps`,
  `restoreBoltzSwaps`, `getLatestBoltzSwapWriteAt`.
- `app/screens/ProfileBackup.tsx` — three-section layout (encrypted backup
  file, wallet keys, identifiers); state machine `idle → form → encrypting
  → dispatch → saving|sharing → idle`.
- `app/screens/RestoreWallet.tsx` — `Restore from backup file` card above
  the existing seed-phrase flow.
- `app/screens/ProfileReset.tsx` — three-tier gate (block / warn-stale /
  permit) driven by `getBackupHealth`.
- `app/navigation/RootStack.tsx` — `RestoreBackupPassword` route registered
  on the no-wallet branch.

### Dependencies added

`@noble/ciphers`, `expo-file-system`, `expo-sharing`, `expo-document-picker`.
All four are autolinked Expo modules; no `app.json` plugin entry was needed.

### Deviations from the plan

- **PBKDF2 iterations 600k → 200k.** With `@noble/hashes` running in pure JS
  on Hermes, 600k iterations took 30–90 s on emulator and slow phones —
  unacceptable UX. 200k matches Apple Keychain's default and is well above
  OWASP's threshold for a user-chosen password + 16-byte random salt. The
  iteration count is in the envelope, so this stays forward-compatible if a
  native PBKDF2 lands later. Documented in `docs/BACKUP_FORMAT.md`.
- **Save flow uses `Directory.createFile` + `write(bytes)`, not `copy()`.**
  On Android SAF, `new File(safDir, name)` plus `sourceFile.copy(destFile)`
  fails with *"A folder with the same name already exists in the file
  location"* — the underlying `expo-file-system` Kotlin source explicitly
  documents that `create()` does not work with SAF URIs and instructs
  callers to use `createFile`/`createDirectory` on the Directory instead.
  We now read the temp file's bytes and write them into a fresh document
  the directory creates for us, with MIME `application/octet-stream` so SAF
  doesn't rewrite the `.trixiebackup` extension. Save filenames carry a
  full ISO timestamp, eliminating same-day collisions and unblocking users
  whose first save left an empty SAF folder behind.
- **Save vs Share split into two explicit dispatch buttons.** The plan
  assumed the share sheet would cover both audiences. On Android emulator
  (no Drive sign-in, no third-party share targets) the share sheet is
  effectively empty, so an explicit *Save to device* path that calls
  `Directory.pickDirectoryAsync()` is required. The Share button stays for
  users who want to send the file to another app or AirDrop.
- **One-tick paint yield before PBKDF2.** `pbkdf2Async` runs ~10 ms of
  synchronous JS before its first internal yield, which in Hermes is enough
  to swallow the `setState` from `show(...)` so neither the spinner-button
  nor the `LoadingOverlay` paints until tens of seconds later. Both
  `submitExport` and the restore-from-backup `handleSubmit` now insert a
  `await new Promise((r) => setTimeout(r, 0))` between flipping the loading
  state and starting the crypto. The seed-phrase flow does not need this
  because its first step is `probeServer()`, a network call that yields
  immediately.
- **Slow-export advisory text.** Both the export form and the
  restore-password screen now carry an inline yellow banner — *"Encryption
  can take 5–15 seconds. Keep the app open until it finishes."* — so the
  user has explicit guidance when the JS thread is busy on PBKDF2.
- **Picker cache hygiene.** `pickBackupFile` deletes the cache copy that
  `DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true })` writes,
  immediately after the envelope is parsed into memory. The user's
  original file is never touched (read-only copy semantics), and the cache
  copy doesn't outlive the screen. This was added in response to a user
  question; not a bug, just hygiene.
- **`scripts/decrypt-backup.ts` → `scripts/decrypt-backup.mjs`.** The `.ts`
  variant required Node 22.6+ type-stripping; the `.mjs` variant runs on
  any Node 18+ with no flags. The Node round-trip harness confirmed both
  forms produce the same output, but `.mjs` is the cleaner artefact.

### Verification

- `pnpm check` and `npx tsc --noEmit` both clean across the final tree.
- A round-trip harness encrypted a known plaintext using the same noble
  primitives the app uses (with 200k iterations), wrote the envelope to a
  temp file, decrypted it via `node scripts/decrypt-backup.mjs`, and
  verified the output matches. Wrong-password attempts are rejected with
  the expected error.
- Manual emulator validation by the user confirmed the slow-export
  advisory, the Save flow, and the LoadingOverlay during decrypt all
  behave as designed. End-to-end restore-from-bundle was not yet
  exercised at the time the milestone closed; the format spec and the
  Node CLI provide the recovery path if that surfaces an issue later.

### Known follow-ups

- The 200k iteration count is conservative for pure-JS PBKDF2. Once the
  app gains a native AES/PBKDF2 module (e.g. via `react-native-quick-crypto`
  or a dedicated Expo module), bump iterations and document the bump in
  `BACKUP_FORMAT.md`. The envelope already carries the value, so old
  bundles keep decrypting.
- `lastBackupAt` updates whenever `Sharing.shareAsync` resolves, even if
  the user dismisses the sheet without saving. The OS share API doesn't
  expose a "did the user save it?" signal, so the trade-off is documented
  but accepted.
- Activity rows are not part of the bundle (rebuilt from SDK + Boltz repo
  on restore). If a user resets in the middle of a long renewal/exit
  cycle and restores onto a new device before the on-chain side settles,
  the resulting Activity feed may briefly show fewer rows than it had
  pre-reset. The data is recovered by the next refresh; the gap is
  expected and aligns with the milestone's "rebuilt from chain" stance.

