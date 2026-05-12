import type { Activity } from "../store/types";

export type PendingTotals = {
  /** Sum of pending inbound BTC sats (positive). */
  inboundSats: number;
  /** Sum of pending outbound BTC sats (positive — informational only). */
  outboundSats: number;
};

/**
 * Sum BTC sats from pending activity rows. Asset-bearing rows are excluded
 * (asset amounts are not BTC and live in a separate breakdown). Refunded and
 * failed rows are excluded — only `status === "pending"` qualifies.
 *
 * The result is used by the wallet balance breakdown to show "Pending inbound"
 * / "Pending outbound" lines without changing the confirmed total. See M11 for
 * why we re-derive on the fly rather than persist into ArkadeWalletMetadata.
 */
export function computePendingTotals(activities: Activity[]): PendingTotals {
  let inboundSats = 0;
  let outboundSats = 0;
  for (const a of activities) {
    if (a.status !== "pending") continue;
    if (a.assets && a.assets.length > 0) continue;
    if (a.amountSats == null) continue;
    if (a.direction === "in") {
      inboundSats += a.amountSats;
    } else if (a.direction === "out") {
      outboundSats += a.amountSats;
    }
  }
  return { inboundSats, outboundSats };
}

export type SnapshotBalanceTotals = {
  availableSats: number;
  totalSats: number;
};

/**
 * __DEV__-only canary. Returns a warning string when the SDK's `available`
 * appears to fold pending amounts into the confirmed balance. The tolerance
 * absorbs rounding without hiding real drift.
 *
 * Returns null when the invariants hold (the common case). The audit is
 * advisory; production builds rate-limit and gate by `__DEV__` at the call
 * site.
 */
export function auditBalanceIntegrity(
  snapshot: SnapshotBalanceTotals,
  pending: PendingTotals,
  dustSlackSats = 10,
): string | null {
  const overshoot =
    snapshot.availableSats +
    pending.inboundSats -
    snapshot.totalSats -
    dustSlackSats;
  if (overshoot > 0) {
    return `balance_audit: available (${snapshot.availableSats}) + pendingInbound (${pending.inboundSats}) > total (${snapshot.totalSats}) by ${overshoot} sats`;
  }
  return null;
}
