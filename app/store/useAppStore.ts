import { create } from "zustand";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as LocalAuthentication from "expo-local-authentication";
import { Platform } from "react-native";
import type { AppState, FiatCurrency, ThemePref } from "./types";
import { generateMockWallet } from "./mock";

const STORAGE_KEY = "app_state_v1";

function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return hash.toString(36);
}

const DEFAULT_STATE: AppState = {
  schemaVersion: 1,
  walletContainer: null,
  preferences: {
    theme: "system",
    fiatCurrency: "EUR",
  },
  security: {
    isLocked: false,
    biometricsEnabled: false,
  },
};

type StoreState = AppState & {
  _hydrated: boolean;
  hydrate: () => Promise<void>;
  createWallet: () => Promise<void>;
  lockWallet: () => void;
  unlockWithPassword: (password: string) => boolean;
  unlockWithBiometrics: () => Promise<boolean>;
  resetWallet: () => Promise<void>;
  setTheme: (theme: ThemePref) => void;
  setFiatCurrency: (currency: FiatCurrency) => void;
  setPassword: (password: string) => void;
  toggleBiometrics: (enabled: boolean) => void;
};

async function persist(state: AppState) {
  const data: AppState = {
    schemaVersion: state.schemaVersion,
    walletContainer: state.walletContainer,
    preferences: state.preferences,
    security: state.security,
  };
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

export const useAppStore = create<StoreState>((set, get) => ({
  ...DEFAULT_STATE,
  _hydrated: false,

  hydrate: async () => {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as AppState;
        set({ ...parsed, _hydrated: true });
      } else {
        set({ _hydrated: true });
      }
    } catch {
      set({ _hydrated: true });
    }
  },

  createWallet: async () => {
    const wallet = generateMockWallet();
    const walletContainer = {
      wallets: [wallet],
      activeWalletId: wallet.id,
    };
    set({ walletContainer });
    await persist(get());
  },

  lockWallet: () => {
    set((s) => ({
      security: { ...s.security, isLocked: true },
    }));
    persist(get());
  },

  unlockWithPassword: (password: string) => {
    const { security } = get();
    if (!security.passwordHash) return false;
    if (simpleHash(password) !== security.passwordHash) return false;
    set({ security: { ...security, isLocked: false } });
    persist(get());
    return true;
  },

  unlockWithBiometrics: async () => {
    if (Platform.OS === "web") return false;
    try {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: "Unlock Trixie Wallet",
        fallbackLabel: "Use password",
      });
      if (result.success) {
        const { security } = get();
        set({ security: { ...security, isLocked: false } });
        await persist(get());
        return true;
      }
      return false;
    } catch {
      return false;
    }
  },

  resetWallet: async () => {
    set({ ...DEFAULT_STATE, _hydrated: true });
    await AsyncStorage.removeItem(STORAGE_KEY);
  },

  setTheme: (theme: ThemePref) => {
    set((s) => ({
      preferences: { ...s.preferences, theme },
    }));
    persist(get());
  },

  setFiatCurrency: (currency: FiatCurrency) => {
    set((s) => ({
      preferences: { ...s.preferences, fiatCurrency: currency },
    }));
    persist(get());
  },

  setPassword: (password: string) => {
    set((s) => ({
      security: { ...s.security, passwordHash: simpleHash(password) },
    }));
    persist(get());
  },

  toggleBiometrics: (enabled: boolean) => {
    set((s) => ({
      security: { ...s.security, biometricsEnabled: enabled },
    }));
    persist(get());
  },
}));
