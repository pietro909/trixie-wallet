import Constants from "expo-constants";
import { useAppStore } from "../../store/useAppStore";
import {
  getNonTerminalSwapCount,
  isLightningSupportedForNetwork,
  snapshotBoltzSwaps,
} from "../arkade/lightning";
import { fetchRawServerInfo } from "../arkade/runtime";
import { getAllSwapMetadata } from "../arkade/swap-storage";
import { type ErrorEntry, getRecentErrors, recordError } from "./recorder";

export const BUNDLE_SCHEMA_VERSION = 1 as const;

export type SupportBundle = {
  schemaVersion: typeof BUNDLE_SCHEMA_VERSION;
  /** ms since epoch when the bundle was assembled. */
  generatedAt: number;
  app: {
    version: string;
    sdkVersion: string | null;
    boltzSwapVersion: string | null;
    commit: string | null;
    tag: string | null;
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
  };
  errors: ErrorEntry[];
};

function readString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
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

export async function buildSupportBundle(): Promise<SupportBundle> {
  const state = useAppStore.getState();
  const wallet = state.wallet;
  const { sdkVersion, boltzSwapVersion, commit, tag, describe } = readExtra();

  const networkForLightning = wallet?.network ?? state.network.detectedNetwork;
  const lightningSupported =
    isLightningSupportedForNetwork(networkForLightning);

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

  return {
    schemaVersion: BUNDLE_SCHEMA_VERSION,
    generatedAt: Date.now(),
    app: {
      version: appVersionString(),
      sdkVersion,
      boltzSwapVersion,
      commit,
      tag: tag ?? describe,
    },
    storeSchemaVersion: state.schemaVersion,
    network: {
      arkServerUrl: state.network.arkServerUrl,
      detectedNetwork: state.network.detectedNetwork,
      status: state.network.status,
      lastError: state.network.lastError,
    },
    serverInfo,
    serverInfoFetchError,
    wallet: {
      present: wallet != null,
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
            lastError: wallet.lightningRestore.lastError ?? null,
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
    recovery: {
      lastBackupAt: state.security.lastBackupAt ?? null,
      dirtyForBackup: state.security.dirtyForBackup === true,
      activityCounts,
      swapMetadataCount,
      boltzSwapCounts,
      nonTerminalSwapCount,
    },
    errors: getRecentErrors(),
  };
}
