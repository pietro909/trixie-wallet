import type { SubmarineRecoveryInfo } from "@arkade-os/boltz-swap";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import { useAppStore } from "../../store/useAppStore";
import {
  canAttemptArkChainRefund,
  getLightning,
  getNonTerminalSwapCount,
  isLightningSupportedForNetwork,
  snapshotBoltzSwaps,
} from "../arkade/lightning";
import { discoverPendingTxs } from "../arkade/pending-tx-recovery";
import { fetchRawServerInfo, getWallet } from "../arkade/runtime";
import { SWAP_BACKGROUND_TASK_NAME } from "../arkade/swap-background";
import { getAllSwapMetadata } from "../arkade/swap-storage";
import { loadVtxos, type VtxoStatus } from "../arkade/vtxo-listing";
import { type BgTaskMetrics, readBgTaskMetrics } from "./bg-task-metrics";
import {
  type ErrorEntry,
  getRecentErrors,
  recordError,
  redactString,
} from "./recorder";

export const BUNDLE_SCHEMA_VERSION = 1 as const;

/**
 * Coarse, honest stages of `buildSupportBundle`. Each value is reported just
 * before the matching block of real async work begins, so the UI label tracks
 * actual lifecycle progress rather than a timer. Kept deliberately coarse —
 * the bundle assembles an in-memory snapshot, so finer granularity would be
 * dishonest (no DB export or compression happens). Ordered as emitted.
 */
export type BundleStage = "server" | "swaps" | "wallet" | "assembling";

export const BUNDLE_STAGE_LABEL: Record<BundleStage, string> = {
  server: "Contacting server…",
  swaps: "Collecting swap & recovery state…",
  wallet: "Reading wallet state…",
  assembling: "Assembling bundle…",
};

export type BundleProgress = (stage: BundleStage) => void;

export type SupportBundle = {
  schemaVersion: typeof BUNDLE_SCHEMA_VERSION;
  /** ms since epoch when the bundle was assembled. */
  generatedAt: number;
  app: {
    version: string;
    sdkVersion: string | null;
    boltzSwapVersion: string | null;
    commit: string | null;
    /** Release tag from git, if HEAD is on a tagged commit. */
    tag: string | null;
    /** `git describe` output, when the build is not on a clean release tag. */
    describe: string | null;
  };
  storeSchemaVersion: number;
  network: {
    arkServerUrl: string;
    detectedNetwork: string | null;
    status: string;
    lastError: string | null;
  };
  /** Fresh `/v1/info` snapshot. Null when the probe failed. */
  serverInfo: Record<string, unknown> | null;
  serverInfoFetchError: string | null;
  wallet: {
    present: boolean;
    id: string | null;
    label: string | null;
    network: string | null;
    identityKind: string | null;
    hasMnemonic: boolean;
    hasPrivateKey: boolean;
    esploraOverride: string | null;
    lightningSupported: boolean;
    lightningRestore: {
      lastAt: number;
      lastCount: number;
      lastError: string | null;
    } | null;
    lightningResume: {
      lastAt: number;
      lastFinishedAt: number;
      trigger: string;
      status: string;
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
      lastError: string | null;
    } | null;
  };
  walletBehavior: {
    vtxoAutoRenewal: boolean;
    delegatedRenewal: boolean;
  };
  preferences: {
    theme: string;
    fiatCurrency: string;
    bitcoinUnit: string;
  };
  /**
   * Redacted asset overview. No raw asset ids (privacy parity with swap ids).
   * Counts only, so support can see whether the wallet is asset-aware without
   * inspecting per-asset balances.
   */
  assets: {
    importedAssetIdCount: number;
    nonZeroBalanceCount: number;
    cachedMetadataCount: number;
  };
  /**
   * Counts-only VTXO snapshot. No raw outpoints, txids, or scripts (privacy
   * parity with swap ids). `null` when the listing call failed — the
   * underlying error is recorded via the diagnostics recorder.
   */
  vtxos: {
    total: number;
    byStatus: Record<VtxoStatus, number>;
    dustSats: number;
    sweptSats: number;
    oldestCreatedAt: number | null;
    newestCreatedAt: number | null;
  } | null;
  recovery: {
    lastBackupAt: number | null;
    dirtyForBackup: boolean;
    /**
     * Activity counts grouped as `<rail>.<status>`. Empty rail becomes
     * `unknown.<status>`. No ids, titles, or amounts.
     */
    activityCounts: Record<string, number>;
    swapMetadataCount: number;
    /** Boltz swap counts grouped as `<type>.<status>`. */
    boltzSwapCounts: Record<string, number>;
    nonTerminalSwapCount: number;
    /**
     * Counts produced by the M9 recovery scanner, including hidden
     * `none` / `already_spent` submarine statuses. Keys mirror
     * `RecoveryScan.counts` (e.g. `submarine.recoverable`,
     * `submarine.pre_cltv`, `chain.refundable`, `pending_finalize`,
     * `arkade_settlement`). No swap ids or arkTxids.
     */
    recoveryCounts: Record<string, number>;
    /** Number of pending Arkade tx rows reported by the server. Just the count. */
    pendingFinalizeCount: number;
    /** Sticky-error counter when a category collection failed. */
    recoveryScanErrors: Record<string, string>;
    swapManager: {
      isRunning: boolean;
      monitoredSwaps: number;
      websocketConnected: boolean;
      usePollingFallback: boolean;
    } | null;
  };
  backgroundTasks: {
    swapPoll: BgTaskMetrics;
  };
  errors: ErrorEntry[];
};

