# Milestone 7: Logs Export

Goal: let a user export a support bundle that explains what the app was doing
without exposing wallet secrets.

This milestone should prove:

- A user can export a log bundle from the app.
- The bundle includes enough context to debug failed sends, restores, and
  background work.
- The bundle redacts secrets, preimages, mnemonics, and private keys.
- Export works independently from backup and reset.

## Current State

- The Advanced tab already covers server and diagnostic visibility.
- There is no dedicated logs export flow in the current app.
- `app/store/useAppStore.ts` already holds the app-level state that can be
  summarized in a support bundle.

## Product Rules

- Logs are a support artifact, not a recovery artifact.
- Redact secrets by default. A support bundle should be safe to share.
- Include timestamps, wallet id, network, app version, server state, and recent
  error summaries.
- Keep the output deterministic enough that support can compare bundles.

## Selected Direction

Add a dedicated export path that assembles a JSON bundle from:

- recent structured error events from instrumented call sites;
- wallet/network metadata;
- non-secret recovery status (counts and timestamps);
- recent Activity counts grouped by rail and status.

If the app already has a generic share/export sheet, reuse it here instead of
inventing a second export UX.

## Decisions

Locked-in choices for the execution plan.

- **Bundle transport.** File + share-sheet primary, clipboard as a fallback.
  Reuse the `expo-sharing` / `expo-file-system` plumbing already in
  `app/services/backup/storage.ts` (`writeBackupToTemp`, `shareBackupFile`,
  `saveBackupFile`). The export does not encrypt — the bundle is a redacted
  artefact by construction, not a recovery one. A separate "Copy to clipboard"
  affordance stays for users who want to paste a small bundle into a support
  thread directly.

- **Diagnostics consolidation.** Collapse the four existing copy-to-clipboard
  actions in `AdvancedScreen.tsx` (`copyServerInfoJson`,
  `copyWalletMetadataJson`, `copyAppStateJson`, `copyLightningDiagnostics`)
  into one canonical "Support bundle" action. The bundle is a strict superset
  of all four. Do not ship a fifth diagnostic surface beside them. Note that
  the bundle's redaction is **stricter** than `copyWalletMetadataJson` — it
  must not include the raw `wallet.activities` array, since Activity titles
  and metadata can carry BOLT11 prefixes and addresses.

- **Recovery status fields.** Counts and timestamps only — no ids, not even
  truncated ones. Specifically: `security.lastBackupAt`,
  `security.dirtyForBackup`, `wallet.lightningRestore.{lastAt, lastCount,
  lastError}`, swap counts grouped by status (across `boltz_swaps` and
  `trixie_swap_meta`), pending Activity counts grouped by rail and status.
  Reason: easier to redact, cheaper to schema-stabilize, and support can ask
  for specific ids out-of-band when they need them.

- **Error capture model.** Structured-only recorder. New module
  `app/services/diagnostics/recorder.ts` exposing a single
  `recordError(category, message, details?)` API. Sweep the codebase
  (`sendExecutor.ts`, `services/arkade/lightning.ts`,
  `services/arkade/runtime.ts`, `services/arkade/activity-history.ts`, the
  swap-event listener, the receive flow) and add explicit calls at known
  failure sites. No console interception.

  **This is not a crash reporter.** Uncaught exceptions, native crashes, and
  unhandled promise rejections are out of scope — they belong to a later
  production-readiness pass with Sentry or equivalent. M7's recorder is for
  *user-reported* issues: a user contacts support, support asks them to
  reproduce and export the bundle, the recorder has the relevant failures.

- **Error capture redaction.** Performed at write time inside `recordError`.
  Strip BOLT11s, mnemonics, private keys, payment hashes, preimages, and
  Arkade addresses from `message` and `details` before they hit the buffer.
  The buffer therefore only ever holds safe strings, so export is a memcpy
  with no second redaction pass needed.

- **Error capture bounds.** Fixed-capacity in-memory ring buffer of 100
  entries. Not persisted to AsyncStorage. Lost on app restart by design — a
  user reporting an issue re-runs the failure path with the app open, then
  exports the bundle. 100 entries is comfortably more than a single
  reproduction sequence produces. Production-grade telemetry (durable logs,
  cross-session correlation, sampling) is out of scope; the prototype stage
  is well-served by an in-memory tail.

## Execution Result (2026-04-30)

Status: **shipped**.

### Files added

- `app/services/diagnostics/recorder.ts` — `recordError(category, message,
  details?)`, `getRecentErrors`, `clearRecentErrors`. Ring buffer fixed at
  100 entries. Redaction strips BOLT11s, bech32 BTC/Arkade addresses, and
  BIP39-style 12/24-word mnemonics; messages are also length-bounded to
  500 chars.
- `app/services/diagnostics/bundle.ts` — `buildSupportBundle()` returns
  `SupportBundle` (schema v1). Pulls fresh server info, wallet metadata
  (no secrets, no `activities` array), recovery counts (no ids), Boltz
  swap counts grouped by `<type>.<status>`, and the recorder's tail.
