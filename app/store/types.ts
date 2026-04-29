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
  activities: Activity[];
  backup: {
    hasMnemonic: boolean;
    hasPrivateKey: boolean;
  };
  lightningRestore?: LightningRestoreState;
};

export type ServerStatus = "idle" | "connecting" | "online" | "offline";

export type WalletBehavior = {
  vtxoAutoRenewal: boolean;
  delegatedRenewal: boolean;
};

export type ArkadeServerInfo = {
  network: string;
  version: string;
  signerPubkey: string;
  forfeitAddress: string;
  dustSats: number;
  unilateralExitDelaySeconds: number;
  txFeeRate: string;
};

export type AppState = {
  schemaVersion: 3;
  wallet: ArkadeWalletMetadata | null;
  network: {
    arkServerUrl: string;
    detectedNetwork: string | null;
    status: ServerStatus;
    lastError: string | null;
    serverInfo: ArkadeServerInfo | null;
  };
  walletBehavior: WalletBehavior;
  preferences: {
    theme: ThemePref;
    fiatCurrency: FiatCurrency;
    bitcoinUnit: BitcoinUnit;
  };
  security: {
    isLocked: boolean;
    passwordHash?: string;
    biometricsEnabled: boolean;
  };
};
