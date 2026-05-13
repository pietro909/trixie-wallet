export type ThemePref = "system" | "light" | "dark";
export type FiatCurrency = "EUR" | "USD" | "GBP";
export type BitcoinUnit = "sats" | "btc" | "auto";

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

export type ArkadeWalletMetadata = {
  id: string;
  type: "arkade";
  label: string;
  identityKind: WalletIdentityKind;
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

export type ArkadeServerInfo = {
  network: string;
  version: string;
  signerPubkey: string;
  forfeitAddress: string;
  dustSats: number;
  unilateralExitDelaySeconds: number;
  txFeeRate: string;
  intentFee: IntentFeeProgramConfig;
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
  schemaVersion: 4;
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
  };
};
