import {
  type BoltzChainSwap,
  type BoltzReverseSwap,
  type BoltzSubmarineSwap,
  type BoltzSwap,
  isChainFinalStatus,
  isChainSwapRefundable,
  isReverseFinalStatus,
  isSubmarineFinalStatus,
  type SubmarineRecoveryInfo,
  type SubmarineRecoveryStatus,
} from "@arkade-os/boltz-swap";
import type { Activity, ArkadeWalletMetadata } from "../../store/types";
import { recordError } from "../diagnostics/recorder";
import { toArkadeError } from "./errors";
import {
  getLightning,
  getLightningActivitySources,
  isLightningSupportedForNetwork,
  refreshSwapsStatus,
} from "./lightning";
import { discoverPendingTxs, type PendingTx } from "./pending-tx-recovery";
import type { LocalSwapMetadata } from "./swap-storage";

export type RecoverySeverity = "info" | "attention" | "actionable";

export type RecoveryActionKind =
  | "refresh_status"
  | "claim_reverse_vhtlc"
  | "recover_submarine_vhtlc"
  | "refund_chain_ark"
  | "finalize_pending_tx"
  | "support_bundle";

export type RecoveryItemType =
  | "reverse"
  | "submarine"
  | "chain"
  | "pending_finalize"
  | "arkade_settlement";

export type RecoveryLinkState =
  | "linked"
  | "unlinked"
  | "restored"
  | "not_applicable";

export type RecoveryItem = {
  /** Per-row key for `recoveringIds` / `rowErrors` maps. Stable per scan. */
  id: string;
  swapId?: string;
  arkTxid?: string;
  walletTxId?: string | null;
  paymentHash?: string | null;
  type: RecoveryItemType;
  title: string;
  /** SDK status string or a synthesized label (e.g. submarine "recoverable"). */
  status: string;
  severity: RecoverySeverity;
  /** ms since epoch. */
  createdAt: number;
  amountSats?: number;
  vtxoCount?: number;
  /** Unix-timestamp CLTV from the VHTLC, if known. */
  refundLocktime?: number;
  /** Pending-finalize rows only. */
  checkpointCount?: number;
  restoredAt?: number | null;
  linkState: RecoveryLinkState;
  /**
   * Ordered list of actions; the first entry drives the primary button on
   * the row. UI renders supplemental actions in a smaller affordance.
   */
  actions: RecoveryActionKind[];
  detail: string;
};

export type RecoveryManagerStats = {
  isRunning: boolean;
  monitoredSwaps: number;
  websocketConnected: boolean;
  usePollingFallback: boolean;
};

export type RecoveryScan = {
  scannedAt: number;
  items: RecoveryItem[];
  /**
   * Diagnostic counts that include rows hidden from `items`. Keys:
   * - `submarine.recoverable` / `submarine.pre_cltv` / `submarine.invalid_swap`
   * - `submarine.none` / `submarine.already_spent` (hidden from items)
   * - `reverse.pending` / `chain.pending` / `chain.refundable`
   * - `pending_finalize` / `arkade_settlement`
   */
  counts: Record<string, number>;
  /** User-readable explanation when the scan is intentionally empty. */
  reason?: string;
  manager?: RecoveryManagerStats;
};

const EMPTY_SCAN: RecoveryScan = {
  scannedAt: 0,
  items: [],
  counts: {},
};

function bumpCount(counts: Record<string, number>, key: string): void {
  counts[key] = (counts[key] ?? 0) + 1;
}

function metaForSwap(
  swapId: string,
  metadata: LocalSwapMetadata[],
): LocalSwapMetadata | undefined {
  return metadata.find((m) => m.swapId === swapId);
}

function linkStateForMeta(
  meta: LocalSwapMetadata | undefined,
): RecoveryLinkState {
  if (!meta) return "unlinked";
  if (meta.restoredAt != null) return "restored";
  if (meta.walletTxId) return "linked";
  return "unlinked";
}

function shortId(id: string, head = 8, tail = 6): string {
  if (id.length <= head + tail + 1) return id;
  return `${id.slice(0, head)}…${id.slice(-tail)}`;
}

function reverseTitle(swap: BoltzReverseSwap): string {
  return `Lightning receive (${swap.status})`;
}

function submarineTitle(
  swap: BoltzSubmarineSwap,
  recoveryStatus?: SubmarineRecoveryStatus,
): string {
  if (recoveryStatus === "recoverable") return "Lightning send — recoverable";
  if (recoveryStatus === "pre_cltv")
    return "Lightning send — waiting for timelock";
  if (recoveryStatus === "invalid_swap")
    return "Lightning send — could not inspect";
  return `Lightning send (${swap.status})`;
}

