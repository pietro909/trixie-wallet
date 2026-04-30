import { Ramps } from "@arkade-os/sdk";
import { bytesToUtf8, utf8ToBytes } from "@noble/ciphers/utils.js";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import * as Crypto from "expo-crypto";
import * as LocalAuthentication from "expo-local-authentication";
import { create } from "zustand";
import { ArkadeError, toArkadeError } from "../services/arkade/errors";
import {
  estimateOffboardFee,
  OffboardFeeEstimateError,
} from "../services/arkade/feePreview";
import {
  buildMnemonicIdentity,
  buildRandomSingleKeyIdentity,
  buildSingleKeyIdentityFromHex,
  buildSingleKeyIdentityFromNsec,
  bytesToHex,
  createMnemonic,
  type IdentityArtifacts,
} from "../services/arkade/identity";
import {
  clearAllSwaps,
  createArkToBtcChainSwap,
  disposeLightning,
  ensureLightning,
  findRecentSubmarineSwapId,
  getLatestBoltzSwapWriteAt,
  getLightningActivitySources,
  getNonTerminalSwapCount,
  isLightningSupportedForNetwork,
  quoteArkToBtcChainSwap,
  refreshSwapsStatus,
  restoreBoltzSwaps,
  restoreLightningActivity,
  sendLightningPayment,
  setSwapEventListener,
  snapshotBoltzSwaps,
  waitAndClaimChainSwap,
} from "../services/arkade/lightning";
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
  setIncomingFundsListener,
  snapshotWallet,
  type WalletSnapshot,
} from "../services/arkade/runtime";
import {
  deleteSecret,
  readSecret,
  saveSecret,
} from "../services/arkade/secret-store";
import { mergeActivities } from "../services/arkade/swap-mappers";
import {
  clearSwapMetadataForWallet,
  getAllSwapMetadata,
  getLatestSwapMetadataWriteAt,
  linkSwapToWalletTx,
  recordSwapMetadata,
  restoreSwapMetadataRows,
} from "../services/arkade/swap-storage";
import {
  BackupError,
  decryptBundle,
  type EncryptedEnvelope,
  encryptBundle,
} from "../services/backup/crypto";
import {
  buildBackupPayload,
  PayloadParseError,
  parseBackupPayload,
} from "../services/backup/serializer";
import {
  deleteBackupTempFile,
  writeBackupToTemp,
} from "../services/backup/storage";
import {
  isBitcoinAddressForNetwork,
  networkNameOrNull,
} from "../services/paymentParser";
import type {
  Activity,
  AppState,
  ArkadeWalletMetadata,
  BitcoinUnit,
  FiatCurrency,
  ThemePref,
  WalletBehavior,
} from "./types";

const STORAGE_KEY = "app_state_v4";
const CURRENT_SCHEMA_VERSION: AppState["schemaVersion"] = 4;
const LEGACY_STORAGE_KEYS = [
  "app_state_v1",
  "app_state_v2",
  "app_state_v3",
] as const;

async function clearLegacyStorage(): Promise<void> {
  await Promise.all(
    LEGACY_STORAGE_KEYS.map((key) => AsyncStorage.removeItem(key)),
  );
}

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

function appVersionString(): string {
  const cfg = Constants.expoConfig as { version?: string } | null;
  return cfg?.version ?? "unknown";
}

function markDirtyForBackup(): void {
  const current = useAppStore.getState();
  if (current.security.dirtyForBackup) return;
  useAppStore.setState({
    security: { ...current.security, dirtyForBackup: true },
  });
  void persist(useAppStore.getState());
}