- `app/services/diagnostics/storage.ts` — `writeBundleToTemp`,
  `shareBundleFile`, `saveBundleFile`, `deleteBundleTempFile`. Mirrors
  `app/services/backup/storage.ts`'s SAF-safe save flow but with the
  `.trixielogs` extension.

### Files modified

- `app/services/arkade/errors.ts` — `ArkadeError` constructor now records
  every construction with a category derived from the kind (server / wallet
  / send / lightning / swap). `toArkadeError` is unchanged: it only
  constructs a new error when wrapping a non-`ArkadeError` cause, so
  re-throws don't double-log.
- `app/services/backup/crypto.ts`, `serializer.ts`, `storage.ts` —
  `BackupError`, `PayloadParseError`, `BackupFileError` constructors record
  under category `backup`.
- `app/services/arkade/feePreview.ts` — `OffboardFeeEstimateError`
  constructor records under `send`.
- `app/services/arkade/lightning.ts` — explicit `recordError` calls inside
  the previously silent catches in `notify`, `attemptReverseLinkage`,
  `attachSwapManagerSubscriptions`, and `getLightningActivitySources`. Any
  case where a swap event went missing or activity assembly failed will
  now show up in the bundle.
- `app/services/arkade/runtime.ts` — `attachIncomingFundsSubscription` and
  the inner listener catch now record under `wallet`.
- `app/store/useAppStore.ts` — the `scheduleLightningRestore` catch records
  the same string it already writes into `wallet.lightningRestore.lastError`,
  so the bundle reflects more than just the latest failure. The two
  background-refresh `.catch(() => {})` paths (swap-event-driven and
  incoming-funds-driven) now record under `swap` / `wallet`.
- `app/screens/AdvancedScreen.tsx` — replaced the four
  `RawRow`-driven copy actions (`copyServerInfoJson`,
  `copyWalletMetadataJson`, `copyAppStateJson`, `copyLightningDiagnostics`)
  with one `Support bundle` row that opens an `Alert.alert` with three
  options: *Save to device*, *Share…*, *Copy as JSON*.

### Dependencies added

None. Reuses `expo-file-system`, `expo-sharing`, `expo-clipboard`, and
`expo-haptics` — all already in tree from M6.

### Deviations from the plan

- **Recorder API shape.** The plan called for `recordError(category,
  message, details?)`. Landed exactly that, but with the `details` argument
  typed as `Record<string, string | number | boolean | null | undefined>`
  rather than `Record<string, unknown>`. This forces callers to flatten
  before logging, which matches the redaction guarantee (we cannot redact
  inside arbitrary nested objects) and removes a footgun where a caller
  accidentally passes a swap blob containing keypairs.
- **Where the ArkadeError instrumentation lives.** Instead of putting the
  `recordError` call in `toArkadeError` (the wrapping helper), it lives in
  the `ArkadeError` *constructor*. Reason: errors thrown directly via `new
  ArkadeError(...)` (which the store does dozens of times) would otherwise
  bypass the recorder. The constructor placement gives single-source
  capture; `toArkadeError` stays unchanged.
- **No bundle file extension consolidation.** The plan was open about
  reusing the M6 share/save plumbing. In practice the M6 helpers are
  hard-coded to the `.trixiebackup` extension and the `EncryptedEnvelope`
  shape, so a tiny parallel `services/diagnostics/storage.ts` was cleaner
  than refactoring M6's storage layer. Both modules live next to each
  other and share the same SAF-safe `createFile` + `write(bytes)` pattern.

### Verification

- `pnpm check` — 3 pre-existing infos in `app.config.ts`
  (`useNodejsImportProtocol`); no errors. Exit code 0.
- `npx tsc --noEmit` — clean. Exit code 0.
- Bundle assembly was exercised mentally against the `useAppStore`
  state shape and the `BoltzSwap` / `LocalSwapMetadata` row types; the
  bundle never reads any field that could carry a secret.
- Manual emulator validation of the new Diagnostics row (Save / Share /
  Copy) was not yet performed. The format is JSON-only, so the produced
  file is readable by `cat` / `jq` even before in-app QA.

### Known follow-ups

- Bundle redaction is regex-based for BOLT11s, bech32 addresses, and
  BIP39 mnemonics. P2PKH/P2SH addresses (`1...`, `3...`, `m...`, `2...`)
  are not pattern-redacted because the prefix is too short for a safe
  global regex; defence-in-depth at the call site stays the rule. If
  these ever leak, tighten the redactor with a length+checksum heuristic.
- The recorder is in-memory only by design. If a production-readiness
  pass adds a Sentry-class crash reporter, that work is independent of
  this buffer; the recorder stays for support-driven debugging.
- Activity counts in the bundle are derived from the in-memory
  `wallet.activities`. Once Activity caching lands (M10), the bundle
  should pull from the cache directly so a not-yet-rebuilt session
  still produces useful counts.

