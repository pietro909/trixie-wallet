export type ThemePref = "system" | "light" | "dark";
export type FiatCurrency = "EUR" | "USD" | "GBP";
export type BitcoinUnit = "sats" | "btc" | "auto";

/**
 * Coarse stages of `refreshWallet`'s inner sequence. Each value names a phase
 * the store can actually distinguish from the others — no fake granularity.
 * Surfaced through {@link SyncState} so the Wallet and Activity screens can
 * tell the user roughly what the cold-start refresh is doing.
 */
export type SyncStage =
  | "snapshot" // refreshWalletSnapshot — VTXOs, balances, and history
  | "lightning" // maybeEnsureLightning — opening Lightning subsystems
  | "activities" // buildActivities — local merge of activity sources
  | "notify"; // diffAndNotifyActivities — emitting notifications

/**
 * Store-readable signal for "is the wallet refresh running, and at which
 * stage". Lifecycle metadata only — never persisted (same treatment as
 * `_hydrated`). `startedAt` is captured once when a syncing session begins and
 * stays stable across the re-entrant refresh loop.
 */
export type SyncState =
  | { kind: "idle" }
  | { kind: "syncing"; stage: SyncStage; startedAt: number };

export type ActivityDirection = "in" | "out" | "self" | "none";
export type ActivityStatus =
  | "pending"
  | "confirmed"
  | "failed"
  | "refunded"
  | "info";
export type ActivityRail = "arkade" | "bitcoin" | "lightning";
export type ActivityKind = "payment" | "lightning_swap" | "wallet_event";

export type ActivitySource =
  | { type: "arkade_tx"; walletTxId: string }
  | {
      type: "boltz_swap";
      provider: "boltz";
      swapId: string;
      swapType: "reverse" | "submarine" | "chain";
    }
  | { type: "wallet_event"; eventId: string };

/**
 * Per-asset delta carried on asset-bearing Activity rows. Amounts are
 * serialized as strings to keep the row JSON-safe (BigInt does not survive
 * `JSON.stringify` round-trips). Reconstruct with `BigInt(amount)` in the
 * renderer.
 */
export type ActivityAsset = {
  assetId: string;
  amount: string;
};

export type Activity = {
  id: string;
  kind: ActivityKind;
  direction?: ActivityDirection;
  amountSats?: number;
  timestamp: number;
  title: string;
  subtitle?: string;
  status: ActivityStatus;
  rail?: ActivityRail;
  source: ActivitySource;
  metadata?: Record<string, string | number | boolean | null>;
  /**
   * Net per-asset deltas observed in this transaction (positive=received,
   * negative=sent). Populated for asset-bearing rows; missing on BTC-only
   * rows.
   */
  assets?: ActivityAsset[];
};

export type WalletIdentityKind = "mnemonic" | "singleKey";

export type LightningRestoreState = {
  /** ms-since-epoch of the last `restoreSwaps()` call. */
  lastAt: number;
  /** Total swaps reported by the last restore call (across all types). */
  lastCount: number;
  /** Last restore error message, if any. */
  lastError?: string;
};

export type LightningResumeTrigger = "startup" | "unlock" | "foreground";

export type LightningResumeState = {
  /** ms-since-epoch when the last resume pass started. */
  lastAt: number;
  /** ms-since-epoch when the last resume pass finished. */
  lastFinishedAt: number;
  /** Lifecycle event that started the pass. */
  trigger: LightningResumeTrigger;
  status: "success" | "partial" | "failed";
  restoredCount: number;
  reverseCount: number;
  submarineCount: number;
  chainCount: number;
  polledCount: number;
  updatedCount: number;
  claimedCount: number;
  refundedCount: number;
  errorCount: number;
  nonTerminalCount: number;
  lastError?: string;
};

/**
 * Asset balance entry persisted alongside wallet metadata. `amount` is a
 * stringified bigint for JSON safety (mirrors {@link ActivityAsset.amount}).
 */
export type AssetBalanceEntry = {
  assetId: string;
  amount: string;
};

export type RestoreStage = "initializing" | "scanning" | "syncing";

/**
 * Transient signal for the multi-stage restoration process (mnemonic only).
 * Carried in the Zustand store but NOT persisted in AppState.
 */
export type RestoreProgress =
  | { status: "idle" }
  | {
      status: "restoring";
      walletMode: "static" | "hd";
      stage: RestoreStage;
      startedAt: number;
    };

export type ArkadeWalletMetadata = {
  id: string;
  type: "arkade";
  label: string;
  identityKind: WalletIdentityKind;
  walletMode: "static" | "hd";
  publicKeyHex: string;
  arkServerUrl: string;
  esploraUrl?: string;
  network: string;
  arkAddress: string;
  boardingAddress: string;
  balanceSats: number;
  balanceTotalSats: number;
  balanceBoardingSats: number;
  /**
   * Latest per-asset balances observed in `wallet.getBalance()`. Sorted by
   * amount desc, then by assetId for stable ordering. Empty array when the
   * wallet holds no assets.
   */
  assetBalances: AssetBalanceEntry[];
  activities: Activity[];
  backup: {
    hasMnemonic: boolean;
    hasPrivateKey: boolean;
  };
  lightningRestore?: LightningRestoreState;
  lightningResume?: LightningResumeState;
};

export type ServerStatus = "idle" | "connecting" | "online" | "offline";

export type WalletBehavior = {
  vtxoAutoRenewal: boolean;
  delegatedRenewal: boolean;
};

/**
 * User-controllable enables for the app's OS-scheduled background tasks.
 * Kept as its own `AppState` slice rather than nested under `WalletBehavior`
 * because the scheduler toggle must not trigger the wallet-restart /
 * backup-dirty side effects that `setWalletBehavior` carries, and because the
 * backup serializer intentionally does not carry device-local scheduler prefs.
 */
