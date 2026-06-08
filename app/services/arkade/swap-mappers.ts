import {
  type BoltzChainSwap,
  type BoltzReverseSwap,
  type BoltzSubmarineSwap,
  type BoltzSwap,
  type BoltzSwapStatus,
  isChainFailedStatus,
  isChainRefundableStatus,
  isChainSuccessStatus,
  isReverseClaimableStatus,
  isReverseFailedStatus,
  isReverseSuccessStatus,
  isSubmarineFailedStatus,
  isSubmarineSuccessStatus,
} from "@arkade-os/boltz-swap";
import type { Activity, ActivityStatus } from "../../store/types";
import { boltzApiUrlForNetwork } from "./lightning";
import { LINKAGE_LOOKAHEAD_MS, LINKAGE_LOOKBACK_MS } from "./swap-linkage";
import type { LocalSwapMetadata } from "./swap-storage";

export type ActivitySources = {
  /** Arkade-side rows produced by `getActivityHistory`. */
  arkadeActivities: Activity[];
  swaps: BoltzSwap[];
  metadata: LocalSwapMetadata[];
  /** Active network name, used to resolve the Boltz API URL for metadata. */
  network: string | null;
};

type ProjectionContext = {
  network: string | null;
};

type CounterpartProjection = {
  activity: Activity;
};

function reverseSwapStatus(status: BoltzSwapStatus): ActivityStatus {
  if (isReverseSuccessStatus(status)) return "confirmed";
  if (isReverseFailedStatus(status)) return "failed";
  return "pending";
}

function reverseStatusWithCounterpart(
  status: ActivityStatus,
  counterpart: CounterpartProjection | undefined,
): ActivityStatus {
  if (status !== "pending") return status;
  if (counterpart?.activity.status === "confirmed") return "confirmed";
  return status;
}

function chainSwapStatus(status: BoltzSwapStatus): ActivityStatus {
  if (isChainSuccessStatus(status)) return "confirmed";
  if (isChainFailedStatus(status)) return "failed";
  // Refundable counts as a (recoverable) failure for the user — they need to
  // act on it. The Activity detail surfaces a Refund button.
  if (isChainRefundableStatus(status)) return "failed";
  return "pending";
}

function chainSwapTitle(swap: BoltzChainSwap): string {
  if (isChainSuccessStatus(swap.status)) return "Sent to Bitcoin";
  if (isChainFailedStatus(swap.status)) return "Bitcoin send failed";
  if (isChainRefundableStatus(swap.status))
    return "Bitcoin send — refund available";
  return "Sending to Bitcoin";
}

function submarineSwapStatus(swap: BoltzSubmarineSwap): ActivityStatus {
  if (swap.refunded) return "refunded";
  if (isSubmarineSuccessStatus(swap.status)) return "confirmed";
  if (isSubmarineFailedStatus(swap.status)) return "failed";
  return "pending";
}

/**
 * Title for a reverse swap (Lightning -> Arkade).
 *
 * Lifecycle: `swap.created -> transaction.mempool -> transaction.confirmed
 *            -> invoice.settled`.
 *
 * - `swap.created`: nothing has happened on the LN side yet. Title reads
 *   "Lightning invoice" — the user is awaiting payment.
 * - `transaction.mempool` / `transaction.confirmed` (claimable states): Boltz
 *   has already received the LN payment and locked matching funds on Arkade
 *   for us. The LN side is effectively done; we're only waiting for our
 *   on-Arkade claim to be observed. Title reads "Lightning received".
 * - `invoice.settled`: fully settled. Title reads "Lightning received".
 * - Failed / expired terminal states: dedicated titles.
 *
 * Status (`ActivityStatus`) remains `"pending"` until `invoice.settled`,
 * unless the wallet history already shows the matching inbound Arkade payment
 * confirmed. In that case the user has received funds, even if the local Boltz
 * row is still stale.
 */
function reverseTitle(
  swap: BoltzReverseSwap,
  meta: LocalSwapMetadata | undefined,
): string {
  const isLnurl = meta?.createdForFlow === "lnurl_receive";
  if (isReverseFailedStatus(swap.status)) {
    if (swap.status === "transaction.refunded") {
      return isLnurl ? "LNURL invoice refunded" : "Lightning invoice refunded";
    }
    return isLnurl ? "LNURL invoice failed" : "Lightning invoice failed";
  }
  if (
    isReverseSuccessStatus(swap.status) ||
    isReverseClaimableStatus(swap.status)
  ) {
    return isLnurl ? "LNURL received" : "Lightning received";
  }
  return isLnurl ? "LNURL invoice" : "Lightning invoice";
}

