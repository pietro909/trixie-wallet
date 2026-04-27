export type ThemePref = "system" | "light" | "dark";
export type FiatCurrency = "EUR" | "USD" | "GBP";

export type Transaction = {
  id: string;
  direction: "in" | "out";
  amountSats: number;
  timestamp: number; // unix ms
  counterpartyLabel: string;
  status: "pending" | "confirmed";
};

export type Wallet = {
  id: string;
  type: "arkade" | "onchain" | "lightning";
  label: string;
  balanceSats: number;
  transactions: Transaction[];
  backup: {
    privateKeyHex: string;
    privateKeyNsec?: string;
    mnemonic?: string;
  };
};

export type WalletContainer = {
  wallets: Wallet[];
  activeWalletId: string;
};

export type AppState = {
  schemaVersion: 1;
  walletContainer: WalletContainer | null;
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