function readString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function redactNullable(value: string | null | undefined): string | null {
  if (value == null) return null;
  return redactString(value);
}

function readExtra(): {
  sdkVersion: string | null;
  boltzSwapVersion: string | null;
  commit: string | null;
  tag: string | null;
  describe: string | null;
} {
  const extra = (Constants.expoConfig?.extra ?? {}) as Record<string, unknown>;
  const versions = (extra.versions ?? {}) as Record<string, unknown>;
  const git = (extra.git ?? {}) as Record<string, unknown>;
  return {
    sdkVersion: readString(versions.sdk),
    boltzSwapVersion: readString(versions.boltzSwap),
    commit: readString(git.commit),
    tag: readString(git.tag),
    describe: readString(git.describe),
  };
}

function appVersionString(): string {
  const cfg = Constants.expoConfig as { version?: string } | null;
  return cfg?.version ?? "unknown";
}

/**
 * Sum of cache entries across every network-scoped asset metadata key. Errors
 * (parse failures, missing keys) are swallowed; the support bundle should not
 * fail because of a malformed cache.
 */
async function countCachedAssetMetadata(): Promise<number> {
  try {
    const keys = await AsyncStorage.getAllKeys();
    const cacheKeys = keys.filter((k) =>
      k.startsWith("trixie:asset-metadata:"),
    );
    if (cacheKeys.length === 0) return 0;
    const entries = await AsyncStorage.getMany(cacheKeys);
    let total = 0;
    for (const raw of Object.values(entries)) {
      if (!raw) continue;
      try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          total += Object.keys(parsed).length;
        }
      } catch {
        // ignore
      }
    }
    return total;
  } catch {
    return 0;
  }
}

