import { Ramps } from "@arkade-os/sdk";
import { bytesToUtf8, utf8ToBytes } from "@noble/ciphers/utils.js";
import { pbkdf2Async } from "@noble/hashes/pbkdf2.js";
import { sha256 } from "@noble/hashes/sha2.js";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import * as Crypto from "expo-crypto";
import * as LocalAuthentication from "expo-local-authentication";
import {
  AppState as NativeAppState,
  type AppStateStatus as NativeAppStateStatus,
} from "react-native";
import { create } from "zustand";
import { isValidAssetId } from "../services/arkade/asset-format";
import {
  clearIconApprovals,
  markSelfIssued,
} from "../services/arkade/asset-icon-approval";
import { clearAssetMetadata } from "../services/arkade/asset-metadata";
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
  hexToBytes,
  type IdentityArtifacts,
} from "../services/arkade/identity";
import {
  clearAllSwaps,
  createArkToBtcChainSwap,
  disposeLightning,
  ensureLightning,
  getLatestBoltzSwapWriteAt,
  getLightningActivitySources,
  getNonTerminalSwapCount,
  isLightningSupportedForNetwork,
  quoteArkToBtcChainSwap,
  refreshSwapsStatus,
  refundChainSwapById,
  restoreBoltzSwaps,
  restoreLightningActivity,
  resumeLightningSwaps,
  sendLightningPayment,
  setSwapEventListener,
  snapshotBoltzSwaps,
  waitAndClaimChainSwap,
} from "../services/arkade/lightning";
import {
  DEFAULT_ARK_SERVER_URL,
  isMainnetForNetworkName,
  MAINNET_ARK_SERVER_URL,
  MUTINYNET_ARK_SERVER_URL,
} from "../services/arkade/network";
import { finalizePendingTx } from "../services/arkade/pending-tx-recovery";
import {
  isSwapBeingProcessed,
  lookupSubmarineRecovery,
  type RecoveryActionKind,
  type RecoveryItem,
  type RecoveryScan,
  runSubmarineRecovery,
  scanRecoveryState as scanRecoveryStateService,
} from "../services/arkade/recovery";
import {
  clearAllWalletData,
  createWalletInstance,
  disposeWallet,
  ensureWallet,
  probeServer,
  refreshWalletSnapshot,
  setIncomingFundsListener,
  type WalletSnapshot,
} from "../services/arkade/runtime";
import {
  deleteSecret,
  readSecret,
  saveSecret,
} from "../services/arkade/secret-store";
import {
  clearSwapBackgroundState,
  ensureSwapBackgroundRegistered,
  unregisterSwapBackgroundTask,
} from "../services/arkade/swap-background";
import { mergeActivities } from "../services/arkade/swap-mappers";
import {
  clearSwapMetadataForWallet,
  getAllSwapMetadata,
  getLatestSwapMetadataWriteAt,
  type LocalSwapFlow,
  linkSwapToWalletTx,
  recordSwapMetadata,
  restoreSwapMetadataRows,
} from "../services/arkade/swap-storage";
import {
  type ClassifiedVtxo,
  loadVtxos,
} from "../services/arkade/vtxo-listing";
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
  clearPersistedErrors,
  drainPersistedErrors,
} from "../services/diagnostics/persisted";
import { recordError } from "../services/diagnostics/recorder";
import {
  isBitcoinAddressForNetwork,
  networkNameOrNull,
} from "../services/paymentParser";
import { toastEmitter } from "../services/toast-emitter";
import {
  auditBalanceIntegrity,
  computePendingTotals,
} from "../services/wallet-balance";
import { LEGACY_STORAGE_KEYS, STORAGE_KEY } from "./storage-keys";
import type {
  Activity,
  AppState,
  ArkadeWalletMetadata,
  AssetsSlice,
  BackgroundTaskKey,
  BackgroundTasks,
  BitcoinUnit,
  FiatCurrency,
  LightningResumeState,
  LightningResumeTrigger,
  NotificationPreferences,
  ThemePref,
  WalletBehavior,
} from "./types";

const CURRENT_SCHEMA_VERSION: AppState["schemaVersion"] = 6;

// PBKDF2 cost for the unlock password hash. Each guess against an exfiltrated
// `app_state_v1` must pay this iteration count, so we set it higher than the
// 200k used by `backup/crypto.ts` — the unlock verify runs once per session
// behind a button press, while the backup KDF runs once per export. Pure-JS
// PBKDF2 on a typical phone clocks ~10–20k iters/sec, so 300k stays under
// ~500ms on midrange devices. Decoders pass the password through this same
// constant, so existing wallets are migrated by wipe-on-mismatch (schemaVersion
// bump), not a stored iteration field.
const PASSWORD_KDF_ITERATIONS = 300_000;
const PASSWORD_KDF_KEY_LENGTH = 32;

async function clearLegacyStorage(): Promise<void> {
  await Promise.all(
    LEGACY_STORAGE_KEYS.map((key) => AsyncStorage.removeItem(key)),
  );
}

export async function hashPassword(
  password: string,
  saltHex: string,
): Promise<string> {
  const derived = await pbkdf2Async(
    sha256,
    utf8ToBytes(password),
    hexToBytes(saltHex),
    { c: PASSWORD_KDF_ITERATIONS, dkLen: PASSWORD_KDF_KEY_LENGTH },
  );
  return bytesToHex(derived);
}

export function generateSalt(): string {
  const bytes = Crypto.getRandomBytes(16);
  return bytesToHex(bytes);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
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

const DEFAULT_BACKGROUND_TASKS: BackgroundTasks = {
  swapPoll: true,
};

/**
 * Coerce a persisted `backgroundTasks` blob into a fully-populated slice.
 * Each key reads as enabled unless the stored value is exactly `false`, so
 * existing v4 payloads without the slice (or future payloads missing a key
 * added later, e.g. `pushNotifications`) inherit defaults rather than
 * silently turning a newly-added task off.
 */
function normalizeBackgroundTasks(
  raw: Partial<BackgroundTasks> | null | undefined,
): BackgroundTasks {
  return {
    swapPoll: raw?.swapPoll !== false,
  };
}

const DEFAULT_ASSETS_SLICE: AssetsSlice = {
  importedAssetIds: [],
};

const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  // Opt-in: the user explicitly enables notifications from the Profile
  // toggle. Avoids the iOS "permission dialog on first launch" anti-pattern
  // where a denied response can never be re-prompted in-app.
  enabled: false,
  swaps: true,
  payments: true,
};