function chainTitle(swap: BoltzChainSwap, refundable: boolean): string {
  if (refundable) return "Bitcoin send — refund available";
  return `Bitcoin send (${swap.status})`;
}

function isArkToBtcChain(swap: BoltzChainSwap): boolean {
  return swap.request.from === "ARK" && swap.request.to === "BTC";
}

export type ClassifyInput = {
  walletId: string;
  swaps: BoltzSwap[];
  metadata: LocalSwapMetadata[];
  submarineRecovery: SubmarineRecoveryInfo[];
  pendingTxs: PendingTx[];
  activities: Activity[];
  manager?: RecoveryManagerStats;
};

/**
 * Pure classifier: takes raw inputs and produces a sorted scan. Lifted out of
 * `scanRecoveryState` so it can be unit-tested without React/SDK plumbing.
 */
export function classifyRecovery(input: ClassifyInput): RecoveryScan {
  const counts: Record<string, number> = {};
  const items: RecoveryItem[] = [];
  const recoveryById = new Map<string, SubmarineRecoveryInfo>();
  for (const info of input.submarineRecovery) {
    recoveryById.set(info.swap.id, info);
    bumpCount(counts, `submarine.${info.status}`);
  }

  for (const swap of input.swaps) {
    if (swap.type === "submarine") {
      const meta = metaForSwap(swap.id, input.metadata);
      const linkState = linkStateForMeta(meta);
      const info = recoveryById.get(swap.id);
      if (info) {
        // `none` and `already_spent` are healthy — exclude from items, keep
        // their count for the support bundle.
        if (info.status === "none" || info.status === "already_spent") {
          continue;
        }
        const severity: RecoverySeverity =
          info.status === "recoverable" ? "actionable" : "attention";
        const actions: RecoveryActionKind[] =
          info.status === "recoverable"
            ? ["recover_submarine_vhtlc", "support_bundle"]
            : ["refresh_status", "support_bundle"];
        items.push({
          id: `submarine:${swap.id}`,
          swapId: swap.id,
          walletTxId: meta?.walletTxId ?? null,
          paymentHash: swap.preimageHash ?? meta?.paymentHash ?? null,
          type: "submarine",
          title: submarineTitle(swap, info.status),
          status: info.status,
          severity,
          createdAt: swap.createdAt * 1000,
          amountSats: info.amountSats || meta?.arkadeAmountSats || undefined,
          vtxoCount: info.vtxoCount,
          refundLocktime: info.refundLocktime,
          restoredAt: meta?.restoredAt ?? null,
          linkState,
          actions,
          detail:
            info.status === "invalid_swap"
              ? (info.error ?? "Could not inspect VHTLC")
              : `Swap ${shortId(swap.id)} · ${info.vtxoCount} vtxo${info.vtxoCount === 1 ? "" : "s"}`,
        });
        continue;
      }
      // No recovery info — only show non-terminal rows so we don't surface
      // every healthy completed submarine swap.
      if (isSubmarineFinalStatus(swap.status)) continue;
      bumpCount(counts, "submarine.pending");
      items.push({
        id: `submarine:${swap.id}`,
        swapId: swap.id,
        walletTxId: meta?.walletTxId ?? null,
        paymentHash: swap.preimageHash ?? meta?.paymentHash ?? null,
        type: "submarine",
        title: submarineTitle(swap),
        status: swap.status,
        severity: "info",
        createdAt: swap.createdAt * 1000,
        amountSats: meta?.arkadeAmountSats ?? undefined,
        restoredAt: meta?.restoredAt ?? null,
        linkState,
        actions: ["refresh_status", "support_bundle"],
        detail: `Swap ${shortId(swap.id)}`,
      });
      continue;
    }

    if (swap.type === "reverse") {
      if (isReverseFinalStatus(swap.status)) continue;
      const meta = metaForSwap(swap.id, input.metadata);
      bumpCount(counts, "reverse.pending");
      items.push({
        id: `reverse:${swap.id}`,
        swapId: swap.id,
        walletTxId: meta?.walletTxId ?? null,
        paymentHash: swap.request.preimageHash ?? meta?.paymentHash ?? null,
        type: "reverse",
        title: reverseTitle(swap),
        status: swap.status,
        severity: "info",
        createdAt: swap.createdAt * 1000,
        amountSats:
          swap.response.onchainAmount ?? meta?.arkadeAmountSats ?? undefined,
        restoredAt: meta?.restoredAt ?? null,
        linkState: linkStateForMeta(meta),
        // Reverse-claim path is deferred until local-material checks are
        // reliable — see MILESTONE_9.agents.md "Selected Direction".
        actions: ["refresh_status", "support_bundle"],
        detail: `Swap ${shortId(swap.id)}`,
      });
      continue;
    }

    // chain
    const meta = metaForSwap(swap.id, input.metadata);
    const refundable = isChainSwapRefundable(swap) && isArkToBtcChain(swap);
    if (refundable) {
      bumpCount(counts, "chain.refundable");
      items.push({
        id: `chain:${swap.id}`,
        swapId: swap.id,
        walletTxId: meta?.walletTxId ?? null,
        paymentHash: swap.request.preimageHash ?? meta?.paymentHash ?? null,
        type: "chain",
        title: chainTitle(swap, true),
        status: swap.status,
        severity: "actionable",
        createdAt: swap.createdAt * 1000,
        amountSats:
          meta?.arkadeAmountSats ?? swap.request.userLockAmount ?? swap.amount,
        restoredAt: meta?.restoredAt ?? null,
        linkState: linkStateForMeta(meta),
        actions: ["refund_chain_ark", "support_bundle"],
        detail: `Swap ${shortId(swap.id)}`,
      });
      continue;
    }
    if (isChainFinalStatus(swap.status)) continue;
    bumpCount(counts, "chain.pending");
    items.push({
      id: `chain:${swap.id}`,
      swapId: swap.id,
      walletTxId: meta?.walletTxId ?? null,
      paymentHash: swap.request.preimageHash ?? meta?.paymentHash ?? null,
      type: "chain",
      title: chainTitle(swap, false),
      status: swap.status,
      severity: "info",
      createdAt: swap.createdAt * 1000,
      amountSats:
        meta?.arkadeAmountSats ?? swap.request.userLockAmount ?? swap.amount,
      restoredAt: meta?.restoredAt ?? null,
      linkState: linkStateForMeta(meta),
      actions: ["refresh_status", "support_bundle"],
      detail: `Swap ${shortId(swap.id)}`,
    });
  }

  for (const tx of input.pendingTxs) {
    bumpCount(counts, "pending_finalize");
    items.push({
      id: `pending:${tx.arkTxid}`,
      arkTxid: tx.arkTxid,
      type: "pending_finalize",
      title: "Unfinalized Arkade transaction",
      status: "pending_finalize",
      severity: "actionable",
      // Server-side queue rows do not carry a creation timestamp; stamp at
      // scan time so the row sorts naturally with the others. Replaced on
      // every rescan, which is fine — this only affects sort order.
      createdAt: Date.now(),
      checkpointCount: tx.signedCheckpointTxs.length,
      linkState: "not_applicable",
      actions: ["finalize_pending_tx", "support_bundle"],
      detail: `arkTxid ${shortId(tx.arkTxid)} · ${tx.signedCheckpointTxs.length} checkpoint${tx.signedCheckpointTxs.length === 1 ? "" : "s"}`,
    });
  }

  for (const activity of input.activities) {
    if (activity.source.type !== "wallet_event") continue;
    if (activity.title !== "Arkade settlement") continue;
    const md = activity.metadata ?? {};
    const unresolved = md.unresolvedAmountSats;
    if (typeof unresolved !== "number" || unresolved === 0) continue;
    // Asset-bearing commitments produce unresolved BTC deltas by design (BTC
    // dust + per-asset values do not net to zero). They're expected, not
    // anomalies — skip them silently. The diagnostics bundle counts the
    // skipped rows separately so we can prove the filter is firing.
    if (md.settlementReason === "asset_bearing_settlement") {
      bumpCount(counts, "arkade_settlement_skipped_asset");
      continue;
    }
    bumpCount(counts, "arkade_settlement");
    const reason =
      typeof md.settlementReason === "string" ? md.settlementReason : "anomaly";
    items.push({
      id: `arkade_settlement:${activity.id}`,
      type: "arkade_settlement",
      title: "Arkade settlement anomaly",
      status: reason,
      severity: "attention",
      createdAt: activity.timestamp,
      amountSats: Math.abs(unresolved),
      linkState: "not_applicable",
      // Support-first per MILESTONE_9.agents.md Phase 6.
      actions: ["support_bundle", "refresh_status"],
      detail:
        typeof md.commitmentTxid === "string"
          ? `Commitment ${shortId(md.commitmentTxid)} · ${reason}`
          : reason,
    });
  }

  // Stable sort: actionable first (newest), then attention, then info.
  const severityRank: Record<RecoverySeverity, number> = {
    actionable: 0,
    attention: 1,
    info: 2,
  };
  items.sort((a, b) => {
    const s = severityRank[a.severity] - severityRank[b.severity];
    if (s !== 0) return s;
    return b.createdAt - a.createdAt;
  });

  return {
    scannedAt: Date.now(),
    items,
    counts,
    manager: input.manager,
  };
}