export async function buildSupportBundle(
  onProgress?: BundleProgress,
): Promise<SupportBundle> {
  const state = useAppStore.getState();
  const wallet = state.wallet;
  const { sdkVersion, boltzSwapVersion, commit, tag, describe } = readExtra();

  const networkForLightning = wallet?.network ?? state.network.detectedNetwork;
  const lightningSupported =
    isLightningSupportedForNetwork(networkForLightning);

  onProgress?.("server");
  let serverInfo: Record<string, unknown> | null = null;
  let serverInfoFetchError: string | null = null;
  try {
    serverInfo = await fetchRawServerInfo(state.network.arkServerUrl);
  } catch (e) {
    serverInfoFetchError =
      e instanceof Error ? e.message : "Could not fetch server info";
    recordError(
      "server",
      `bundle_server_probe_failed: ${serverInfoFetchError}`,
    );
  }

  const activityCounts: Record<string, number> = {};
  if (wallet) {
    for (const a of wallet.activities) {
      const rail = a.rail ?? "unknown";
      const key = `${rail}.${a.status}`;
      activityCounts[key] = (activityCounts[key] ?? 0) + 1;
    }
  }

  onProgress?.("swaps");
  let swapMetadataCount = 0;
  if (wallet) {
    try {
      const rows = await getAllSwapMetadata(wallet.id);
      swapMetadataCount = rows.length;
    } catch (e) {
      recordError(
        "swap",
        `bundle_swap_metadata_count_failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  const boltzSwapCounts: Record<string, number> = {};
  let nonTerminalSwapCount = 0;
  if (lightningSupported) {
    try {
      const swaps = await snapshotBoltzSwaps();
      for (const s of swaps) {
        const key = `${s.type}.${s.status}`;
        boltzSwapCounts[key] = (boltzSwapCounts[key] ?? 0) + 1;
        if (s.type === "chain") {
          const mk = canAttemptArkChainRefund(s)
            ? "chain.material.complete"
            : "chain.material.incomplete";
          boltzSwapCounts[mk] = (boltzSwapCounts[mk] ?? 0) + 1;
        }
      }
    } catch (e) {
      recordError(
        "swap",
        `bundle_boltz_snapshot_failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    try {
      nonTerminalSwapCount = await getNonTerminalSwapCount();
    } catch {
      // best-effort; fall back to 0
    }
  }

  const recoveryCounts: Record<string, number> = {};
  const recoveryScanErrors: Record<string, string> = {};
  let swapManagerStats: SupportBundle["recovery"]["swapManager"] = null;
  let pendingFinalizeCount = 0;
  if (lightningSupported) {
    let submarineRecovery: SubmarineRecoveryInfo[] = [];
    let lightning: Awaited<ReturnType<typeof getLightning>> | null = null;
    try {
      lightning = await getLightning();
    } catch (e) {
      recoveryScanErrors.lightning = redactString(
        e instanceof Error ? e.message : "lightning unavailable",
      );
    }
    if (lightning) {
      try {
        submarineRecovery = await lightning.scanRecoverableSubmarineSwaps();
        for (const info of submarineRecovery) {
          const key = `submarine.${info.status}`;
          recoveryCounts[key] = (recoveryCounts[key] ?? 0) + 1;
        }
      } catch (e) {
        recoveryScanErrors.submarine = redactString(
          e instanceof Error ? e.message : "submarine scan failed",
        );
      }
      try {
        const manager = lightning.getSwapManager();
        if (manager) {
          const stats = await manager.getStats();
          swapManagerStats = {
            isRunning: stats.isRunning,
            monitoredSwaps: stats.monitoredSwaps,
            websocketConnected: stats.websocketConnected,
            usePollingFallback: stats.usePollingFallback,
          };
        }
      } catch (e) {
        recoveryScanErrors.swapManager = redactString(
          e instanceof Error ? e.message : "swap manager stats unavailable",
        );
      }
    }
  }
  try {
    const pending = await discoverPendingTxs();
    pendingFinalizeCount = pending.length;
    if (pendingFinalizeCount > 0) {
      recoveryCounts.pending_finalize = pendingFinalizeCount;
    }
  } catch (e) {
    recoveryScanErrors.pending_finalize = redactString(
      e instanceof Error ? e.message : "pending tx discovery failed",
    );
  }
  if (wallet) {
    let settlementAnomalies = 0;
    let settlementAssetSkips = 0;
    const assetActivityCounts: Record<string, number> = {};
    for (const a of wallet.activities) {
      if (a.source.type === "wallet_event" && a.title === "Arkade settlement") {
        const unresolved = a.metadata?.unresolvedAmountSats;
        if (typeof unresolved === "number" && unresolved !== 0) {
          if (a.metadata?.settlementReason === "asset_bearing_settlement") {
            settlementAssetSkips += 1;
          } else {
            settlementAnomalies += 1;
          }
        }
      }
      const cls = a.metadata?.classification;
      if (typeof cls === "string" && cls.startsWith("asset_")) {
        assetActivityCounts[cls] = (assetActivityCounts[cls] ?? 0) + 1;
      }
    }
    if (settlementAnomalies > 0) {
      recoveryCounts.arkade_settlement = settlementAnomalies;
    }
    if (settlementAssetSkips > 0) {
      recoveryCounts.arkade_settlement_skipped_asset = settlementAssetSkips;
    }
    for (const [k, v] of Object.entries(assetActivityCounts)) {
      recoveryCounts[`activity_${k}`] = v;
    }
  }

  onProgress?.("wallet");
  const swapPollMetrics = await readBgTaskMetrics(SWAP_BACKGROUND_TASK_NAME);

  let vtxoSummary: SupportBundle["vtxos"] = null;
  if (wallet) {
    try {
      const liveWallet = await getWallet();
      const dustSats = state.network.serverInfo?.dustSats ?? 0;
      const classified = await loadVtxos(
        liveWallet,
        { includeRecoverable: true },
        dustSats,
      );
      const byStatus: Record<VtxoStatus, number> = {
        settled: 0,
        preconfirmed: 0,
        swept: 0,
        subdust: 0,
        spent: 0,
      };
      let dustSum = 0;
      let sweptSum = 0;
      let oldest: number | null = null;
      let newest: number | null = null;
      for (const v of classified) {
        byStatus[v.status] += 1;
        if (v.status === "subdust") dustSum += v.amountSats;
        if (v.status === "swept") sweptSum += v.amountSats;
        const ts = v.createdAt.getTime();
        if (oldest == null || ts < oldest) oldest = ts;
        if (newest == null || ts > newest) newest = ts;
      }
      vtxoSummary = {
        total: classified.length,
        byStatus,
        dustSats: dustSum,
        sweptSats: sweptSum,
        oldestCreatedAt: oldest,
        newestCreatedAt: newest,
      };
    } catch (e) {
      recordError(
        "wallet",
        `bundle_vtxo_summary_failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  onProgress?.("assembling");
  return {
    schemaVersion: BUNDLE_SCHEMA_VERSION,
    generatedAt: Date.now(),
    app: {
      version: appVersionString(),
      sdkVersion,
      boltzSwapVersion,
      commit,
      tag,
      describe,
    },
    storeSchemaVersion: state.schemaVersion,
    network: {
      arkServerUrl: state.network.arkServerUrl,
      detectedNetwork: state.network.detectedNetwork,
      status: state.network.status,
      lastError: redactNullable(state.network.lastError),
    },
    serverInfo,
    serverInfoFetchError: redactNullable(serverInfoFetchError),
    wallet: {
      present: wallet != null,
      id: wallet?.id ?? null,
      label: wallet?.label ?? null,
      network: wallet?.network ?? null,
      identityKind: wallet?.identityKind ?? null,
      hasMnemonic: wallet?.backup.hasMnemonic ?? false,
      hasPrivateKey: wallet?.backup.hasPrivateKey ?? false,
      esploraOverride: wallet?.esploraUrl ?? null,
      lightningSupported,
      lightningRestore: wallet?.lightningRestore
        ? {
            lastAt: wallet.lightningRestore.lastAt,
            lastCount: wallet.lightningRestore.lastCount,
            lastError: redactNullable(wallet.lightningRestore.lastError),
          }
        : null,
      lightningResume: wallet?.lightningResume
        ? {
            lastAt: wallet.lightningResume.lastAt,
            lastFinishedAt: wallet.lightningResume.lastFinishedAt,
            trigger: wallet.lightningResume.trigger,
            status: wallet.lightningResume.status,
            restoredCount: wallet.lightningResume.restoredCount,
            reverseCount: wallet.lightningResume.reverseCount,
            submarineCount: wallet.lightningResume.submarineCount,
            chainCount: wallet.lightningResume.chainCount,
            polledCount: wallet.lightningResume.polledCount,
            updatedCount: wallet.lightningResume.updatedCount,
            claimedCount: wallet.lightningResume.claimedCount,
            refundedCount: wallet.lightningResume.refundedCount,
            errorCount: wallet.lightningResume.errorCount,
            nonTerminalCount: wallet.lightningResume.nonTerminalCount,
            lastError: redactNullable(wallet.lightningResume.lastError),
          }
        : null,
    },
    walletBehavior: {
      vtxoAutoRenewal: state.walletBehavior.vtxoAutoRenewal,
      delegatedRenewal: state.walletBehavior.delegatedRenewal,
    },
    preferences: {
      theme: state.preferences.theme,
      fiatCurrency: state.preferences.fiatCurrency,
      bitcoinUnit: state.preferences.bitcoinUnit,
    },
    assets: {
      importedAssetIdCount: state.assets.importedAssetIds.length,
      nonZeroBalanceCount: (wallet?.assetBalances ?? []).filter((b) => {
        try {
          return BigInt(b.amount) !== 0n;
        } catch {
          return false;
        }
      }).length,
      cachedMetadataCount: await countCachedAssetMetadata(),
    },
    vtxos: vtxoSummary,
    recovery: {
      lastBackupAt: state.security.lastBackupAt ?? null,
      dirtyForBackup: state.security.dirtyForBackup === true,
      activityCounts,
      swapMetadataCount,
      boltzSwapCounts,
      nonTerminalSwapCount,
      recoveryCounts,
      pendingFinalizeCount,
      recoveryScanErrors,
      swapManager: swapManagerStats,
    },
    backgroundTasks: {
      swapPoll: swapPollMetrics,
    },
    errors: getRecentErrors(),
  };
}
