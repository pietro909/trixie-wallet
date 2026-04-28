export type ThemePref = "system" | "light" | "dark";
export type FiatCurrency = "EUR" | "USD" | "GBP";

export type Transaction = {
  id: string;
  direction: "in" | "out";
  amountSats: number;
  timestamp: number;
  counterpartyLabel: string;
  status: "pending" | "confirmed";
};

export type WalletIdentityKind = "mnemonic" | "singleKey";

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
  transactions: Transaction[];
  backup: {
    hasMnemonic: boolean;
    hasPrivateKey: boolean;
  };
};

export type ServerStatus = "idle" | "connecting" | "online" | "offline";

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
  schemaVersion: 2;
  wallet: ArkadeWalletMetadata | null;
  network: {
    arkServerUrl: string;
    detectedNetwork: string | null;
    status: ServerStatus;
    lastError: string | null;
    serverInfo: ArkadeServerInfo | null;
  };
  preferences: {
    theme: ThemePref;
    fiatCurrency: FiatCurrency;
  };
  security: {
    isLocked: boolean;
    passwordHash?: string;
    biometricsEnabled: boolean;
  };
};