export type BackgroundTasks = {
  /** OS-scheduled Boltz swap-poll (`trixie-boltz-swap-poll`). */
  swapPoll: boolean;
};

export type BackgroundTaskKey = keyof BackgroundTasks;

export type IntentFeeProgramConfig = {
  offchainInput?: string;
  onchainInput?: string;
  offchainOutput?: string;
  onchainOutput?: string;
};

/**
 * A server-advertised deprecated signer, persisted alongside
 * {@link ArkadeServerInfo}. `cutoffDateSeconds` is the SDK's `cutoffDate`
 * (a Unix-seconds `bigint`) serialized as a decimal string so it survives
 * `JSON.stringify`/AsyncStorage round-trips. `"0"` is the SDK sentinel for
 * "no cutoff advertised / due now".
 */
export type PersistedDeprecatedSigner = {
  pubkey: string;
  cutoffDateSeconds: string;
};

export type ArkadeServerInfo = {
  network: string;
  version: string;
  signerPubkey: string;
  forfeitAddress: string;
  dustSats: number;
  unilateralExitDelaySeconds: number;
  txFeeRate: string;
  intentFee: IntentFeeProgramConfig;
  /**
   * Full set of signer keys the server currently advertises as deprecated.
   * Empty when no rotation is in progress. Persisted so the round-trip keeps
   * the advertised cutoff set; user-facing rotation status is always derived
   * fresh from the SDK VTXO manager, never from this list.
   */
  deprecatedSigners: PersistedDeprecatedSigner[];
};

/**
 * Product-level severity for a deprecated server signer. Mirrors the SDK's
 * `SignerStatus` literal union (UPPERCASE) but is declared locally so store
 * types do not depend on the SDK type surface.
 */
export type SignerRotationSeverity =
  | "CURRENT"
  | "MIGRATABLE"
  | "DUE_NOW"
  | "EXPIRED"
  | "UNKNOWN_SIGNER";

/**
 * Per-signer rotation status, derived from the SDK
 * `getDeprecatedSignerStatus()` report. `bigint` cutoff fields are stringified
 * for JSON safety. Transient — never persisted.
 */
export type SignerRotationReport = {
  signerPubKey: string;
  status: SignerRotationSeverity;
  /** Whether cooperative migration applies, via SDK `isCooperativelyMigratable`. */
  canMigrate: boolean;
  /** Absolute cutoff (Unix seconds) as a decimal string, when advertised. */
  cutoffDateSeconds?: string;
  /** Derived seconds until cutoff; negative once passed. */
  secondsUntilCutoff?: number;
  vtxoCount: number;
  totalValue: number;
  boardingCount: number;
  boardingValue: number;
  recoverableCount: number;
  recoverableValue: number;
  awaitingSweepCount: number;
  awaitingSweepValue: number;
  /** Soonest batch-sweep ETA (ms since epoch) among awaiting-sweep VTXOs. */
  nextSweepEta?: number;
};

/**
 * Aggregated signer-rotation status surfaced to the UI. Transient store state
 * (lives in `StoreState`, never persisted). `null` means no actionable
 * deprecated-signer exposure.
 */
export type SignerRotationStatus = {
  worstStatus: SignerRotationSeverity;
  hasMigratableFunds: boolean;
  reports: SignerRotationReport[];
};

/**
 * Asset-tracking slice persisted in `AppState`. Kept separate from
 * {@link ArkadeWalletMetadata} so the wallet envelope stays focused on
 * identity / balance state and so a future multi-wallet rework can scope
 * the slice without entangling backup serialization. `importedAssetIds`
 * carries user-curated asset ids (mint targets, pasted ids) that should
 * survive a sweep to zero balance and ride the v2 backup payload.
 */
export type AssetsSlice = {
  importedAssetIds: string[];
};

export type NotificationPreferences = {
  enabled: boolean;
  swaps: boolean;
  payments: boolean;
};

export type AppState = {
  schemaVersion: 8;
  wallet: ArkadeWalletMetadata | null;
  network: {
    arkServerUrl: string;
    detectedNetwork: string | null;
    status: ServerStatus;
    lastError: string | null;
    serverInfo: ArkadeServerInfo | null;
  };
  walletBehavior: WalletBehavior;
  backgroundTasks: BackgroundTasks;
  assets: AssetsSlice;
  preferences: {
    theme: ThemePref;
    fiatCurrency: FiatCurrency;
    bitcoinUnit: BitcoinUnit;
    notifications: NotificationPreferences;
  };
  security: {
    isLocked: boolean;
    passwordHash?: string;
    passwordSalt?: string;
    biometricsEnabled: boolean;
    /**
     * Timestamp (ms since epoch) of the last successful encrypted-backup
     * export. Drives the "needs backup" warning on Reset.
     */
    lastBackupAt?: number;
    /**
     * Sticky flag: set whenever any backup-relevant state mutates (swap
     * events, behavior changes, server URL changes). Cleared on a successful
     * export. Combined with `lastBackupAt` to compute backup health without
     * needing wall-clock comparisons against opaque SQLite tables.
     */
    dirtyForBackup?: boolean;
    /**
     * Timestamp (ms since epoch) of the most recent contract label write
     * (set or clear). Contract labels live in the SDK `ContractManager`, so
     * `getBackupHealth` can't read them directly without warming the wallet
     * runtime — this timestamp is the cheap proxy that tells the Backup
     * screen "this wallet has labels worth backing up." Set on every label
     * write (including clears, mirroring `getLatestSwapMetadataWriteAt`) and
     * restored from the envelope's `createdAt` on import.
     */
    latestContractLabelWriteAt?: number | null;
  };
};