async function readManagerStats(): Promise<RecoveryManagerStats | undefined> {
  try {
    const lightning = await getLightning();
    const manager = lightning.getSwapManager();
    if (!manager) return undefined;
    const stats = await manager.getStats();
    return {
      isRunning: stats.isRunning,
      monitoredSwaps: stats.monitoredSwaps,
      websocketConnected: stats.websocketConnected,
      usePollingFallback: stats.usePollingFallback,
    };
  } catch {
    return undefined;
  }
}

async function safeScanSubmarines(): Promise<SubmarineRecoveryInfo[]> {
  try {
    const lightning = await getLightning();
    return await lightning.scanRecoverableSubmarineSwaps();
  } catch (e) {
    recordError(
      "swap",
      `recovery_submarine_scan_failed: ${e instanceof Error ? e.message : String(e)}`,
    );
    return [];
  }
}

async function safeDiscoverPendingTxs(): Promise<PendingTx[]> {
  try {
    return await discoverPendingTxs();
  } catch (e) {
    recordError(
      "swap",
      `recovery_pending_tx_discovery_failed: ${e instanceof Error ? e.message : String(e)}`,
    );
    return [];
  }
}

export type ScanRecoveryStateInput = {
  metadata: ArkadeWalletMetadata;
  /** Active wallet behavior, needed to ensure the wallet/Lightning instance. */
  ensureWallet: () => Promise<void>;
  /**
   * Activities currently visible to the user. Passed in instead of
   * recomputed so the scan reflects the same Activity feed the user sees.
   */
  activities: Activity[];
  /** When false, skip the user-triggered Boltz status refresh. */
  refreshFirst?: boolean;
};

