import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Crypto from "expo-crypto";
import * as LocalAuthentication from "expo-local-authentication";
import { create } from "zustand";
import { ArkadeError, toArkadeError } from "../services/arkade/errors";
import {
  buildMnemonicIdentity,
  buildRandomSingleKeyIdentity,
  buildSingleKeyIdentityFromHex,
  bytesToHex,
  createMnemonic,
  type IdentityArtifacts,
} from "../services/arkade/identity";
import {
  DEFAULT_ARK_SERVER_URL,
  isMainnetForNetworkName,
  normalizeServerUrl,
} from "../services/arkade/network";
import {
  clearAllWalletData,
  createWalletInstance,
  disposeWallet,
  ensureWallet,
  probeServer,
  refreshWalletSnapshot,
  snapshotWallet,
  type WalletSnapshot,
} from "../services/arkade/runtime";
import { deleteSecret, saveSecret } from "../services/arkade/secret-store";
import type {
  AppState,
  ArkadeWalletMetadata,
  BitcoinUnit,
  FiatCurrency,
  ThemePref,
  WalletBehavior,
} from "./types";

const STORAGE_KEY = "app_state_v2";
const LEGACY_STORAGE_KEY = "app_state_v1";

function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return hash.toString(36);
}

function newWalletId(): string {
  const bytes = Crypto.getRandomBytes(16);
  return bytesToHex(bytes);
}

const DEFAULT_WALLET_BEHAVIOR: WalletBehavior = {
  vtxoAutoRenewal: false,
  delegatedRenewal: false,
};

function normalizeWalletBehavior(
  behavior: Partial<WalletBehavior> | null | undefined,
): WalletBehavior {
  const delegatedRenewal = behavior?.delegatedRenewal === true;
  return {
    vtxoAutoRenewal: behavior?.vtxoAutoRenewal === true || delegatedRenewal,
    delegatedRenewal,
  };
}

const DEFAULT_STATE: AppState = {
  schemaVersion: 2,
  wallet: null,
  network: {
    arkServerUrl: DEFAULT_ARK_SERVER_URL,
    detectedNetwork: null,
    status: "idle",
    lastError: null,
    serverInfo: null,
  },
  walletBehavior: DEFAULT_WALLET_BEHAVIOR,
  preferences: {
    theme: "system",
    fiatCurrency: "EUR",
    bitcoinUnit: "auto",
  },
  security: {
    isLocked: false,
    biometricsEnabled: false,
  },
};

export type CreateWalletKind = "mnemonic" | "singleKey";

export type RestoreInput =
  | { kind: "mnemonic"; mnemonic: string }
  | { kind: "hex"; privateKeyHex: string };

type StoreState = AppState & {
  _hydrated: boolean;
  hydrate: () => Promise<void>;
  refreshServer: () => Promise<void>;
  setArkServerUrl: (url: string) => Promise<void>;
  createWallet: (kind: CreateWalletKind) => Promise<void>;
  restoreWallet: (input: RestoreInput) => Promise<void>;
  refreshWallet: () => Promise<void>;
  sendArkade: (address: string, amountSats: number) => Promise<string>;
  setWalletBehavior: (behavior: Partial<WalletBehavior>) => Promise<void>;
  lockWallet: () => Promise<void>;
  unlockWithPassword: (password: string) => Promise<boolean>;
  unlockWithBiometrics: () => Promise<boolean>;
  resetWallet: () => Promise<void>;
  setTheme: (theme: ThemePref) => void;
  setFiatCurrency: (currency: FiatCurrency) => void;
  setBitcoinUnit: (unit: BitcoinUnit) => void;
  setPassword: (password: string) => void;
  toggleBiometrics: (enabled: boolean) => void;
};