/**
 * Title for a submarine swap (Arkade -> Lightning).
 *
 * Lifecycle: `swap.created -> invoice.set -> invoice.pending -> invoice.paid
 *            -> transaction.claimed`.
 *
 * - Pre-`invoice.paid`: the LN destination has not been paid yet. Title
 *   reads "Lightning payment".
 * - `invoice.paid`: Boltz has paid the LN destination. The send has
 *   landed; we're waiting for Boltz to claim our Arkade lockup. Title
 *   reads "Lightning sent".
 * - `transaction.claimed`: fully settled. Title reads "Lightning sent".
 * - Refunded: explicit "Lightning refund" title.
 * - Failed: "Lightning send failed".
 */
function submarineTitle(
  swap: BoltzSubmarineSwap,
  meta: LocalSwapMetadata | undefined,
): string {
  const isLnurl = meta?.createdForFlow === "lnurl_send";
  if (swap.refunded) return isLnurl ? "LNURL refund" : "Lightning refund";
  if (isSubmarineFailedStatus(swap.status))
    return isLnurl ? "LNURL send failed" : "Lightning send failed";
  if (
    isSubmarineSuccessStatus(swap.status) ||
    swap.status === "invoice.paid" ||
    swap.status === "transaction.claim.pending"
  ) {
    return isLnurl ? "LNURL sent" : "Lightning sent";
  }
  return isLnurl ? "LNURL payment" : "Lightning payment";
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

export function isTerminalSwapStatus(status: BoltzSwapStatus): boolean {
  return (
    isReverseSuccessStatus(status) ||
    isReverseFailedStatus(status) ||
    isSubmarineSuccessStatus(status) ||
    isSubmarineFailedStatus(status) ||
    isChainSuccessStatus(status) ||
    isChainFailedStatus(status) ||
    isChainRefundableStatus(status)
  );
}

/**
 * Common metadata projected for every Lightning Activity row.
 *
 * IMPORTANT: never project `BoltzReverseSwap.preimage` /
 * `BoltzSubmarineSwap.preimage` / `BoltzChainSwap.preimage`. Preimages are
 * the proof-of-payment secret and must not land in `Activity.metadata`,
 * which is persisted to AsyncStorage.
 */
function baseLightningMetadata(
  swap: BoltzSwap,
  meta: LocalSwapMetadata | undefined,
  ctx: ProjectionContext,
): NonNullable<Activity["metadata"]> {
  const out: NonNullable<Activity["metadata"]> = {
    swapId: swap.id,
    swapType: swap.type,
    provider: "boltz",
    backgroundNotified: meta?.backgroundNotified ?? false,
  };
  if (ctx.network) {
    out.network = ctx.network;
    const apiUrl = boltzApiUrlForNetwork(ctx.network);
    if (apiUrl) out.boltzApiUrl = apiUrl;
  }
  if (
    meta?.createdForFlow === "lnurl_receive" ||
    meta?.createdForFlow === "lnurl_send"
  )
    out.createdForFlow = meta.createdForFlow;
  if (meta?.linkSource) out.linkSource = meta.linkSource;
  if (meta?.invoiceAmountSats != null) {
    out.invoiceAmountSats = meta.invoiceAmountSats;
  }
  if (meta?.arkadeAmountSats != null) {
    out.arkadeAmountSats = meta.arkadeAmountSats;
  }
  if (meta?.paymentHash) out.paymentHash = meta.paymentHash;
  if (meta?.walletTxId) out.walletTxId = meta.walletTxId;
  return out;
}

function walletTxIdFromActivity(activity: Activity): string | null {
  if (activity.source.type === "arkade_tx") return activity.source.walletTxId;

  const metadata = activity.metadata;
  const walletTxId = metadata?.walletTxId;
  if (typeof walletTxId === "string" && walletTxId.length > 0) {
    return walletTxId;
  }
  const arkTxid = metadata?.arkTxid;
  if (typeof arkTxid === "string" && arkTxid.length > 0) return arkTxid;
  const commitmentTxid = metadata?.commitmentTxid;
  if (typeof commitmentTxid === "string" && commitmentTxid.length > 0) {
    return commitmentTxid;
  }
  const boardingTxid = metadata?.boardingTxid;
  if (typeof boardingTxid === "string" && boardingTxid.length > 0) {
    return boardingTxid;
  }
  return null;
}

function withCounterpartMetadata(
  metadata: NonNullable<Activity["metadata"]>,
  counterpart: CounterpartProjection | undefined,
): NonNullable<Activity["metadata"]> {
  if (!counterpart || metadata.walletTxId != null) return metadata;
  const walletTxId = walletTxIdFromActivity(counterpart.activity);
  if (!walletTxId) return metadata;
  return { ...metadata, walletTxId };
}

function reverseLightningMetadata(
  swap: BoltzReverseSwap,
  meta: LocalSwapMetadata | undefined,
  ctx: ProjectionContext,
): NonNullable<Activity["metadata"]> {
  const out = baseLightningMetadata(swap, meta, ctx);
  if (swap.response.invoice) out.invoice = swap.response.invoice;
  if (out.paymentHash == null && swap.request.preimageHash) {
    out.paymentHash = swap.request.preimageHash;
  }
  if (out.invoiceAmountSats == null && swap.request.invoiceAmount != null) {
    out.invoiceAmountSats = swap.request.invoiceAmount;
  }
  if (out.arkadeAmountSats == null && swap.response.onchainAmount != null) {
    out.arkadeAmountSats = swap.response.onchainAmount;
  }
  // Reverse swap (Lightning -> Arkade): user receives `arkadeAmountSats` on
  // Arkade after Boltz takes a fee from the invoice value. Fee is the
  // positive difference.
  if (
    typeof out.invoiceAmountSats === "number" &&
    typeof out.arkadeAmountSats === "number"
  ) {
    const fee = out.invoiceAmountSats - out.arkadeAmountSats;
    if (fee > 0) out.lightningFeeSats = fee;
  }
  return out;
}

function submarineLightningMetadata(
  swap: BoltzSubmarineSwap,
  meta: LocalSwapMetadata | undefined,
  ctx: ProjectionContext,
): NonNullable<Activity["metadata"]> {
  const out = baseLightningMetadata(swap, meta, ctx);
  if (swap.request.invoice) out.invoice = swap.request.invoice;
  if (out.paymentHash == null && swap.preimageHash) {
    out.paymentHash = swap.preimageHash;
  }
  if (out.arkadeAmountSats == null && swap.response.expectedAmount != null) {
    out.arkadeAmountSats = swap.response.expectedAmount;
  }
  // Submarine swap (Arkade -> Lightning): user sends `arkadeAmountSats` on
  // Arkade, of which `invoiceAmountSats` reaches the Lightning destination.
  // Fee is the positive difference.
  if (
    typeof out.arkadeAmountSats === "number" &&
    typeof out.invoiceAmountSats === "number"
  ) {
    const fee = out.arkadeAmountSats - out.invoiceAmountSats;
    if (fee > 0) out.lightningFeeSats = fee;
  }
  if (swap.refunded) out.refunded = true;
  return out;
}

/**
 * Build an Activity row from a Boltz swap. Caller has already filtered the
 * swap to be either reverse or submarine — chain swaps are tolerated by the
 * mapper but rendered as a generic Lightning activity row.
 */
function mapSwapToActivity(
  swap: BoltzSwap,
  meta: LocalSwapMetadata | undefined,
  ctx: ProjectionContext,
  counterpart: CounterpartProjection | undefined,
): Activity {
  const baseId = meta?.walletTxId ?? `swap:${swap.id}`;
  const timestampMs = swap.createdAt * 1000;
  if (swap.type === "reverse") {
    const status = reverseStatusWithCounterpart(
      reverseSwapStatus(swap.status),
      counterpart,
    );
    return {
      id: baseId,
      kind: "lightning_swap",
      direction: "in",
      amountSats: reverseAmountSats(swap, meta),
      timestamp: timestampMs,
      title: reverseTitle(swap, meta),
      status,
      rail: "lightning",
      source: {
        type: "boltz_swap",
        provider: "boltz",
        swapId: swap.id,
        swapType: "reverse",
      },
      metadata: withCounterpartMetadata(
        reverseLightningMetadata(swap, meta, ctx),
        counterpart,
      ),
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
      title: submarineTitle(swap, meta),
      status,
      rail: "lightning",
      source: {
        type: "boltz_swap",
        provider: "boltz",
        swapId: swap.id,
        swapType: "submarine",
      },
      metadata: withCounterpartMetadata(
        submarineLightningMetadata(swap, meta, ctx),
        counterpart,
      ),
    };
  }
  // Chain swap (ARK → BTC out): a Bitcoin-rail row with the destination
  // amount, swapId, and refund-availability surfaced via metadata.
  const chainSwap = swap as BoltzChainSwap;
  return {
    id: baseId,
    kind: "lightning_swap",
    direction: "out",
    amountSats:
      meta?.invoiceAmountSats ?? meta?.arkadeAmountSats ?? chainSwap.amount,
    timestamp: timestampMs,
    title: chainSwapTitle(chainSwap),
    status: chainSwapStatus(chainSwap.status),
    rail: "bitcoin",
    source: {
      type: "boltz_swap",
      provider: "boltz",
      swapId: swap.id,
      swapType: "chain",
    },
    metadata: withCounterpartMetadata(
      chainSwapMetadata(chainSwap, meta, ctx),
      counterpart,
    ),
  };
}

function chainSwapMetadata(
  swap: BoltzChainSwap,
  meta: LocalSwapMetadata | undefined,
  ctx: ProjectionContext,
): NonNullable<Activity["metadata"]> {
  const out = baseLightningMetadata(swap, meta, ctx);
  if (out.invoiceAmountSats == null) {
    out.invoiceAmountSats = swap.amount;
  }
  // Chain swap (Arkade → BTC): user pays `arkadeAmountSats` (lockup amount)
  // on Arkade, of which `invoiceAmountSats` reaches the Bitcoin destination.
  // Fee is the positive difference (Boltz spread + miner fees).
  if (
    typeof out.arkadeAmountSats === "number" &&
    typeof out.invoiceAmountSats === "number"
  ) {
    const fee = out.arkadeAmountSats - out.invoiceAmountSats;
    if (fee > 0) out.chainSwapFeeSats = fee;
  }
  if (isChainRefundableStatus(swap.status)) {
    out.refundAvailable = true;
  }
  return out;
}

function addLinkedPaymentIds(ids: Set<string>, txid: string): void {
  for (const id of linkedPaymentActivityIds(txid)) ids.add(id);
  // Intentionally NOT included: arkade:renewal, arkade:settlement,
  // arkade:asset — wallet-event rows must remain visible.
}

function linkedPaymentActivityIds(txid: string): string[] {
  return [
    `arkade:offchain:${txid}`,
    `arkade:batch:${txid}`,
    `arkade:boarding:${txid}`,
    `arkade:exit:${txid}`,
  ];
}

function linkedCounterpartActivity(
  byId: Map<string, Activity>,
  txid: string,
): Activity | undefined {
  for (const id of linkedPaymentActivityIds(txid)) {
    const activity = byId.get(id);
    if (activity) return activity;
  }
  return undefined;
}

function positiveAmount(value: number | null | undefined): number | null {
  if (typeof value !== "number") return null;
  if (!Number.isFinite(value) || value <= 0) return null;
  return value;
}

function counterpartDirection(swap: BoltzSwap): "in" | "out" | null {
  if (swap.type === "reverse") {
    if (isReverseFailedStatus(swap.status)) return null;
    return "in";
  }
  if (swap.type === "submarine") {
    if (swap.refunded || isSubmarineFailedStatus(swap.status)) return null;
    return "out";
  }
  return null;
}

function counterpartArkadeAmounts(
  swap: BoltzSwap,
  meta: LocalSwapMetadata | undefined,
): Set<number> {
  const amounts = new Set<number>();
  const add = (amount: number | null | undefined): void => {
    const valid = positiveAmount(amount);
    if (valid != null) amounts.add(valid);
  };

  if (swap.type === "reverse") {
    add(meta?.arkadeAmountSats);
    add(swap.response.onchainAmount);
  } else if (swap.type === "submarine") {
    add(meta?.arkadeAmountSats);
    add(swap.response.expectedAmount);
  }

  return amounts;
}

function isArkadePaymentCounterpart(
  activity: Activity,
  direction: "in" | "out",
  amounts: Set<number>,
  lowerBoundMs: number,
  upperBoundMs: number,
): boolean {
  if (activity.kind !== "payment") return false;
  if (activity.rail !== "arkade") return false;
  if (activity.direction !== direction) return false;
  if (activity.amountSats == null || !amounts.has(activity.amountSats)) {
    return false;
  }
  if (activity.timestamp < lowerBoundMs) return false;
  if (activity.timestamp > upperBoundMs) return false;

  if (direction === "in") {
    return (
      activity.id.startsWith("arkade:offchain:") ||
      activity.id.startsWith("arkade:batch:")
    );
  }
  return (
    activity.id.startsWith("arkade:offchain:") ||
    activity.id.startsWith("arkade:exit:")
  );
}

function inferUnlinkedCounterpartActivities(
  sources: ActivitySources,
  metaById: Map<string, LocalSwapMetadata>,
): Map<string, Activity> {
  const candidatesBySwap = new Map<string, Activity[]>();
  const candidateUseCounts = new Map<string, number>();

  for (const swap of sources.swaps) {
    const meta = metaById.get(swap.id);
    if (meta?.walletTxId) continue;

    const direction = counterpartDirection(swap);
    if (!direction) continue;

    const amounts = counterpartArkadeAmounts(swap, meta);
    if (amounts.size === 0) continue;

    const swapCreatedAtMs = swap.createdAt * 1000;
    const lowerBoundMs = swapCreatedAtMs - LINKAGE_LOOKBACK_MS;
    const upperBoundMs =
      Math.max(Date.now(), swapCreatedAtMs) + LINKAGE_LOOKAHEAD_MS;
    const candidates = sources.arkadeActivities.filter((activity) =>
      isArkadePaymentCounterpart(
        activity,
        direction,
        amounts,
        lowerBoundMs,
        upperBoundMs,
      ),
    );

    if (candidates.length !== 1) continue;
    candidatesBySwap.set(swap.id, candidates);
    const id = candidates[0].id;
    candidateUseCounts.set(id, (candidateUseCounts.get(id) ?? 0) + 1);
  }

  const inferred = new Map<string, Activity>();
  for (const [swapId, candidates] of candidatesBySwap) {
    const activity = candidates[0];
    if (candidateUseCounts.get(activity.id) === 1) {
      inferred.set(swapId, activity);
    }
  }
  return inferred;
}

/**
 * Merge Arkade Activities (built by `getActivityHistory`), Boltz swap rows,
 * and the local linkage table into a single user-facing Activity list.
 *
 * Dedup rules:
 * - When a swap row has a linked `walletTxId` (raw `arkTxid` | `commitmentTxid`
 *   | `boardingTxid`, depending on what the linkage handshake captured), the
 *   Lightning row keeps that raw id, and the matching Arkade payment row is
 *   suppressed. Suppression is keyed off namespaced Activity ids, so the
 *   linked raw txid is expanded into all candidate Arkade payment id forms.
 * - Wallet-event rows (renewal, settlement, asset) are never suppressed by
 *   Lightning linkage — those are not Lightning-equivalent payments.
 * - When a swap row is unlinked but exactly one Arkade payment matches its
 *   credited Arkade amount and time window, the Arkade row is suppressed as
 *   the swap counterpart. Ambiguous unlinked matches stay visible until the
 *   linkage handshake populates the txid.
 */
export function mergeActivities(sources: ActivitySources): Activity[] {
  const metaById = metadataBySwapId(sources.metadata);
  const arkadeActivityById = new Map(
    sources.arkadeActivities.map((activity) => [activity.id, activity]),
  );
  const linkedActivityIds = new Set<string>();
  const counterpartBySwapId = new Map<string, CounterpartProjection>();
  for (const m of sources.metadata) {
    if (!m.walletTxId) continue;
    addLinkedPaymentIds(linkedActivityIds, m.walletTxId);
    const activity = linkedCounterpartActivity(
      arkadeActivityById,
      m.walletTxId,
    );
    if (activity) counterpartBySwapId.set(m.swapId, { activity });
  }
  for (const [swapId, activity] of inferUnlinkedCounterpartActivities(
    sources,
    metaById,
  )) {
    linkedActivityIds.add(activity.id);
    counterpartBySwapId.set(swapId, { activity });
  }
  const ctx: ProjectionContext = { network: sources.network };
  const swapActivities: Activity[] = sources.swaps.map((swap) =>
    mapSwapToActivity(
      swap,
      metaById.get(swap.id),
      ctx,
      counterpartBySwapId.get(swap.id),
    ),
  );
  const arkadeActivities: Activity[] = sources.arkadeActivities.filter(
    (a) => !linkedActivityIds.has(a.id),
  );
  // Deduplicate by Activity id. Lightning rows win when both sides reference
  // the same id — the filter above already strips matching Arkade payment
  // rows, but the Map guarantees stability when a swap row carries an id that
  // doesn't (yet) appear in the Arkade history.
  const byId = new Map<string, Activity>();
  for (const a of swapActivities) byId.set(a.id, a);
  for (const a of arkadeActivities) {
    if (!byId.has(a.id)) byId.set(a.id, a);
  }
  return Array.from(byId.values()).sort((a, b) => b.timestamp - a.timestamp);
}