/**
 * Inventory scan. Ensures the wallet (and Lightning when supported) is
 * initialized for the active metadata, then collects swap, pending-tx, and
 * settlement state and runs the classifier.
 */
export async function scanRecoveryState(
  input: ScanRecoveryStateInput,
): Promise<RecoveryScan> {
  const { metadata, activities } = input;
  try {
    await input.ensureWallet();
  } catch (e) {
    return {
      ...EMPTY_SCAN,
      scannedAt: Date.now(),
      reason:
        e instanceof Error
          ? `Wallet is not ready: ${e.message}`
          : "Wallet is not ready",
    };
  }

  const lightningSupported = isLightningSupportedForNetwork(metadata.network);
  if (!lightningSupported) {
    // Still discover pending Arkade txs (wallet-level, not swap-related).
    const pendingTxs = await safeDiscoverPendingTxs();
    const scan = classifyRecovery({
      walletId: metadata.id,
      swaps: [],
      metadata: [],
      submarineRecovery: [],
      pendingTxs,
      activities,
    });
    return {
      ...scan,
      reason: `Lightning is not configured for ${metadata.network}`,
    };
  }

  if (input.refreshFirst !== false) {
    await refreshSwapsStatus();
  }

  const [sources, submarineRecovery, pendingTxs, manager] = await Promise.all([
    getLightningActivitySources(metadata.id),
    safeScanSubmarines(),
    safeDiscoverPendingTxs(),
    readManagerStats(),
  ]);

  return classifyRecovery({
    walletId: metadata.id,
    swaps: sources.swaps,
    metadata: sources.metadata,
    submarineRecovery,
    pendingTxs,
    activities,
    manager,
  });
}

/**
 * Fetch a submarine swap by id and re-run the inspection. Used by the store
 * action wrapper so we never act on a stale `RecoveryItem`.
 */
export async function lookupSubmarineRecovery(
  swapId: string,
): Promise<{ swap: BoltzSubmarineSwap; info: SubmarineRecoveryInfo } | null> {
  try {
    const lightning = await getLightning();
    const all = await lightning.swapRepository.getAllSwaps({
      type: "submarine",
    });
    const target = all.find((s) => s.id === swapId);
    if (!target || target.type !== "submarine") return null;
    const info = await lightning.inspectSubmarineRecovery(target);
    return { swap: target, info };
  } catch (e) {
    throw toArkadeError(
      "recovery_action_failed",
      "Failed to inspect submarine swap",
      e,
    );
  }
}

/**
 * Run the SDK's per-swap recovery sweep. Caller must have already confirmed
 * `info.status === "recoverable"`.
 */
export async function runSubmarineRecovery(
  swap: BoltzSubmarineSwap,
): Promise<{ swept: number; skipped: number }> {
  const lightning = await getLightning();
  return lightning.recoverSubmarineFunds(swap);
}

/**
 * Returns true when the SwapManager reports it is currently processing the
 * swap (claim/refund in flight). Used as a guard against double-fire.
 */
export async function isSwapBeingProcessed(swapId: string): Promise<boolean> {
  try {
    const lightning = await getLightning();
    const manager = lightning.getSwapManager();
    if (!manager) return false;
    return await manager.isProcessing(swapId);
  } catch {
    return false;
  }
}
