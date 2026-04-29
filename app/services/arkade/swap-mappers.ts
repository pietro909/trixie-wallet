import {
  type BoltzReverseSwap,
  type BoltzSubmarineSwap,
  type BoltzSwap,
  type BoltzSwapStatus,
  isReverseFailedStatus,
  isReverseSuccessStatus,
  isSubmarineFailedStatus,
  isSubmarineSuccessStatus,
} from "@arkade-os/boltz-swap";
import type { Activity, ActivityStatus } from "../../store/types";
import type { LocalSwapMetadata } from "./swap-storage";

export type ActivitySources = {
  /** Arkade-side rows already mapped via `mapArkTxs`. */
  arkadeActivities: Activity[];
  swaps: BoltzSwap[];
  metadata: LocalSwapMetadata[];
};

function reverseSwapStatus(status: BoltzSwapStatus): ActivityStatus {
  if (isReverseSuccessStatus(status)) return "confirmed";
  if (isReverseFailedStatus(status)) return "failed";
  return "pending";
}

function submarineSwapStatus(swap: BoltzSubmarineSwap): ActivityStatus {
  if (swap.refunded) return "refunded";
  if (isSubmarineSuccessStatus(swap.status)) return "confirmed";
  if (isSubmarineFailedStatus(swap.status)) return "failed";
  return "pending";
}

function reverseTitle(status: ActivityStatus): string {
  switch (status) {
    case "confirmed":
      return "Lightning received";
    case "failed":
      return "Lightning invoice failed";
    case "refunded":
      return "Lightning invoice refunded";
    case "pending":
      return "Lightning invoice";
    default:
      return "Lightning invoice";
  }
}

function submarineTitle(status: ActivityStatus): string {
  switch (status) {
    case "confirmed":
      return "Lightning sent";
    case "failed":
      return "Lightning send failed";
    case "refunded":
      return "Lightning refund";
    case "pending":
      return "Lightning payment";
    default:
      return "Lightning payment";
  }
}

function metadataBySwapId(
  metadata: LocalSwapMetadata[],
): Map<string, LocalSwapMetadata> {
  const map = new Map<string, LocalSwapMetadata>();
  for (const m of metadata) map.set(m.swapId, m);
  return map;
}

function reverseAmountSats(
  swap: BoltzReverseSwap,
  meta: LocalSwapMetadata | undefined,
): number | undefined {
  if (meta?.arkadeAmountSats != null) return meta.arkadeAmountSats;
  return swap.response.onchainAmount;
}

function submarineAmountSats(
  swap: BoltzSubmarineSwap,
  meta: LocalSwapMetadata | undefined,
): number | undefined {
  if (meta?.arkadeAmountSats != null) return meta.arkadeAmountSats;
  return swap.response.expectedAmount;
}

/**
 * Build an Activity row from a Boltz swap. Caller has already filtered the
 * swap to be either reverse or submarine — chain swaps are tolerated by the
 * mapper but rendered as a generic Lightning activity row.
 */
function mapSwapToActivity(
  swap: BoltzSwap,
  meta: LocalSwapMetadata | undefined,
): Activity {
  const baseId = meta?.walletTxId ?? `swap:${swap.id}`;
  const timestampMs = swap.createdAt * 1000;
  if (swap.type === "reverse") {
    const status = reverseSwapStatus(swap.status);
    return {
      id: baseId,
      kind: "lightning_swap",
      direction: "in",
      amountSats: reverseAmountSats(swap, meta),
      timestamp: timestampMs,
      title: reverseTitle(status),
      status,
      rail: "lightning",
      source: {
        type: "boltz_swap",
        provider: "boltz",
        swapId: swap.id,
        swapType: "reverse",
      },
    };
  }
  if (swap.type === "submarine") {
    const status = submarineSwapStatus(swap);
    return {
      id: baseId,
      kind: "lightning_swap",
      direction: status === "refunded" ? "in" : "out",
      amountSats: submarineAmountSats(swap, meta),
      timestamp: timestampMs,
      title: submarineTitle(status),
      status,
      rail: "lightning",
      source: {
        type: "boltz_swap",
        provider: "boltz",
        swapId: swap.id,
        swapType: "submarine",
      },
    };
  }
  // Chain swap fallback — kept generic; Milestone 2 UI does not focus on them.
  return {
    id: baseId,
    kind: "lightning_swap",
    timestamp: timestampMs,
    title: "Chain swap",
    status: "info",
    rail: "lightning",
    source: {
      type: "boltz_swap",
      provider: "boltz",
      swapId: swap.id,
      swapType: "chain",
    },
  };
}

/**
 * Merge SDK transactions, Boltz swap rows, and the local linkage table into a
 * single user-facing Activity list.
 *
 * Dedup rules (per MILESTONE_2):
 * - When a swap row has a linked walletTxId, the Lightning row gets that id and
 *   the matching Arkade-tx row is suppressed.
 * - When a swap row is unlinked, both the swap row (id `swap:${swapId}`) and
 *   any Arkade rows are kept; the linkage handshake (Task #8) populates the
 *   linkage as txids become known.
 */
export function mergeActivities(sources: ActivitySources): Activity[] {
  const metaById = metadataBySwapId(sources.metadata);
  const linkedWalletTxIds = new Set<string>();
  for (const m of sources.metadata) {
    if (m.walletTxId) linkedWalletTxIds.add(m.walletTxId);
  }
  const swapActivities: Activity[] = sources.swaps.map((swap) =>
    mapSwapToActivity(swap, metaById.get(swap.id)),
  );
  const arkadeActivities: Activity[] = sources.arkadeActivities.filter(
    (a) => !linkedWalletTxIds.has(a.id),
  );
  // Deduplicate by Activity id (Lightning row wins over Arkade row when both
  // reference the same walletTxId — already handled by the filter above, but
  // the Map ensures stability when a swap row inherited a tx id that doesn't
  // appear in the SDK history yet).
  const byId = new Map<string, Activity>();
  for (const a of swapActivities) byId.set(a.id, a);
  for (const a of arkadeActivities) {
    if (!byId.has(a.id)) byId.set(a.id, a);
  }
  return Array.from(byId.values()).sort((a, b) => b.timestamp - a.timestamp);
}