async function persist(state: AppState) {
  const data: AppState = {
    schemaVersion: 2,
    wallet: state.wallet,
    network: state.network,
    walletBehavior: state.walletBehavior,
    preferences: state.preferences,
    security: state.security,
  };
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function buildMetadata(
  walletId: string,
  arkServerUrl: string,
  esploraUrl: string | undefined,
  network: string,
  artifacts: IdentityArtifacts,
  snapshot: WalletSnapshot,
): ArkadeWalletMetadata {
  return {
    id: walletId,
    type: "arkade",
    label: artifacts.identityKind === "mnemonic" ? "Arkade Seed" : "Arkade Key",
    identityKind: artifacts.identityKind,
    publicKeyHex: snapshot.publicKeyHex,
    arkServerUrl,
    esploraUrl,
    network,
    arkAddress: snapshot.arkAddress,
    boardingAddress: snapshot.boardingAddress,
    balanceSats: snapshot.balance.available,
    balanceTotalSats: snapshot.balance.total,
    balanceBoardingSats: snapshot.balance.boardingTotal,
    transactions: snapshot.transactions,
    backup: {
      hasMnemonic: artifacts.identityKind === "mnemonic",
      hasPrivateKey: artifacts.identityKind === "singleKey",
    },
  };
}

function applySnapshot(
  metadata: ArkadeWalletMetadata,
  snapshot: WalletSnapshot,
): ArkadeWalletMetadata {
  return {
    ...metadata,
    arkAddress: snapshot.arkAddress,
    boardingAddress: snapshot.boardingAddress,
    balanceSats: snapshot.balance.available,
    balanceTotalSats: snapshot.balance.total,
    balanceBoardingSats: snapshot.balance.boardingTotal,
    transactions: snapshot.transactions,
  };
}

export const useAppStore = create<StoreState>((set, get) => ({
  ...DEFAULT_STATE,
  _hydrated: false,

  hydrate: async () => {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<AppState>;
        set({
          ...DEFAULT_STATE,
          ...parsed,
          schemaVersion: 2,
          network: { ...DEFAULT_STATE.network, ...(parsed.network ?? {}) },
          preferences: {
            ...DEFAULT_STATE.preferences,
            ...(parsed.preferences ?? {}),
          },
          security: {
            ...DEFAULT_STATE.security,
            ...(parsed.security ?? {}),
          },
          walletBehavior: normalizeWalletBehavior(parsed.walletBehavior),
          wallet: parsed.wallet ?? null,
          _hydrated: true,
        });
      } else {
        // Drop any legacy v1 mock state — its mock secrets cannot be migrated.
        await AsyncStorage.removeItem(LEGACY_STORAGE_KEY);
        set({ _hydrated: true });
      }
    } catch {
      set({ _hydrated: true });
    }
  },

  refreshServer: async () => {
    const url = get().network.arkServerUrl;
    set((s) => ({
      network: { ...s.network, status: "connecting", lastError: null },
    }));
    try {
      const info = await probeServer(url);
      set((s) => ({
        network: {
          ...s.network,
          status: "online",
          detectedNetwork: info.network,
          lastError: null,
          serverInfo: info,
        },
      }));
      await persist(get());
    } catch (e) {
      const message =
        e instanceof Error ? e.message : "Could not reach Arkade server";
      set((s) => ({
        network: {
          ...s.network,
          status: "offline",
          lastError: message,
        },
      }));
      await persist(get());
    }
  },

  setArkServerUrl: async (url) => {
    const normalized = normalizeServerUrl(url);
    if (!normalized) return;
    set((s) => ({
      network: {
        ...s.network,
        arkServerUrl: normalized,
        status: "idle",
        detectedNetwork: null,
        lastError: null,
        serverInfo: null,
      },
    }));
    await persist(get());
  },

  createWallet: async (kind) => {
    if (get().wallet) {
      throw new ArkadeError(
        "wallet_init_failed",
        "A wallet already exists. Reset before creating a new one.",
      );
    }
    const arkServerUrl = get().network.arkServerUrl;
    set((s) => ({
      network: { ...s.network, status: "connecting", lastError: null },
    }));
    let probed: Awaited<ReturnType<typeof probeServer>>;
    try {
      probed = await probeServer(arkServerUrl);
    } catch (e) {
      const err = toArkadeError(
        "server_unreachable",
        "Could not reach Arkade server",
        e,
      );
      set((s) => ({
        network: {
          ...s.network,
          status: "offline",
          lastError: err.message,
        },
      }));
      throw err;
    }
    const serverNetwork = probed.network;
    const isMainnet = isMainnetForNetworkName(serverNetwork);
    const artifacts =
      kind === "mnemonic"
        ? buildMnemonicIdentity(createMnemonic(), isMainnet)
        : buildRandomSingleKeyIdentity();
    const walletId = newWalletId();
    try {
      await saveSecret(walletId, artifacts.secret);
      const { snapshot } = await createWalletInstance({
        walletId,
        artifacts,
        arkServerUrl,
        network: serverNetwork,
        behavior: get().walletBehavior,
      });
      const metadata = buildMetadata(
        walletId,
        arkServerUrl,
        undefined,
        serverNetwork,
        artifacts,
        snapshot,
      );
      set((s) => ({
        wallet: metadata,
        network: {
          ...s.network,
          status: "online",
          detectedNetwork: serverNetwork,
          lastError: null,
          serverInfo: probed,
        },
      }));
      await persist(get());
    } catch (e) {
      await deleteSecret(walletId);
      await disposeWallet();
      throw toArkadeError("wallet_init_failed", "Failed to create wallet", e);
    }
  },

  restoreWallet: async (input) => {
    if (get().wallet) {
      throw new ArkadeError(
        "wallet_init_failed",
        "A wallet already exists. Reset before restoring.",
      );
    }
    const arkServerUrl = get().network.arkServerUrl;
    set((s) => ({
      network: { ...s.network, status: "connecting", lastError: null },
    }));
    let probed: Awaited<ReturnType<typeof probeServer>>;
    try {
      probed = await probeServer(arkServerUrl);
    } catch (e) {
      const err = toArkadeError(
        "server_unreachable",
        "Could not reach Arkade server",
        e,
      );
      set((s) => ({
        network: {
          ...s.network,
          status: "offline",
          lastError: err.message,
        },
      }));
      throw err;
    }
    const serverNetwork = probed.network;
    const isMainnet = isMainnetForNetworkName(serverNetwork);
    const artifacts =
      input.kind === "mnemonic"
        ? buildMnemonicIdentity(input.mnemonic, isMainnet)
        : buildSingleKeyIdentityFromHex(input.privateKeyHex);
    const walletId = newWalletId();
    try {
      await saveSecret(walletId, artifacts.secret);
      const { snapshot } = await createWalletInstance({
        walletId,
        artifacts,
        arkServerUrl,
        network: serverNetwork,
        behavior: get().walletBehavior,
      });
      const metadata = buildMetadata(
        walletId,
        arkServerUrl,
        undefined,
        serverNetwork,
        artifacts,
        snapshot,
      );
      set((s) => ({
        wallet: metadata,
        network: {
          ...s.network,
          status: "online",
          detectedNetwork: serverNetwork,
          lastError: null,
          serverInfo: probed,
        },
      }));
      await persist(get());
    } catch (e) {
      await deleteSecret(walletId);
      await disposeWallet();
      throw toArkadeError("wallet_init_failed", "Failed to restore wallet", e);
    }
  },

  refreshWallet: async () => {
    const metadata = get().wallet;
    if (!metadata) return;
    const snapshot = await refreshWalletSnapshot(
      metadata,
      get().walletBehavior,
    );
    set({ wallet: applySnapshot(metadata, snapshot) });
    await persist(get());
  },

  sendArkade: async (address, amountSats) => {
    const metadata = get().wallet;
    if (!metadata) {
      throw new ArkadeError("wallet_not_ready", "No wallet available");
    }
    if (amountSats <= 0) {
      throw new ArkadeError("send_failed", "Amount must be greater than zero");
    }
    if (amountSats > metadata.balanceSats) {
      throw new ArkadeError(
        "insufficient_balance",
        "Insufficient balance for this amount",
      );
    }
    const wallet = await ensureWallet({
      metadata,
      behavior: get().walletBehavior,
    });
    let txId: string;
    try {
      txId = await wallet.send({ address, amount: amountSats });
    } catch (e) {
      throw toArkadeError("send_failed", "Send failed", e);
    }
    try {
      const snapshot = await snapshotWallet(wallet);
      set({ wallet: applySnapshot(metadata, snapshot) });
      await persist(get());
    } catch {
      // ignore refresh failure; txId is still returned
    }
    return txId;
  },

  setWalletBehavior: async (behavior) => {
    const current = get().walletBehavior;
    const next = normalizeWalletBehavior({ ...current, ...behavior });
    if (
      current.vtxoAutoRenewal === next.vtxoAutoRenewal &&
      current.delegatedRenewal === next.delegatedRenewal
    ) {
      return;
    }
    set({ walletBehavior: next });
    await disposeWallet();
    await persist(get());
  },

  lockWallet: async () => {
    set((s) => ({
      security: { ...s.security, isLocked: true },
    }));
    await disposeWallet();
    await persist(get());
  },

  unlockWithPassword: async (password) => {
    const { security } = get();
    if (!security.passwordHash) return false;
    if (simpleHash(password) !== security.passwordHash) return false;
    set({ security: { ...security, isLocked: false } });
    await persist(get());
    return true;
  },

  unlockWithBiometrics: async () => {
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
    const metadata = get().wallet;
    if (metadata) {
      try {
        await clearAllWalletData(metadata.id);
      } catch {
        // best-effort cleanup
      }
      await deleteSecret(metadata.id);
    } else {
      await disposeWallet();
    }
    set({ ...DEFAULT_STATE, _hydrated: true });
    await AsyncStorage.removeItem(STORAGE_KEY);
    await AsyncStorage.removeItem(LEGACY_STORAGE_KEY);
  },

  setTheme: (theme) => {
    set((s) => ({
      preferences: { ...s.preferences, theme },
    }));
    persist(get());
  },

  setFiatCurrency: (currency) => {
    set((s) => ({
      preferences: { ...s.preferences, fiatCurrency: currency },
    }));
    persist(get());
  },

  setBitcoinUnit: (unit) => {
    set((s) => ({
      preferences: { ...s.preferences, bitcoinUnit: unit },
    }));
    persist(get());
  },

  setPassword: (password) => {
    set((s) => ({
      security: { ...s.security, passwordHash: simpleHash(password) },
    }));
    persist(get());
  },

  toggleBiometrics: (enabled) => {
    set((s) => ({
      security: { ...s.security, biometricsEnabled: enabled },
    }));
    persist(get());
  },
}));