function normalizePreferences(
  raw: Partial<AppState["preferences"]> | null | undefined,
): AppState["preferences"] {
  return {
    theme: raw?.theme ?? "system",
    fiatCurrency: raw?.fiatCurrency ?? "EUR",
    bitcoinUnit: raw?.bitcoinUnit ?? "auto",
    notifications: {
      enabled: raw?.notifications?.enabled === true,
      // Per-category toggles default to true so that turning the master
      // toggle on yields the full notification set without an extra step.
      swaps: raw?.notifications?.swaps !== false,
      payments: raw?.notifications?.payments !== false,
    },
  };
}

/**
 * Coerce a persisted `assets` slice into a fully-populated value, tolerating
 * missing fields and bad entries. No schemaVersion bump — same hydrate-time
 * normalization pattern as `backgroundTasks`.
 */
function normalizeAssetsSlice(
  raw: Partial<AssetsSlice> | null | undefined,
): AssetsSlice {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_ASSETS_SLICE };
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const id of raw.importedAssetIds ?? []) {
    if (typeof id !== "string") continue;
    if (!isValidAssetId(id)) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return { importedAssetIds: ids };
}

type BackgroundTaskDescriptor = {
  register: () => Promise<void>;
  unregister: () => Promise<void>;
};

const BACKGROUND_TASK_DESCRIPTORS: Record<
  BackgroundTaskKey,
  BackgroundTaskDescriptor
> = {
  swapPoll: {
    register: ensureSwapBackgroundRegistered,
    unregister: unregisterSwapBackgroundTask,
  },
};