const DEFAULT_WALLET_BEHAVIOR: WalletBehavior = {
  vtxoAutoRenewal: true,
  delegatedRenewal: true,
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
  schemaVersion: 4,
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
  | { kind: "nsec"; nsec: string }
  | { kind: "hex"; privateKeyHex: string };

export type BackupHealth = {
  /** True when the wallet has any persisted swap-recovery material. */
  hasSwapMaterial: boolean;
  /** Timestamp of the last successful backup export, or null. */
  lastBackupAt: number | null;
  /**
   * True when there is recoverable material that has not been captured by an
   * export, either because no export has happened yet or because state has
   * mutated since the last one.
   */
  isStale: boolean;
};

type StoreState = AppState & {
  _hydrated: boolean;
  hydrate: () => Promise<void>;
  refreshServer: () => Promise<void>;
  setArkServerUrl: (url: string) => Promise<void>;
  createWallet: (kind: CreateWalletKind) => Promise<void>;
  restoreWallet: (input: RestoreInput) => Promise<void>;
  refreshWallet: () => Promise<void>;
  sendArkade: (address: string, amountSats: number) => Promise<string>;
  sendLightning: (
    invoice: string,
    amountSats: number,
  ) => Promise<{ txId: string; feeSats: number; amountSats: number }>;
  sendOnchain: (
    address: string,
    amountSats: number,
  ) => Promise<{ txId: string; feeSats: number; amountSats: number }>;
  sendChainSwap: (
    address: string,
    amountSats: number,
  ) => Promise<{
    txId: string;
    feeSats: number;
    amountSats: number;
    swapId: string;
  }>;
  setWalletBehavior: (behavior: Partial<WalletBehavior>) => Promise<void>;
  lockWallet: () => Promise<void>;
  unlockWithPassword: (password: string) => Promise<boolean>;
  unlockWithBiometrics: () => Promise<boolean>;
  resetWallet: () => Promise<void>;
  getPendingLightningSwapCount: () => Promise<number>;
  exportBackup: (password: string) => Promise<{
    uri: string;
    filename: string;
    createdAt: number;
  }>;
  markBackupCompleted: (createdAt: number) => Promise<void>;
  discardBackupTempFile: (uri: string) => void;
  importBackup: (
    envelope: EncryptedEnvelope,
    password: string,
  ) => Promise<void>;
  getBackupHealth: () => Promise<BackupHealth>;
  setTheme: (theme: ThemePref) => void;
  setFiatCurrency: (currency: FiatCurrency) => void;
  setBitcoinUnit: (unit: BitcoinUnit) => void;
  setPassword: (password: string) => void;
  toggleBiometrics: (enabled: boolean) => void;
};

async function persist(state: AppState) {
  const data: AppState = {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    wallet: state.wallet,
    network: state.network,
    walletBehavior: state.walletBehavior,
    preferences: state.preferences,
    security: state.security,
  };
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

async function buildActivities(
  walletId: string,
  arkadeActivities: Activity[],
  network: string | null,
): Promise<Activity[]> {
  const sources = await getLightningActivitySources(walletId);
  return mergeActivities({
    arkadeActivities,
    swaps: sources.swaps,
    metadata: sources.metadata,
    network,
  });
}

function buildMetadata(
  walletId: string,
  arkServerUrl: string,
  esploraUrl: string | undefined,
  network: string,
  artifacts: IdentityArtifacts,
  snapshot: WalletSnapshot,
  activities: Activity[],
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
    activities,
    backup: {
      hasMnemonic: artifacts.identityKind === "mnemonic",
      hasPrivateKey: artifacts.identityKind === "singleKey",
    },
  };
}

function applySnapshot(
  metadata: ArkadeWalletMetadata,
  snapshot: WalletSnapshot,
  activities: Activity[],
): ArkadeWalletMetadata {
  return {
    ...metadata,
    arkAddress: snapshot.arkAddress,
    boardingAddress: snapshot.boardingAddress,
    balanceSats: snapshot.balance.available,
    balanceTotalSats: snapshot.balance.total,
    balanceBoardingSats: snapshot.balance.boardingTotal,
    activities,
  };
}

async function maybeEnsureLightning(
  metadata: ArkadeWalletMetadata,
  behavior: WalletBehavior,
): Promise<void> {
  if (!isLightningSupportedForNetwork(metadata.network)) return;
  try {
    await ensureLightning({ metadata, behavior });
  } catch {
    // Best-effort — wallet remains usable without Lightning.
  }
}

/**
 * Async-after-navigation Boltz restore: kicks off `restoreSwaps()` and patches
 * the wallet metadata + Activity list when it returns. Failures are recorded
 * but never thrown — restore is recovery, not the critical path.
 */
function scheduleLightningRestore(walletId: string): void {
  setTimeout(() => {
    void (async () => {
      const current = useAppStore.getState().wallet;
      if (!current || current.id !== walletId) return;
      const startedAt = Date.now();
      try {
        const summary = await restoreLightningActivity();
        const after = useAppStore.getState().wallet;
        if (!after || after.id !== walletId) return;
        const restoreState = {
          lastAt: startedAt,
          lastCount:
            summary.reverseCount + summary.submarineCount + summary.chainCount,
        };
        const refreshedActivities = await buildActivities(
          walletId,
          after.activities.filter((a) => a.source.type !== "boltz_swap"),
          useAppStore.getState().network.detectedNetwork ?? after.network,
        ).catch(() => after.activities);
        useAppStore.setState({
          wallet: {
            ...after,
            activities: refreshedActivities,
            lightningRestore: restoreState,
          },
        });
        await persist(useAppStore.getState());
      } catch (e) {
        const after = useAppStore.getState().wallet;
        if (!after || after.id !== walletId) return;
        const message = e instanceof Error ? e.message : "Restore failed";
        useAppStore.setState({
          wallet: {
            ...after,
            lightningRestore: {
              lastAt: startedAt,
              lastCount: after.lightningRestore?.lastCount ?? 0,
              lastError: message,
            },
          },
        });
        await persist(useAppStore.getState());
      }
    })();
  }, 0);
}

export const useAppStore = create<StoreState>((set, get) => ({
  ...DEFAULT_STATE,
  _hydrated: false,

  hydrate: async () => {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (!raw) {
        await clearLegacyStorage();
        set({ _hydrated: true });
        return;
      }
      let parsed: Partial<AppState>;
      try {
        parsed = JSON.parse(raw) as Partial<AppState>;
      } catch {
        await AsyncStorage.removeItem(STORAGE_KEY);
        await clearLegacyStorage();
        set({ _hydrated: true });
        return;
      }
      if (parsed.schemaVersion !== CURRENT_SCHEMA_VERSION) {
        await AsyncStorage.removeItem(STORAGE_KEY);
        await clearLegacyStorage();
        set({ _hydrated: true });
        return;
      }
      set({
        ...DEFAULT_STATE,
        ...parsed,
        schemaVersion: CURRENT_SCHEMA_VERSION,
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
    if (get().wallet) markDirtyForBackup();
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
      const draft: ArkadeWalletMetadata = buildMetadata(
        walletId,
        arkServerUrl,
        undefined,
        serverNetwork,
        artifacts,
        snapshot,
        snapshot.activities,
      );
      await maybeEnsureLightning(draft, get().walletBehavior);
      const activities = await buildActivities(
        walletId,
        snapshot.activities,
        serverNetwork,
      );
      const metadata: ArkadeWalletMetadata = { ...draft, activities };
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
      if (isLightningSupportedForNetwork(serverNetwork)) {
        scheduleLightningRestore(walletId);
      }
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
        : input.kind === "nsec"
          ? buildSingleKeyIdentityFromNsec(input.nsec)
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
      const draft: ArkadeWalletMetadata = buildMetadata(
        walletId,
        arkServerUrl,
        undefined,
        serverNetwork,
        artifacts,
        snapshot,
        snapshot.activities,
      );
      await maybeEnsureLightning(draft, get().walletBehavior);
      const activities = await buildActivities(
        walletId,
        snapshot.activities,
        serverNetwork,
      );
      const metadata: ArkadeWalletMetadata = { ...draft, activities };
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
      if (isLightningSupportedForNetwork(serverNetwork)) {
        scheduleLightningRestore(walletId);
      }
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
    await maybeEnsureLightning(metadata, get().walletBehavior);
    // Pull the latest Boltz status for non-final swaps before merging into
    // Activity. Best-effort: a stale or unreachable Boltz API must not break
    // wallet refresh, so the helper itself swallows errors.
    await refreshSwapsStatus();
    const activities = await buildActivities(
      metadata.id,
      snapshot.activities,
      get().network.detectedNetwork ?? metadata.network,
    );
    set({ wallet: applySnapshot(metadata, snapshot, activities) });
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
      const snapshot = await snapshotWallet(wallet, metadata.arkServerUrl, {
        network: get().network.detectedNetwork ?? metadata.network,
      });
      const activities = await buildActivities(
        metadata.id,
        snapshot.activities,
        get().network.detectedNetwork ?? metadata.network,
      );
      set({ wallet: applySnapshot(metadata, snapshot, activities) });
      await persist(get());
    } catch {
      // ignore refresh failure; txId is still returned
    }
    return txId;
  },

  sendLightning: async (invoice, amountSats) => {
    const metadata = get().wallet;
    if (!metadata) {
      throw new ArkadeError("wallet_not_ready", "No wallet available");
    }
    if (!isLightningSupportedForNetwork(metadata.network)) {
      throw new ArkadeError(
        "lightning_unavailable",
        `Lightning is not configured for ${metadata.network}`,
      );
    }
    await maybeEnsureLightning(metadata, get().walletBehavior);
    const beforeTs = Date.now();
    const response = await sendLightningPayment({ invoice });
    try {
      const swapId = await findRecentSubmarineSwapId(beforeTs);
      if (swapId) {
        await recordSwapMetadata({
          swapId,
          walletId: metadata.id,
          direction: "out",
          createdForFlow: "send",
          invoiceAmountSats: amountSats,
          arkadeAmountSats: response.amount,
        });
        await linkSwapToWalletTx({
          swapId,
          walletTxId: response.txid,
          source: "send_result",
        });
      }
    } catch {
      // metadata persistence is best-effort; the send already settled.
    }
    try {
      const wallet = await ensureWallet({
        metadata,
        behavior: get().walletBehavior,
      });
      const snapshot = await snapshotWallet(wallet, metadata.arkServerUrl, {
        network: get().network.detectedNetwork ?? metadata.network,
      });
      const activities = await buildActivities(
        metadata.id,
        snapshot.activities,
        get().network.detectedNetwork ?? metadata.network,
      );
      set({ wallet: applySnapshot(metadata, snapshot, activities) });
      await persist(get());
    } catch {
      // refresh failure; ignore
    }
    const feeSats = Math.max(0, response.amount - amountSats);
    return { txId: response.txid, feeSats, amountSats: response.amount };
  },

  sendOnchain: async (address, amountSats) => {
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
        "Insufficient offchain balance for this amount",
      );
    }
    const network = get().network.detectedNetwork ?? metadata.network;
    if (!isBitcoinAddressForNetwork(address, network)) {
      throw new ArkadeError(
        "send_failed",
        `Address does not belong to the active network (${network})`,
      );
    }
    const serverInfo = get().network.serverInfo;
    if (!serverInfo) {
      throw new ArkadeError(
        "server_unreachable",
        "Server fee info is not available — refresh the network and try again",
      );
    }
    const wallet = await ensureWallet({
      metadata,
      behavior: get().walletBehavior,
    });

    let vtxos: Awaited<ReturnType<typeof wallet.getVtxos>>;
    try {
      vtxos = await wallet.getVtxos({
        withRecoverable: true,
        withUnrolled: false,
      });
    } catch (e) {
      throw toArkadeError("send_failed", "Failed to load offchain coins", e);
    }

    let estimate: ReturnType<typeof estimateOffboardFee>;
    try {
      estimate = estimateOffboardFee({
        vtxos,
        amountSats,
        destinationAddress: address,
        feeInfo: { intentFee: serverInfo.intentFee },
        network: networkNameOrNull(network),
      });
    } catch (e) {
      if (e instanceof OffboardFeeEstimateError) {
        if (e.kind === "amount_exceeds_balance") {
          throw new ArkadeError("insufficient_balance", e.message, e);
        }
        throw new ArkadeError("send_failed", e.message, e);
      }
      throw toArkadeError("send_failed", "Failed to estimate fee", e);
    }

    let txId: string;
    try {
      txId = await new Ramps(wallet).offboard(
        address,
        {
          intentFee: serverInfo.intentFee,
          txFeeRate: serverInfo.txFeeRate,
        },
        BigInt(amountSats),
      );
    } catch (e) {
      throw toArkadeError("send_failed", "Collaborative exit failed", e);
    }

    try {
      const snapshot = await snapshotWallet(wallet, metadata.arkServerUrl, {
        network,
      });
      const activities = await buildActivities(
        metadata.id,
        snapshot.activities,
        network,
      );
      set({ wallet: applySnapshot(metadata, snapshot, activities) });
      await persist(get());
    } catch {
      // refresh failure; ignore — txId is still returned
    }
    return { txId, feeSats: estimate.feeSats, amountSats };
  },

  sendChainSwap: async (address, amountSats) => {
    const metadata = get().wallet;
    if (!metadata) {
      throw new ArkadeError("wallet_not_ready", "No wallet available");
    }
    if (amountSats <= 0) {
      throw new ArkadeError("send_failed", "Amount must be greater than zero");
    }
    if (!isLightningSupportedForNetwork(metadata.network)) {
      throw new ArkadeError(
        "lightning_unavailable",
        `Chain swap is not configured for ${metadata.network}`,
      );
    }
    const network = get().network.detectedNetwork ?? metadata.network;
    if (!isBitcoinAddressForNetwork(address, network)) {
      throw new ArkadeError(
        "send_failed",
        `Address does not belong to the active network (${network})`,
      );
    }

    const quote = await quoteArkToBtcChainSwap(network, amountSats);
    if (!quote) {
      throw new ArkadeError(
        "server_unreachable",
        "Could not reach Boltz to quote chain swap",
      );
    }
    if (!quote.withinLimits) {
      throw new ArkadeError(
        amountSats < quote.min ? "amount_below_limit" : "amount_above_limit",
        `Chain swap supports ${quote.min}–${quote.max} sats`,
      );
    }
    if (amountSats + quote.feeSats > metadata.balanceSats) {
      throw new ArkadeError(
        "insufficient_balance",
        "Insufficient offchain balance for amount + chain swap fees",
      );
    }

    await maybeEnsureLightning(metadata, get().walletBehavior);

    const response = await createArkToBtcChainSwap({
      btcAddress: address,
      receiverLockAmount: amountSats,
    });

    if (response.amountToPay > metadata.balanceSats) {
      throw new ArkadeError(
        "insufficient_balance",
        "Insufficient balance for the Boltz-quoted lockup amount",
      );
    }

    try {
      await recordSwapMetadata({
        swapId: response.pendingSwap.id,
        walletId: metadata.id,
        direction: "out",
        createdForFlow: "send",
        invoiceAmountSats: amountSats,
        arkadeAmountSats: response.amountToPay,
      });
    } catch {
      // best-effort metadata; the offchain leg can still proceed
    }

    const wallet = await ensureWallet({
      metadata,
      behavior: get().walletBehavior,
    });
    let walletTxId: string;
    try {
      walletTxId = await wallet.send({
        address: response.arkAddress,
        amount: response.amountToPay,
      });
    } catch (e) {
      throw toArkadeError(
        "send_failed",
        "Offchain send to Boltz lockup failed",
        e,
      );
    }

    try {
      await linkSwapToWalletTx({
        swapId: response.pendingSwap.id,
        walletTxId,
        source: "send_result",
      });
    } catch {
      // best-effort linkage
    }

    // Kick off the mainnet claim in the background. Status updates flow back
    // into the store via `setSwapEventListener` → `refreshWallet`.
    void waitAndClaimChainSwap(response.pendingSwap).catch(() => {
      // Failures surface via SwapManager events / Activity row status.
    });

    try {
      const snapshot = await snapshotWallet(wallet, metadata.arkServerUrl, {
        network,
      });
      const activities = await buildActivities(
        metadata.id,
        snapshot.activities,
        network,
      );
      set({ wallet: applySnapshot(metadata, snapshot, activities) });
      await persist(get());
    } catch {
      // refresh failure; offchain leg is still confirmed locally
    }

    return {
      txId: walletTxId,
      feeSats: Math.max(0, response.amountToPay - amountSats),
      amountSats,
      swapId: response.pendingSwap.id,
    };
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
    markDirtyForBackup();
    await disposeLightning();
    await disposeWallet();
    await persist(get());
  },

  lockWallet: async () => {
    set((s) => ({
      security: { ...s.security, isLocked: true },
    }));
    await disposeLightning();
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
    await disposeLightning();
    if (metadata) {
      try {
        await clearAllWalletData(metadata.id);
      } catch {
        // best-effort cleanup
      }
      try {
        await clearSwapMetadataForWallet(metadata.id);
      } catch {
        // best-effort cleanup
      }
      await deleteSecret(metadata.id);
    } else {
      await disposeWallet();
    }
    try {
      await clearAllSwaps();
    } catch {
      // best-effort cleanup
    }
    set({ ...DEFAULT_STATE, _hydrated: true });
    await AsyncStorage.removeItem(STORAGE_KEY);
    await clearLegacyStorage();
  },

  getPendingLightningSwapCount: async () => {
    const metadata = get().wallet;
    if (!metadata) return 0;
    if (!isLightningSupportedForNetwork(metadata.network)) return 0;
    try {
      await maybeEnsureLightning(metadata, get().walletBehavior);
      return await getNonTerminalSwapCount();
    } catch {
      return 0;
    }
  },

  exportBackup: async (password) => {
    const metadata = get().wallet;
    if (!metadata) {
      throw new ArkadeError("wallet_not_ready", "No wallet to back up");
    }
    const secret = await readSecret(metadata.id);
    const swapMetadata = await getAllSwapMetadata(metadata.id).catch(() => []);
    const boltzSwaps = await snapshotBoltzSwaps().catch(() => []);
    const payload = buildBackupPayload({
      wallet: metadata,
      walletBehavior: get().walletBehavior,
      preferences: get().preferences,
      secret,
      swapMetadata,
      boltzSwaps,
    });
    const plaintext = utf8ToBytes(JSON.stringify(payload));
    const envelope = await encryptBundle({
      plaintext,
      password,
      appVersion: appVersionString(),
    });
    // Full ISO timestamp (with `:` / `.` replaced) so two saves the same day
    // don't collide on the destination filesystem, and so users with leftover
    // empty folders from prior buggy saves can keep saving.
    const stamp = new Date(envelope.createdAt)
      .toISOString()
      .replace(/[:.]/g, "-")
      .replace(/-?Z$/, "");
    const basename = `trixie-backup-${stamp}`;
    const filename = `${basename}.trixiebackup`;
    const uri = writeBackupToTemp({ envelope, basename });
    return { uri, filename, createdAt: envelope.createdAt };
  },

  markBackupCompleted: async (createdAt) => {
    set((s) => ({
      security: {
        ...s.security,
        lastBackupAt: createdAt,
        dirtyForBackup: false,
      },
    }));
    await persist(get());
  },

  discardBackupTempFile: (uri) => {
    deleteBackupTempFile(uri);
  },

  importBackup: async (envelope, password) => {
    if (get().wallet) {
      throw new ArkadeError(
        "wallet_init_failed",
        "A wallet already exists. Reset before restoring from a backup.",
      );
    }
    const plaintext = await decryptBundle(envelope, password);
    let payload: ReturnType<typeof parseBackupPayload>;
    try {
      payload = parseBackupPayload(JSON.parse(bytesToUtf8(plaintext)));
    } catch (e) {
      if (e instanceof PayloadParseError) throw e;
      throw new PayloadParseError(
        "malformed_payload",
        "Backup file contents could not be read",
      );
    }

    const arkServerUrl = payload.wallet.arkServerUrl;
    set((s) => ({
      network: {
        ...s.network,
        arkServerUrl,
        status: "connecting",
        detectedNetwork: null,
        lastError: null,
        serverInfo: null,
      },
      walletBehavior: payload.walletBehavior,
      preferences: payload.preferences,
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
      payload.secret.kind === "mnemonic"
        ? buildMnemonicIdentity(payload.secret.mnemonic, isMainnet)
        : buildSingleKeyIdentityFromHex(payload.secret.privateKeyHex);

    const walletId = payload.wallet.id;
    try {
      await saveSecret(walletId, payload.secret);
      await restoreSwapMetadataRows(payload.swapMetadata);
      await restoreBoltzSwaps(payload.boltzSwaps);

      const { snapshot } = await createWalletInstance({
        walletId,
        artifacts,
        arkServerUrl,
        network: serverNetwork,
        behavior: payload.walletBehavior,
      });
      const draft = buildMetadata(
        walletId,
        arkServerUrl,
        payload.wallet.esploraUrl ?? undefined,
        serverNetwork,
        artifacts,
        snapshot,
        snapshot.activities,
      );
      const restored: ArkadeWalletMetadata = {
        ...draft,
        label: payload.wallet.label,
      };
      await maybeEnsureLightning(restored, payload.walletBehavior);
      const activities = await buildActivities(
        walletId,
        snapshot.activities,
        serverNetwork,
      );
      const metadata: ArkadeWalletMetadata = { ...restored, activities };
      set((s) => ({
        wallet: metadata,
        security: {
          ...s.security,
          lastBackupAt: envelope.createdAt,
          dirtyForBackup: false,
        },
        network: {
          ...s.network,
          status: "online",
          detectedNetwork: serverNetwork,
          lastError: null,
          serverInfo: probed,
        },
      }));
      await persist(get());
      if (isLightningSupportedForNetwork(serverNetwork)) {
        scheduleLightningRestore(walletId);
      }
    } catch (e) {
      // Best-effort rollback: clear the partially-written secret/sql state so
      // the user can retry without a stuck half-import.
      await deleteSecret(walletId).catch(() => {});
      await disposeWallet().catch(() => {});
      if (e instanceof BackupError || e instanceof PayloadParseError) throw e;
      throw toArkadeError(
        "wallet_init_failed",
        "Failed to restore wallet from backup",
        e,
      );
    }
  },

  getBackupHealth: async () => {
    const metadata = get().wallet;
    const lastBackupAt = get().security.lastBackupAt ?? null;
    if (!metadata) {
      return { hasSwapMaterial: false, lastBackupAt, isStale: false };
    }
    const [metaTs, boltzTs] = await Promise.all([
      getLatestSwapMetadataWriteAt(metadata.id).catch(() => null),
      getLatestBoltzSwapWriteAt().catch(() => null),
    ]);
    const hasSwapMaterial = metaTs != null || boltzTs != null;
    const dirty = get().security.dirtyForBackup === true;
    const latest = Math.max(metaTs ?? 0, boltzTs ?? 0);
    const isStale =
      hasSwapMaterial &&
      (lastBackupAt == null || dirty || lastBackupAt < latest);
    return { hasSwapMaterial, lastBackupAt, isStale };
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

// Refresh wallet snapshot + Activity list whenever the SwapManager fires.
// Coalesces bursts of events (e.g. update → action → completed in close
// succession) into a single refresh. Also bumps the dirty-for-backup flag
// so the Reset gate can warn about unbacked-up state.
let swapEventRefreshTimer: ReturnType<typeof setTimeout> | null = null;
setSwapEventListener(() => {
  markDirtyForBackup();
  if (swapEventRefreshTimer) return;
  swapEventRefreshTimer = setTimeout(() => {
    swapEventRefreshTimer = null;
    useAppStore
      .getState()
      .refreshWallet()
      .catch(() => {
        // background refresh; surface only via next user interaction
      });
  }, 250);
});

// Refresh wallet snapshot + Activity list whenever the SDK reports newly
// received funds (boarding utxo or incoming vtxo). Coalesces bursts.
let incomingFundsRefreshTimer: ReturnType<typeof setTimeout> | null = null;
setIncomingFundsListener(() => {
  if (incomingFundsRefreshTimer) return;
  incomingFundsRefreshTimer = setTimeout(() => {
    incomingFundsRefreshTimer = null;
    useAppStore
      .getState()
      .refreshWallet()
      .catch(() => {
        // background refresh
      });
  }, 250);
});