const DEFAULT_STATE: AppState = {
  schemaVersion: 6,
  wallet: null,
  network: {
    arkServerUrl: DEFAULT_ARK_SERVER_URL,
    detectedNetwork: null,
    status: "idle",
    lastError: null,
    serverInfo: null,
  },
  walletBehavior: DEFAULT_WALLET_BEHAVIOR,
  backgroundTasks: DEFAULT_BACKGROUND_TASKS,
  assets: DEFAULT_ASSETS_SLICE,
  preferences: {
    theme: "system",
    fiatCurrency: "EUR",
    bitcoinUnit: "auto",
    notifications: DEFAULT_NOTIFICATION_PREFERENCES,
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
  /**
   * True when the wallet has any backup-worthy material — persisted swap
   * recovery rows, imported asset ids, or anything else the backup envelope
   * carries that is not derivable from the seed alone.
   */
  hasBackupMaterial: boolean;
  /** Timestamp of the last successful backup export, or null. */
  lastBackupAt: number | null;
  /**
   * True when there is recoverable material that has not been captured by an
   * export, either because no export has happened yet or because state has
   * mutated since the last one.
   */
  isStale: boolean;
};

export type RecoveryRowError =
  | { type: "deferred_locktime" }
  | { type: "message"; message: string };

type StoreState = AppState & {
  _hydrated: boolean;
  /**
   * Set when `hydrate()` finds persisted state it cannot load (schema version
   * mismatch or corrupted JSON). The persisted bytes are left untouched until
   * the user confirms via `acknowledgeSchemaMismatchAndWipe()`. `_hydrated`
   * stays `false` while this flag is set, so consumers gated on hydration do
   * not run against the empty in-memory defaults.
   */
  _schemaMismatch: boolean;
  /** Per-row spinner gate, keyed by `RecoveryItem.id`. */
  recoveringIds: Set<string>;
  /** Per-row error display, keyed by `RecoveryItem.id`. */
  rowErrors: Record<string, RecoveryRowError>;
  hydrate: () => Promise<void>;
  acknowledgeSchemaMismatchAndWipe: () => Promise<void>;
  refreshServer: () => Promise<void>;
  setArkadeNetwork: (network: "bitcoin" | "mutinynet") => Promise<void>;
  createWallet: (kind: CreateWalletKind) => Promise<void>;
  restoreWallet: (input: RestoreInput) => Promise<void>;
  refreshWallet: () => Promise<void>;
  resumeLightning: (trigger: LightningResumeTrigger) => Promise<void>;
  sendArkade: (address: string, amountSats: number) => Promise<string>;
  sendAsset: (
    address: string,
    assetId: string,
    amount: bigint,
  ) => Promise<string>;
  sendLightning: (
    invoice: string,
    amountSats: number,
    flow?: LocalSwapFlow,
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
  setBackgroundTaskEnabled: (
    taskKey: BackgroundTaskKey,
    enabled: boolean,
  ) => Promise<void>;
  lockWallet: () => Promise<void>;
  unlockWithPassword: (password: string) => Promise<boolean>;
  unlockWithBiometrics: () => Promise<boolean>;
  resetWallet: () => Promise<void>;
  getPendingLightningSwapCount: () => Promise<number>;
  scanRecoveryState: () => Promise<RecoveryScan>;
  runRecoveryAction: (
    action: RecoveryActionKind,
    itemId: string,
    item?: RecoveryItem,
  ) => Promise<RecoveryScan>;
  clearRecoveryRowError: (itemId: string) => void;
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
  importAsset: (assetId: string) => Promise<void>;
  forgetAsset: (assetId: string) => Promise<void>;
  issueAsset: (input: {
    name?: string;
    ticker?: string;
    decimals?: number;
    icon?: string;
    amount: bigint;
    controlAssetId?: string;
    controlMode?: "none" | "existing" | "new";
  }) => Promise<{ arkTxId: string; assetId: string }>;
  reissueAsset: (assetId: string, amount: bigint) => Promise<string>;
  burnAsset: (assetId: string, amount: bigint) => Promise<string>;
  /**
   * Load classified VTXOs. With `maxAgeMs`, returns the cached snapshot when
   * it's within the freshness window (avoids the SDK round-trip on
   * back-and-forth navigation between the list and detail screens). Without
   * `maxAgeMs`, always re-fetches.
   */
  loadWalletVtxos: (opts?: { maxAgeMs?: number }) => Promise<ClassifiedVtxo[]>;
  setTheme: (theme: ThemePref) => Promise<void>;
  setFiatCurrency: (currency: FiatCurrency) => Promise<void>;
  setBitcoinUnit: (unit: BitcoinUnit) => Promise<void>;
  setNotificationPreferences: (
    prefs: Partial<NotificationPreferences>,
  ) => Promise<void>;
  setPassword: (password: string) => Promise<void>;
  toggleBiometrics: (enabled: boolean) => Promise<void>;
};

async function persist(state: AppState) {
  const data: AppState = {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    wallet: state.wallet,
    network: state.network,
    walletBehavior: state.walletBehavior,
    backgroundTasks: state.backgroundTasks,
    assets: state.assets,
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
    assetBalances: snapshot.balance.assets,
    activities,
    backup: {
      hasMnemonic: artifacts.identityKind === "mnemonic",
      hasPrivateKey: artifacts.identityKind === "singleKey",
    },
  };
}

let balanceAuditWarned = false;

/**
 * In-memory cache for the most recent {@link ClassifiedVtxo} snapshot. Keyed
 * by walletId so wallet swaps cannot leak stale data. Not in Zustand state
 * because `ClassifiedVtxo.createdAt` is a `Date` (persist serialization
 * would mangle it), and the snapshot is purely a UI-side optimization.
 * Invalidated on lock, reset, and create-wallet.
 */
let vtxoSnapshotCache: {
  walletId: string;
  items: ClassifiedVtxo[];
  fetchedAt: number;
} | null = null;

function invalidateVtxoSnapshotCache(): void {
  vtxoSnapshotCache = null;
}

function applySnapshot(
  metadata: ArkadeWalletMetadata,
  snapshot: WalletSnapshot,
  activities: Activity[],
): ArkadeWalletMetadata {
  if (__DEV__ && !balanceAuditWarned) {
    const pending = computePendingTotals(activities);
    const warning = auditBalanceIntegrity(
      {
        availableSats: snapshot.balance.available,
        totalSats: snapshot.balance.total,
      },
      pending,
    );
    if (warning) {
      balanceAuditWarned = true;
      recordError("wallet", warning);
    }
  }
  return {
    ...metadata,
    arkAddress: snapshot.arkAddress,
    boardingAddress: snapshot.boardingAddress,
    balanceSats: snapshot.balance.available,
    balanceTotalSats: snapshot.balance.total,
    balanceBoardingSats: snapshot.balance.boardingTotal,
    assetBalances: snapshot.balance.assets,
    activities,
  };
}

async function maybeEnsureLightning(
  metadata: ArkadeWalletMetadata,
  behavior: WalletBehavior,
  swapBackgroundEnabled: boolean,
): Promise<void> {
  if (!isLightningSupportedForNetwork(metadata.network)) return;
  try {
    await ensureLightning({ metadata, behavior, swapBackgroundEnabled });
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
        const summary = await restoreLightningActivity(walletId);
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
        recordError("lightning", `restore_swaps_failed: ${message}`);
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

let lightningResumeInFlight: Promise<void> | null = null;
let refreshInFlight: Promise<void> | null = null;
let refreshPending = false;

type LightningResumeSummary = Awaited<ReturnType<typeof resumeLightningSwaps>>;

function lightningResumeStatus(
  summary: LightningResumeSummary,
): LightningResumeState["status"] {
  if (summary.errorCount === 0) return "success";
  const restoredCount =
    summary.reverseCount + summary.submarineCount + summary.chainCount;
  const didProgress =
    restoredCount +
      summary.polledCount +
      summary.updatedCount +
      summary.claimedCount +
      summary.refundedCount >
    0;
  return didProgress ? "partial" : "failed";
}

function lightningResumeStateFromSummary(
  summary: LightningResumeSummary,
): LightningResumeState {
  return {
    lastAt: summary.startedAt,
    lastFinishedAt: summary.finishedAt,
    trigger: summary.trigger,
    status: lightningResumeStatus(summary),
    restoredCount:
      summary.reverseCount + summary.submarineCount + summary.chainCount,
    reverseCount: summary.reverseCount,
    submarineCount: summary.submarineCount,
    chainCount: summary.chainCount,
    polledCount: summary.polledCount,
    updatedCount: summary.updatedCount,
    claimedCount: summary.claimedCount,
    refundedCount: summary.refundedCount,
    errorCount: summary.errorCount,
    nonTerminalCount: summary.nonTerminalCount,
    lastError: summary.lastError,
  };
}

function failedLightningResumeState(
  trigger: LightningResumeTrigger,
  startedAt: number,
  message: string,
): LightningResumeState {
  return {
    lastAt: startedAt,
    lastFinishedAt: Date.now(),
    trigger,
    status: "failed",
    restoredCount: 0,
    reverseCount: 0,
    submarineCount: 0,
    chainCount: 0,
    polledCount: 0,
    updatedCount: 0,
    claimedCount: 0,
    refundedCount: 0,
    errorCount: 1,
    nonTerminalCount: 0,
    lastError: message,
  };
}

function appendLightningResumeError(
  state: LightningResumeState,
  message: string,
): LightningResumeState {
  return {
    ...state,
    status: state.status === "failed" ? "failed" : "partial",
    errorCount: state.errorCount + 1,
    lastError: state.lastError ? `${state.lastError}; ${message}` : message,
  };
}

/**
 * Drain errors written by BG-context code (where the in-memory recorder is
 * unreachable) into the foreground recorder so the support bundle picks
 * them up. Original BG-side timestamp is prefixed onto the message because
 * `recordError` stamps with `Date.now()` at insertion time.
 */
async function drainAndForwardPersistedErrors(): Promise<void> {
  try {
    const entries = await drainPersistedErrors();
    for (const entry of entries) {
      // toISOString throws RangeError for timestamps outside the Date range.
      // safeParse already filters non-finite numbers, but a hand-edited
      // storage blob with an absurdly large value would still hit this.
      let stamp: string;
      try {
        stamp = new Date(entry.timestamp).toISOString();
      } catch {
        stamp = String(entry.timestamp);
      }
      recordError(
        entry.category,
        `[bg ${stamp}] ${entry.message}`,
        entry.details,
      );
    }
  } catch {
    // best-effort
  }
}

function scheduleLightningResume(trigger: LightningResumeTrigger): void {
  setTimeout(() => {
    void useAppStore
      .getState()
      .resumeLightning(trigger)
      .catch((e) => {
        recordError(
          "lightning",
          `scheduled_resume_failed: ${e instanceof Error ? e.message : String(e)}`,
        );
      });
  }, 0);
}

function setRecoveringId(
  current: Set<string>,
  id: string,
  flag: boolean,
): Set<string> {
  if (flag) {
    if (current.has(id)) return current;
    return new Set(current).add(id);
  }
  if (!current.has(id)) return current;
  const next = new Set(current);
  next.delete(id);
  return next;
}

function setRowError(
  current: Record<string, RecoveryRowError>,
  id: string,
  error: RecoveryRowError | null,
): Record<string, RecoveryRowError> {
  if (error == null) {
    if (!(id in current)) return current;
    const next = { ...current };
    delete next[id];
    return next;
  }
  return { ...current, [id]: error };
}

function rowErrorFromException(e: unknown): RecoveryRowError {
  if (e instanceof Error) return { type: "message", message: e.message };
  return { type: "message", message: "Recovery action failed" };
}

const EMPTY_RECOVERY_SCAN: RecoveryScan = {
  scannedAt: 0,
  items: [],
  counts: {},
};

export const useAppStore = create<StoreState>((set, get) => ({
  ...DEFAULT_STATE,
  _hydrated: false,
  _schemaMismatch: false,
  recoveringIds: new Set<string>(),
  rowErrors: {},

  hydrate: async () => {
    // Drain BG-context errors first, regardless of which path the rest of
    // hydrate takes. This guarantees errors captured before the wallet
    // existed (e.g. the OS task ran while there was no active wallet) still
    // surface, and ensures BG entries land in the recorder ahead of any
    // foreground errors emitted by the resume scheduled below — preserving
    // chronological order in the support bundle.
    await drainAndForwardPersistedErrors();
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (!raw) {
        await clearLegacyStorage();
        set({ _hydrated: true });
        return;
      }
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        // Corrupted state — surface to the user instead of silently wiping.
        // The persisted bytes stay on disk until they confirm via
        // `acknowledgeSchemaMismatchAndWipe()`.
        set({ _schemaMismatch: true });
        return;
      }

      const storedVersion =
        typeof parsed.schemaVersion === "number" ? parsed.schemaVersion : 0;
      if (storedVersion !== CURRENT_SCHEMA_VERSION) {
        // Schema mismatch (older or future) — alpha policy is wipe-on-mismatch
        // (no forward migrations), but the wipe is gated on user confirmation
        // so the persisted bytes can be retrieved off-device first if needed.
        set({ _schemaMismatch: true });
        return;
      }

      const data = parsed as Partial<AppState>;
      set({
        ...DEFAULT_STATE,
        ...data,
        schemaVersion: CURRENT_SCHEMA_VERSION,
        network: { ...DEFAULT_STATE.network, ...(data.network ?? {}) },
        preferences: normalizePreferences(data.preferences),
        security: {
          ...DEFAULT_STATE.security,
          ...(data.security ?? {}),
        },
        walletBehavior: normalizeWalletBehavior(data.walletBehavior),
        backgroundTasks: normalizeBackgroundTasks(data.backgroundTasks),
        assets: normalizeAssetsSlice(data.assets),
        wallet: data.wallet
          ? {
              ...data.wallet,
              assetBalances: Array.isArray(data.wallet.assetBalances)
                ? data.wallet.assetBalances
                : [],
            }
          : null,
        _hydrated: true,
      });
      const restored = get();
      if (
        restored.wallet &&
        !restored.security.isLocked &&
        isLightningSupportedForNetwork(restored.wallet.network)
      ) {
        scheduleLightningResume("startup");
      }
    } catch {
      set({ _hydrated: true });
    }
  },

  acknowledgeSchemaMismatchAndWipe: async () => {
    await AsyncStorage.removeItem(STORAGE_KEY);
    await clearLegacyStorage();
    set({
      ...DEFAULT_STATE,
      _hydrated: true,
      _schemaMismatch: false,
      recoveringIds: new Set<string>(),
      rowErrors: {},
    });
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

  setArkadeNetwork: async (network) => {
    if (get().wallet) {
      throw new ArkadeError(
        "wallet_init_failed",
        "Network cannot be changed once a wallet exists. Reset to switch.",
      );
    }
    const arkServerUrl =
      network === "bitcoin" ? MAINNET_ARK_SERVER_URL : MUTINYNET_ARK_SERVER_URL;
    set((s) => ({
      network: {
        ...s.network,
        arkServerUrl,
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
    // Defensive: the !get().wallet guard above means there's no live cache
    // to leak through, but if the guard is ever relaxed (e.g. multi-wallet
    // support) we don't want a stale snapshot surviving the boundary.
    invalidateVtxoSnapshotCache();
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
      await maybeEnsureLightning(
        draft,
        get().walletBehavior,
        get().backgroundTasks.swapPoll,
      );
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
      await maybeEnsureLightning(
        draft,
        get().walletBehavior,
        get().backgroundTasks.swapPoll,
      );
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

  refreshWallet: () => {
    if (refreshInFlight) {
      refreshPending = true;
      return refreshInFlight;
    }

    const refreshWalletOnce = async () => {
      const metadata = get().wallet;
      if (!metadata) return;
      const snapshot = await refreshWalletSnapshot(
        metadata,
        get().walletBehavior,
      );
      await maybeEnsureLightning(
        metadata,
        get().walletBehavior,
        get().backgroundTasks.swapPoll,
      );
      // Do NOT call `refreshSwapsStatus()` here. The foreground SwapManager
      // (WS + 30s periodic poll + fallback polling on WS drop) already keeps
      // every monitored swap's status fresh in the local repo. `refreshWallet`
      // is the universal target for swap-event-driven refreshes (debounced via
      // `setSwapEventListener`), every send op, and pull-to-refresh — adding a
      // per-swap HTTP poll here storms Boltz on each event without adding
      // information the SwapManager hasn't already saved. The resume path keeps
      // an explicit `refreshSwapsStatus()` because at resume time the WS may
      // not yet be connected.
      const activities = await buildActivities(
        metadata.id,
        snapshot.activities,
        get().network.detectedNetwork ?? metadata.network,
      );
      const current = get().wallet;
      if (!current || current.id !== metadata.id) return;
      set({ wallet: applySnapshot(current, snapshot, activities) });
      await persist(get());
    };

    refreshInFlight = (async () => {
      let lastError: unknown = null;
      do {
        refreshPending = false;
        try {
          await refreshWalletOnce();
          lastError = null;
        } catch (e) {
          lastError = e;
        }
      } while (refreshPending);
      if (lastError) throw lastError;
    })().finally(() => {
      refreshInFlight = null;
    });

    return refreshInFlight;
  },

  resumeLightning: async (trigger) => {
    const metadata = get().wallet;
    if (!metadata) return;
    if (get().security.isLocked) return;
    if (!isLightningSupportedForNetwork(metadata.network)) return;
    if (lightningResumeInFlight) return lightningResumeInFlight;

    const run = (async () => {
      const startedAt = Date.now();
      let resumeState: LightningResumeState;
      let shouldMarkDirty = false;

      try {
        const summary = await resumeLightningSwaps({
          metadata,
          behavior: get().walletBehavior,
          trigger,
          swapBackgroundEnabled: get().backgroundTasks.swapPoll,
          notificationPrefs: get().preferences.notifications,
        });
        resumeState = lightningResumeStateFromSummary(summary);
        shouldMarkDirty =
          resumeState.restoredCount +
            resumeState.updatedCount +
            resumeState.claimedCount +
            resumeState.refundedCount >
          0;
      } catch (e) {
        const message =
          e instanceof Error ? e.message : "Lightning resume failed";
        recordError("lightning", `resume_failed: ${message}`);
        resumeState = failedLightningResumeState(trigger, startedAt, message);
      }

      try {
        await get().refreshWallet();
      } catch (e) {
        const message =
          e instanceof Error ? e.message : "Wallet refresh after resume failed";
        recordError("lightning", `resume_refresh_failed: ${message}`);
        resumeState = appendLightningResumeError(resumeState, message);
      }

      const after = get().wallet;
      if (!after || after.id !== metadata.id) return;
      if (shouldMarkDirty) markDirtyForBackup();
      set({
        wallet: {
          ...after,
          lightningResume: resumeState,
        },
      });
      await persist(get());
    })();

    const inFlight = run.finally(() => {
      if (lightningResumeInFlight === inFlight) {
        lightningResumeInFlight = null;
      }
    });
    lightningResumeInFlight = inFlight;
    return inFlight;
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
    await get()
      .refreshWallet()
      .catch(() => {
        // ignore refresh failure; txId is still returned
      });
    return txId;
  },

  sendLightning: async (invoice, amountSats, flow) => {
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
    await maybeEnsureLightning(
      metadata,
      get().walletBehavior,
      get().backgroundTasks.swapPoll,
    );
    const response = await sendLightningPayment({ invoice });
    try {
      const swapId = response.swapId;
      if (swapId) {
        await recordSwapMetadata({
          swapId,
          walletId: metadata.id,
          direction: "out",
          createdForFlow: flow ?? "send",
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
    await get()
      .refreshWallet()
      .catch(() => {
        // refresh failure; ignore
      });
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

    await get()
      .refreshWallet()
      .catch(() => {
        // refresh failure; ignore — txId is still returned
      });
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

    await maybeEnsureLightning(
      metadata,
      get().walletBehavior,
      get().backgroundTasks.swapPoll,
    );

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

    await get()
      .refreshWallet()
      .catch(() => {
        // refresh failure; offchain leg is still confirmed locally
      });

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

  setBackgroundTaskEnabled: async (taskKey, enabled) => {
    const current = get().backgroundTasks;
    if (current[taskKey] === enabled) return;
    const descriptor = BACKGROUND_TASK_DESCRIPTORS[taskKey];
    set({ backgroundTasks: { ...current, [taskKey]: enabled } });
    await persist(get());
    try {
      if (enabled) {
        await descriptor.register();
      } else {
        await descriptor.unregister();
      }
    } catch (e) {
      recordError(
        "lightning",
        `background_task_toggle_failed: ${taskKey}=${enabled}: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
    }
  },

  lockWallet: async () => {
    // Lock is purely UI gating. Do NOT dispose Lightning here:
    // ExpoArkadeSwaps.dispose unregisters the OS swap-poll background task,
    // which would silently kill background polling until the next unlock.
    // The in-process wallet is kept too because the Lightning instance holds
    // a reference to it and would crash on swap events otherwise.
    invalidateVtxoSnapshotCache();
    set((s) => ({
      security: { ...s.security, isLocked: true },
    }));
    await persist(get());
  },

  unlockWithPassword: async (password) => {
    const { security } = get();
    if (!security.passwordHash || !security.passwordSalt) return false;
    const hash = await hashPassword(password, security.passwordSalt);
    if (!timingSafeEqual(hash, security.passwordHash)) return false;
    set({ security: { ...security, isLocked: false } });
    await persist(get());
    scheduleLightningResume("unlock");
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
        scheduleLightningResume("unlock");
        return true;
      }
      return false;
    } catch {
      return false;
    }
  },

  resetWallet: async () => {
    invalidateVtxoSnapshotCache();
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
    try {
      await clearSwapBackgroundState();
    } catch {
      // best-effort cleanup
    }
    try {
      await clearAssetMetadata();
    } catch {
      // best-effort cleanup
    }
    try {
      await clearIconApprovals();
    } catch {
      // best-effort cleanup
    }
    await clearPersistedErrors();
    set({
      ...DEFAULT_STATE,
      _hydrated: true,
      recoveringIds: new Set<string>(),
      rowErrors: {},
    });
    await AsyncStorage.removeItem(STORAGE_KEY);
    await clearLegacyStorage();
  },

  getPendingLightningSwapCount: async () => {
    const metadata = get().wallet;
    if (!metadata) return 0;
    if (!isLightningSupportedForNetwork(metadata.network)) return 0;
    try {
      await maybeEnsureLightning(
        metadata,
        get().walletBehavior,
        get().backgroundTasks.swapPoll,
      );
      return await getNonTerminalSwapCount();
    } catch {
      return 0;
    }
  },

  scanRecoveryState: async () => {
    const metadata = get().wallet;
    if (!metadata) {
      return {
        ...EMPTY_RECOVERY_SCAN,
        scannedAt: Date.now(),
        reason: "No active wallet",
      };
    }
    if (get().security.isLocked) {
      return {
        ...EMPTY_RECOVERY_SCAN,
        scannedAt: Date.now(),
        reason: "Unlock the wallet to scan for recoverable state",
      };
    }
    const behavior = get().walletBehavior;
    const swapBackgroundEnabled = get().backgroundTasks.swapPoll;
    return scanRecoveryStateService({
      metadata,
      activities: metadata.activities,
      ensureWallet: async () => {
        await ensureWallet({ metadata, behavior });
        if (isLightningSupportedForNetwork(metadata.network)) {
          await ensureLightning({ metadata, behavior, swapBackgroundEnabled });
        }
      },
    });
  },

  runRecoveryAction: async (action, itemId, item) => {
    const metadata = get().wallet;
    if (!metadata) {
      return {
        ...EMPTY_RECOVERY_SCAN,
        scannedAt: Date.now(),
        reason: "No active wallet",
      };
    }
    if (get().security.isLocked) {
      return {
        ...EMPTY_RECOVERY_SCAN,
        scannedAt: Date.now(),
        reason: "Unlock the wallet to run recovery actions",
      };
    }
    set((s) => ({
      recoveringIds: setRecoveringId(s.recoveringIds, itemId, true),
      rowErrors: setRowError(s.rowErrors, itemId, null),
    }));

    let rowError: RecoveryRowError | null = null;
    let actedSuccessfully = false;
    try {
      switch (action) {
        case "refresh_status":
        case "support_bundle":
        case "claim_reverse_vhtlc": {
          // No mutation in v1 — refresh is the only side effect; the
          // support-bundle button is purely a UI hand-off but we treat it
          // here so the store stays the single source of per-row state.
          await refreshSwapsStatus();
          actedSuccessfully = true;
          break;
        }
        case "recover_submarine_vhtlc": {
          const swapId = item?.swapId;
          if (!swapId) {
            rowError = {
              type: "message",
              message: "Missing swap id for recovery",
            };
            break;
          }
          if (await isSwapBeingProcessed(swapId)) {
            rowError = {
              type: "message",
              message:
                "Background swap manager is already acting on this swap. Refresh and retry.",
            };
            break;
          }
          try {
            const lookup = await lookupSubmarineRecovery(swapId);
            if (!lookup) {
              rowError = {
                type: "message",
                message: "Swap is no longer in the local repository",
              };
              break;
            }
            if (lookup.info.status !== "recoverable") {
              rowError = {
                type: "message",
                message: `Swap is not recoverable now (${lookup.info.status})`,
              };
              break;
            }
            const outcome = await runSubmarineRecovery(lookup.swap);
            if (outcome.swept > 0) {
              actedSuccessfully = true;
            } else if (outcome.skipped > 0) {
              rowError = { type: "deferred_locktime" };
            } else {
              rowError = {
                type: "message",
                message: "Nothing was swept; try again later.",
              };
            }
          } catch (e) {
            recordError(
              "swap",
              `recovery_submarine_failed: ${e instanceof Error ? e.message : String(e)}`,
            );
            rowError = rowErrorFromException(e);
          }
          break;
        }
        case "refund_chain_ark": {
          const swapId = item?.swapId;
          if (!swapId) {
            rowError = {
              type: "message",
              message: "Missing swap id for refund",
            };
            break;
          }
          if (await isSwapBeingProcessed(swapId)) {
            rowError = {
              type: "message",
              message:
                "Background swap manager is already acting on this swap. Refresh and retry.",
            };
            break;
          }
          try {
            await refundChainSwapById(swapId);
            actedSuccessfully = true;
          } catch (e) {
            recordError(
              "swap",
              `recovery_chain_refund_failed: ${e instanceof Error ? e.message : String(e)}`,
            );
            rowError = rowErrorFromException(e);
          }
          break;
        }
        case "finalize_pending_tx": {
          const arkTxid = item?.arkTxid;
          if (!arkTxid) {
            rowError = {
              type: "message",
              message: "Missing arkTxid for finalization",
            };
            break;
          }
          try {
            await finalizePendingTx(arkTxid);
            actedSuccessfully = true;
          } catch (e) {
            recordError(
              "swap",
              `recovery_finalize_failed: ${e instanceof Error ? e.message : String(e)}`,
            );
            rowError = rowErrorFromException(e);
          }
          break;
        }
      }
    } finally {
      set((s) => ({
        recoveringIds: setRecoveringId(s.recoveringIds, itemId, false),
        rowErrors:
          rowError != null
            ? setRowError(s.rowErrors, itemId, rowError)
            : s.rowErrors,
      }));
    }

    if (actedSuccessfully) {
      try {
        await refreshSwapsStatus();
      } catch {
        // best-effort
      }
      try {
        await get().refreshWallet();
      } catch {
        // best-effort
      }
      // Mutating swap actions fire SwapManager events whose listener already
      // calls markDirtyForBackup; refresh-only actions must not flip the flag.
    }

    try {
      return await get().scanRecoveryState();
    } catch (e) {
      recordError(
        "swap",
        `recovery_rescan_failed: ${e instanceof Error ? e.message : String(e)}`,
      );
      return {
        ...EMPTY_RECOVERY_SCAN,
        scannedAt: Date.now(),
        reason: "Could not refresh recovery state — try again",
      };
    }
  },

  clearRecoveryRowError: (itemId) => {
    set((s) => ({ rowErrors: setRowError(s.rowErrors, itemId, null) }));
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
      importedAssetIds: get().assets.importedAssetIds,
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

    // Backup's `wallet.network` is the source of truth. We derive the Ark
    // server URL from it; the backup's saved `wallet.arkServerUrl` is legacy
    // diagnostic data now that custom servers are gone.
    const backupNetwork = payload.wallet.network;
    const arkServerUrl =
      backupNetwork === "bitcoin"
        ? MAINNET_ARK_SERVER_URL
        : backupNetwork === "mutinynet"
          ? MUTINYNET_ARK_SERVER_URL
          : null;
    if (!arkServerUrl) {
      throw new ArkadeError(
        "wallet_init_failed",
        `Backup references unsupported network "${backupNetwork}"`,
      );
    }

    let probed: Awaited<ReturnType<typeof probeServer>>;
    try {
      probed = await probeServer(arkServerUrl);
    } catch (e) {
      throw toArkadeError(
        "server_unreachable",
        "Could not reach Arkade server",
        e,
      );
    }
    const serverNetwork = probed.network;
    if (serverNetwork !== backupNetwork) {
      throw new ArkadeError(
        "wallet_init_failed",
        `Network mismatch: backup is for ${backupNetwork} but server reports ${serverNetwork}`,
      );
    }

    const isMainnet = isMainnetForNetworkName(serverNetwork);
    const artifacts =
      payload.secret.kind === "mnemonic"
        ? buildMnemonicIdentity(payload.secret.mnemonic, isMainnet)
        : buildSingleKeyIdentityFromHex(payload.secret.privateKeyHex);

    const walletId = payload.wallet.id;
    const normalizedPreferences = normalizePreferences(payload.preferences);
    const restoredAssetsSlice: AssetsSlice = normalizeAssetsSlice({
      importedAssetIds: payload.importedAssetIds ?? [],
    });

    // Track external side-effects so we can roll back on failure. Until we
    // call the final `set()`, the persisted Zustand slice is untouched.
    let secretSaved = false;
    let swapMetadataRestored = false;
    let walletRuntimeCreated = false;
    try {
      await saveSecret(walletId, payload.secret);
      secretSaved = true;
      await restoreSwapMetadataRows(payload.swapMetadata);
      swapMetadataRestored = true;
      await restoreBoltzSwaps(payload.boltzSwaps);

      // Mark the runtime as "needs disposal" before the call: createWalletInstance
      // mutates the module-level runtime cache (activeWalletInstance/subscription)
      // before snapshotWallet returns, so a snapshot failure must still trigger
      // disposeWallet() in the catch below. Safe because the import branch is
      // guarded by `!get().wallet` and disposeWallet() is idempotent.
      walletRuntimeCreated = true;
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
        undefined,
        serverNetwork,
        artifacts,
        snapshot,
        snapshot.activities,
      );
      const restored: ArkadeWalletMetadata = {
        ...draft,
        label: payload.wallet.label,
      };
      await maybeEnsureLightning(
        restored,
        payload.walletBehavior,
        get().backgroundTasks.swapPoll,
      );
      const activities = await buildActivities(
        walletId,
        snapshot.activities,
        serverNetwork,
      );
      const metadata: ArkadeWalletMetadata = { ...restored, activities };

      // Atomic commit: all import work succeeded, write the final slice once.
      set((s) => ({
        wallet: metadata,
        assets: restoredAssetsSlice,
        walletBehavior: payload.walletBehavior,
        preferences: normalizedPreferences,
        security: {
          ...s.security,
          lastBackupAt: envelope.createdAt,
          dirtyForBackup: false,
        },
        network: {
          ...s.network,
          arkServerUrl,
          status: "online",
          detectedNetwork: serverNetwork,
          lastError: null,
          serverInfo: probed,
        },
      }));
      await persist(get());

      // Post-commit work — must not roll back an otherwise successful import.
      if (isLightningSupportedForNetwork(serverNetwork)) {
        scheduleLightningRestore(walletId);
      }
    } catch (e) {
      if (walletRuntimeCreated) {
        await disposeWallet().catch(() => {});
      }
      if (swapMetadataRestored) {
        await clearSwapMetadataForWallet(walletId).catch(() => {});
        await clearAllSwaps().catch(() => {});
      }
      if (secretSaved) {
        await deleteSecret(walletId).catch(() => {});
      }
      if (e instanceof BackupError || e instanceof PayloadParseError) throw e;
      if (e instanceof ArkadeError) throw e;
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
      return { hasBackupMaterial: false, lastBackupAt, isStale: false };
    }
    const [metaTs, boltzTs] = await Promise.all([
      getLatestSwapMetadataWriteAt(metadata.id).catch(() => null),
      getLatestBoltzSwapWriteAt().catch(() => null),
    ]);
    const hasSwapMaterial = metaTs != null || boltzTs != null;
    const importedAssetIds = get().assets.importedAssetIds;
    const hasBackupMaterial = hasSwapMaterial || importedAssetIds.length > 0;
    const dirty = get().security.dirtyForBackup === true;
    const latest = Math.max(metaTs ?? 0, boltzTs ?? 0);
    // An existing backup goes stale whenever something dirtied the state
    // since the last export — even if the current material set is empty
    // (e.g. user forgot the last imported asset, or swept all swaps). The
    // backup file still references state that the wallet no longer
    // matches, so the warning has to fire regardless of `hasBackupMaterial`.
    const isStale =
      (lastBackupAt != null && dirty) ||
      (hasBackupMaterial && (lastBackupAt == null || lastBackupAt < latest));
    return { hasBackupMaterial, lastBackupAt, isStale };
  },

  importAsset: async (assetId) => {
    if (!isValidAssetId(assetId)) {
      throw new ArkadeError(
        "send_failed",
        "Asset id is not a valid 68-character hex string",
      );
    }
    const current = get().assets.importedAssetIds;
    if (current.includes(assetId)) return;
    set((s) => ({
      assets: { importedAssetIds: [...s.assets.importedAssetIds, assetId] },
    }));
    markDirtyForBackup();
    await persist(get());
  },

  forgetAsset: async (assetId) => {
    const current = get().assets.importedAssetIds;
    if (!current.includes(assetId)) return;
    set((s) => ({
      assets: {
        importedAssetIds: s.assets.importedAssetIds.filter(
          (id) => id !== assetId,
        ),
      },
    }));
    markDirtyForBackup();
    await persist(get());
  },

  sendAsset: async (address, assetId, amount) => {
    const metadata = get().wallet;
    if (!metadata) {
      throw new ArkadeError("wallet_not_ready", "No wallet available");
    }
    if (!isValidAssetId(assetId)) {
      throw new ArkadeError("send_failed", "Invalid asset id");
    }
    if (amount <= 0n) {
      throw new ArkadeError("send_failed", "Amount must be greater than zero");
    }
    const balanceEntry = metadata.assetBalances.find(
      (a) => a.assetId === assetId,
    );
    const have = balanceEntry ? BigInt(balanceEntry.amount) : 0n;
    if (amount > have) {
      throw new ArkadeError(
        "insufficient_balance",
        "Insufficient asset balance for this amount",
      );
    }
    const wallet = await ensureWallet({
      metadata,
      behavior: get().walletBehavior,
    });
    let txId: string;
    try {
      txId = await wallet.send({
        address,
        assets: [{ assetId, amount }],
      });
    } catch (e) {
      throw toArkadeError("send_failed", "Asset send failed", e);
    }
    await get()
      .refreshWallet()
      .catch(() => {
        // ignore refresh failure; txId is still returned
      });
    return txId;
  },

  issueAsset: async (input) => {
    const metadata = get().wallet;
    if (!metadata) {
      throw new ArkadeError("wallet_not_ready", "No wallet available");
    }
    if (input.amount <= 0n) {
      throw new ArkadeError("send_failed", "Amount must be greater than zero");
    }
    const wallet = await ensureWallet({
      metadata,
      behavior: get().walletBehavior,
    });
    const mode = input.controlMode ?? "none";
    let controlAssetId = input.controlAssetId;
    try {
      if (mode === "new") {
        const control = await wallet.assetManager.issue({ amount: 1n });
        controlAssetId = control.assetId;
        await markSelfIssued(control.assetId);
      }
      const metadataObj: Record<string, unknown> = {};
      if (input.name) metadataObj.name = input.name;
      if (input.ticker) metadataObj.ticker = input.ticker;
      if (typeof input.decimals === "number") {
        metadataObj.decimals = input.decimals;
      }
      if (input.icon) metadataObj.icon = input.icon;
      const result = await wallet.assetManager.issue({
        amount: input.amount,
        controlAssetId,
        metadata:
          Object.keys(metadataObj).length > 0
            ? (metadataObj as Parameters<
                typeof wallet.assetManager.issue
              >[0]["metadata"])
            : undefined,
      });
      await markSelfIssued(result.assetId);
      const ids = get().assets.importedAssetIds;
      if (!ids.includes(result.assetId)) {
        set((s) => ({
          assets: {
            importedAssetIds: [...s.assets.importedAssetIds, result.assetId],
          },
        }));
        markDirtyForBackup();
        await persist(get());
      }
      await get()
        .refreshWallet()
        .catch(() => {
          // ignore refresh failure
        });
      return result;
    } catch (e) {
      throw toArkadeError("send_failed", "Asset issuance failed", e);
    }
  },

  reissueAsset: async (assetId, amount) => {
    const metadata = get().wallet;
    if (!metadata) {
      throw new ArkadeError("wallet_not_ready", "No wallet available");
    }
    if (amount <= 0n) {
      throw new ArkadeError("send_failed", "Amount must be greater than zero");
    }
    if (!isValidAssetId(assetId)) {
      throw new ArkadeError("send_failed", "Invalid asset id");
    }
    const wallet = await ensureWallet({
      metadata,
      behavior: get().walletBehavior,
    });
    let arkTxId: string;
    try {
      arkTxId = await wallet.assetManager.reissue({ assetId, amount });
    } catch (e) {
      throw toArkadeError("send_failed", "Asset reissue failed", e);
    }
    await get()
      .refreshWallet()
      .catch(() => {});
    return arkTxId;
  },

  burnAsset: async (assetId, amount) => {
    const metadata = get().wallet;
    if (!metadata) {
      throw new ArkadeError("wallet_not_ready", "No wallet available");
    }
    if (amount <= 0n) {
      throw new ArkadeError("send_failed", "Amount must be greater than zero");
    }
    if (!isValidAssetId(assetId)) {
      throw new ArkadeError("send_failed", "Invalid asset id");
    }
    const balanceEntry = get().wallet?.assetBalances.find(
      (a) => a.assetId === assetId,
    );
    const have = balanceEntry ? BigInt(balanceEntry.amount) : 0n;
    if (amount > have) {
      throw new ArkadeError(
        "insufficient_balance",
        "Insufficient asset balance to burn",
      );
    }
    const wallet = await ensureWallet({
      metadata,
      behavior: get().walletBehavior,
    });
    let arkTxId: string;
    try {
      arkTxId = await wallet.assetManager.burn({ assetId, amount });
    } catch (e) {
      throw toArkadeError("send_failed", "Asset burn failed", e);
    }
    await get()
      .refreshWallet()
      .catch(() => {});
    return arkTxId;
  },

  loadWalletVtxos: async (opts) => {
    const metadata = get().wallet;
    if (!metadata) {
      throw new ArkadeError("wallet_not_ready", "No wallet available");
    }
    if (get().security.isLocked) {
      throw new ArkadeError("wallet_not_ready", "Unlock the wallet first");
    }
    const maxAgeMs = opts?.maxAgeMs;
    if (
      maxAgeMs != null &&
      vtxoSnapshotCache &&
      vtxoSnapshotCache.walletId === metadata.id &&
      Date.now() - vtxoSnapshotCache.fetchedAt < maxAgeMs
    ) {
      return vtxoSnapshotCache.items;
    }
    const wallet = await ensureWallet({
      metadata,
      behavior: get().walletBehavior,
    });
    const dustSats = get().network.serverInfo?.dustSats ?? 0;
    const items = await loadVtxos(
      wallet,
      { includeRecoverable: true },
      dustSats,
    );
    vtxoSnapshotCache = {
      walletId: metadata.id,
      items,
      fetchedAt: Date.now(),
    };
    return items;
  },

  setTheme: async (theme) => {
    set((s) => ({
      preferences: { ...s.preferences, theme },
    }));
    await persist(get());
  },

  setFiatCurrency: async (currency) => {
    set((s) => ({
      preferences: { ...s.preferences, fiatCurrency: currency },
    }));
    await persist(get());
  },

  setBitcoinUnit: async (unit) => {
    set((s) => ({
      preferences: { ...s.preferences, bitcoinUnit: unit },
    }));
    await persist(get());
  },

  setNotificationPreferences: async (prefs) => {
    set((s) => ({
      preferences: {
        ...s.preferences,
        notifications: { ...s.preferences.notifications, ...prefs },
      },
    }));
    await persist(get());
  },

  setPassword: async (password) => {
    const salt = generateSalt();
    const hash = await hashPassword(password, salt);
    set((s) => ({
      security: { ...s.security, passwordHash: hash, passwordSalt: salt },
    }));
    await persist(get());
  },

  toggleBiometrics: async (enabled) => {
    set((s) => ({
      security: { ...s.security, biometricsEnabled: enabled },
    }));
    await persist(get());
  },
}));

// HMR safety: the previous module evaluation's listener stays live until its
// closure is GC'd, so without an explicit removal each Fast Refresh would
// stack another listener and multiply foreground resume calls. Stash the
// subscription on globalThis so re-evaluation can replace it.
//
// `inactive` is intentionally excluded from `wasBackgrounded` — iOS reports
// `inactive` for Control Center swipes, screenshots, and biometric prompts,
// none of which warrant a full resume pass.
type AppStateSubSlot = { __trixieAppStateSub?: { remove: () => void } };
const appStateSlot = globalThis as unknown as AppStateSubSlot;
appStateSlot.__trixieAppStateSub?.remove();

let nativeAppState: NativeAppStateStatus = NativeAppState.currentState;
appStateSlot.__trixieAppStateSub = NativeAppState.addEventListener(
  "change",
  (nextState) => {
    const wasBackgrounded = nativeAppState === "background";
    nativeAppState = nextState;
    if (wasBackgrounded && nextState === "active") {
      scheduleLightningResume("foreground");
    }
  },
);

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
      .catch((e) => {
        recordError(
          "swap",
          `refresh_after_swap_event_failed: ${e instanceof Error ? e.message : String(e)}`,
        );
      });
  }, 250);
});

// Refresh wallet snapshot + Activity list whenever the SDK reports newly
// received funds (boarding utxo or incoming vtxo). Coalesces bursts.
let incomingFundsRefreshTimer: ReturnType<typeof setTimeout> | null = null;
setIncomingFundsListener(() => {
  if (incomingFundsRefreshTimer) return;

  const prefs = useAppStore.getState().preferences.notifications;
  if (prefs.enabled && prefs.payments) {
    toastEmitter.show("Payment received", "success");
  }

  incomingFundsRefreshTimer = setTimeout(() => {
    incomingFundsRefreshTimer = null;
    useAppStore
      .getState()
      .refreshWallet()
      .catch((e) => {
        recordError(
          "wallet",
          `refresh_after_incoming_funds_failed: ${e instanceof Error ? e.message : String(e)}`,
        );
      });
  }, 250);
});
