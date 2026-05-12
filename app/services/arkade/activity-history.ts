import type {
  ArkTransaction,
  Asset,
  VirtualCoin,
  Wallet,
} from "@arkade-os/sdk";
import { ExpoIndexerProvider } from "@arkade-os/sdk/adapters/expo";
import type { Activity, ActivityDirection } from "../../store/types";

// ===== Activity id helpers =====

export type ActivityIdKind =
  | "boarding"
  | "boarding_settled"
  | "offchain"
  | "batch"
  | "exit"
  | "renewal"
  | "settlement"
  | "asset";

export function activityId(kind: ActivityIdKind, idValue: string): string {
  return `arkade:${kind}:${idValue}`;
}

// ===== Pure aggregation helpers =====

export function sumValue(vtxos: VirtualCoin[]): bigint {
  let total = 0n;
  for (const v of vtxos) total += BigInt(v.value);
  return total;
}

export function collectAssets(vtxos: VirtualCoin[]): Asset[] {
  const map = new Map<string, bigint>();
  for (const v of vtxos) {
    if (!v.assets) continue;
    for (const a of v.assets) {
      map.set(a.assetId, (map.get(a.assetId) ?? 0n) + a.amount);
    }
  }
  const out: Asset[] = [];
  for (const [assetId, amount] of map) {
    if (amount !== 0n) out.push({ assetId, amount });
  }
  return out;
}

/**
 * Net asset delta from the wallet's perspective: positive entries are received,
 * negative are sent. Mirrors the SDK's `subtractAssets(spent, change)` and is
 * the primary signal for asset row classification.
 */
export function subtractAssets(
  spent: VirtualCoin[],
  received: VirtualCoin[],
): Asset[] {
  const map = new Map<string, bigint>();
  for (const v of received) {
    if (!v.assets) continue;
    for (const a of v.assets) {
      map.set(a.assetId, (map.get(a.assetId) ?? 0n) + a.amount);
    }
  }
  for (const v of spent) {
    if (!v.assets) continue;
    for (const a of v.assets) {
      map.set(a.assetId, (map.get(a.assetId) ?? 0n) - a.amount);
    }
  }
  const out: Asset[] = [];
  for (const [assetId, amount] of map) {
    if (amount !== 0n) out.push({ assetId, amount });
  }
  return out;
}

export function assetDeltas(
  spent: VirtualCoin[],
  received: VirtualCoin[],
): Asset[] {
  return subtractAssets(spent, received);
}

// ===== Commitment-group decomposition =====

export type CommitmentDecomposition =
  | { kind: "renewal"; spentAmount: bigint; createdAmount: bigint }
  | { kind: "batch_receive"; createdAmount: bigint }
  | { kind: "exit"; spentAmount: bigint }
  | {
      kind: "renewal_plus_receive";
      renewalAmount: bigint;
      receiveAmount: bigint;
    }
  | { kind: "renewal_plus_exit"; renewalAmount: bigint; exitAmount: bigint }
  | {
      kind: "settlement";
      spentAmount: bigint;
      createdAmount: bigint;
      reason:
        | "boarding_mixed_unresolved"
        | "asset_bearing_settlement"
        | "empty_group";
    };

export function decomposeCommitmentGroup(args: {
  spent: VirtualCoin[];
  created: VirtualCoin[];
  isBoardingMixed: boolean;
}): CommitmentDecomposition {
  const spentAmount = sumValue(args.spent);
  const createdAmount = sumValue(args.created);
  const assetDelta = subtractAssets(args.spent, args.created);
  const hasAssetDelta = assetDelta.length > 0;

  if (args.spent.length === 0 && args.created.length === 0) {
    return {
      kind: "settlement",
      spentAmount,
      createdAmount,
      reason: "empty_group",
    };
  }

  if (args.isBoardingMixed) {
    if (
      args.spent.length > 0 &&
      args.created.length > 0 &&
      createdAmount >= spentAmount &&
      !hasAssetDelta
    ) {
      // Refresh component covered; leftover (createdAmount - spentAmount) is
      // attributable to boarding and must NOT be emitted as a separate receive.
      return { kind: "renewal", spentAmount, createdAmount };
    }
    return {
      kind: "settlement",
      spentAmount,
      createdAmount,
      reason: "boarding_mixed_unresolved",
    };
  }

  if (hasAssetDelta) {
    // Conservative: do not classify asset-bearing commitments as renewal/exit.
    return {
      kind: "settlement",
      spentAmount,
      createdAmount,
      reason: "asset_bearing_settlement",
    };
  }

  if (spentAmount === 0n && createdAmount > 0n) {
    return { kind: "batch_receive", createdAmount };
  }
  if (spentAmount > 0n && createdAmount === 0n) {
    return { kind: "exit", spentAmount };
  }

  const delta = createdAmount - spentAmount;
  if (delta === 0n) {
    return { kind: "renewal", spentAmount, createdAmount };
  }
  if (delta > 0n) {
    return {
      kind: "renewal_plus_receive",
      renewalAmount: spentAmount,
      receiveAmount: delta,
    };
  }
  return {
    kind: "renewal_plus_exit",
    renewalAmount: createdAmount,
    exitAmount: -delta,
  };
}

export function isRenewalGroup(args: {
  spent: VirtualCoin[];
  created: VirtualCoin[];
  isBoardingMixed: boolean;
}): boolean {
  return decomposeCommitmentGroup(args).kind === "renewal";
}

// ===== Asset row classification =====

export type AssetClassification =
  | "asset_issued"
  | "asset_burned"
  | "asset_sent"
  | "asset_received"
  | "asset_activity";

export function classifyAssetActivity(args: {
  direction: "send" | "receive";
  anchorSats: bigint;
  assetDelta: Asset[];
}): AssetClassification {
  if (args.assetDelta.length === 0) return "asset_activity";
  const allPositive = args.assetDelta.every((a) => a.amount > 0n);
  const allNegative = args.assetDelta.every((a) => a.amount < 0n);

  if (args.direction === "send") {
    if (args.anchorSats === 0n && allPositive) return "asset_issued";
    if (args.anchorSats === 0n && allNegative) return "asset_burned";
    if (allNegative) return "asset_sent";
    return "asset_activity";
  }
  if (allPositive) return "asset_received";
  return "asset_activity";
}

function assetTitle(c: AssetClassification): string {
  switch (c) {
    case "asset_issued":
      return "Asset issued";
    case "asset_burned":
      return "Asset burned";
    case "asset_sent":
      return "Asset sent";
    case "asset_received":
      return "Asset received";
    default:
      return "Asset activity";
  }
}

function assetDirection(c: AssetClassification): ActivityDirection {
  if (c === "asset_received") return "in";
  if (c === "asset_sent") return "out";
  return "self";
}

function buildAssetActivity(args: {
  arkTxid: string;
  timestamp: number;
  direction: "send" | "receive";
  anchorSats: bigint;
  assetDelta: Asset[];
  network: string | null;
}): Activity {
  const cls = classifyAssetActivity({
    direction: args.direction,
    anchorSats: args.anchorSats,
    assetDelta: args.assetDelta,
  });
  const primary = args.assetDelta[0];
  const id = activityId("asset", args.arkTxid);
  // Legacy single-asset pointers — kept so older consumers still work.
  // New consumers read `activity.assets` instead.
  const metadata: NonNullable<Activity["metadata"]> = {
    arkTxid: args.arkTxid,
    assetId: primary?.assetId ?? null,
    assetAmount: primary?.amount ? Number(primary.amount) : 0,
    anchorAmountSats: Number(args.anchorSats),
    classification: cls,
  };
  if (args.network) metadata.network = args.network;
  return {
    id,
    kind: "wallet_event",
    direction: assetDirection(cls),
    timestamp: args.timestamp,
    title: assetTitle(cls),
    status: "confirmed",
    rail: "arkade",
    source: { type: "wallet_event", eventId: id },
    metadata,
    assets: args.assetDelta.map((d) => ({
      assetId: d.assetId,
      amount: d.amount.toString(),
    })),
  };
}

// ===== Main builder =====

export type GetActivityHistoryOptions = {
  /** Active network — stamped onto each Activity for offline detail rendering. */
  network: string | null;
  /** Our own boarding address — stamped onto boarding rows for the details view. */
  boardingAddress?: string | null;
  /** Our own Arkade address — stamped onto inbound rows so the details view can show "received at <our address>". */
  arkadeAddress?: string | null;
};

function withNetwork(
  metadata: Activity["metadata"],
  network: string | null,
): Activity["metadata"] {
  if (!network) return metadata;
  return { ...(metadata ?? {}), network };
}

export async function getActivityHistory(
  wallet: Wallet,
  arkServerUrl: string,
  options: GetActivityHistoryOptions = { network: null },
): Promise<Activity[]> {
  const cm = await wallet.getContractManager();
  const contracts = await cm.getContractsWithVtxos();
  const vtxos: VirtualCoin[] = contracts.flatMap((c) => c.vtxos);
  const { boardingTxs, commitmentsToIgnore } = await wallet.getBoardingTxs();
  const indexer = new ExpoIndexerProvider(arkServerUrl);
  const getTxCreatedAt = (txid: string): Promise<number | undefined> =>
    indexer
      .getVtxos({ outpoints: [{ txid, vout: 0 }] })
      .then((res) => res.vtxos[0]?.createdAt.getTime())
      .catch(() => undefined);
  return buildActivityHistory(
    vtxos,
    boardingTxs,
    commitmentsToIgnore,
    getTxCreatedAt,
    options,
  );
}

export async function buildActivityHistory(
  vtxos: VirtualCoin[],
  allBoardingTxs: ArkTransaction[],
  commitmentsToIgnore: Set<string>,
  getTxCreatedAt?: (txid: string) => Promise<number | undefined>,
  options: GetActivityHistoryOptions = { network: null },
): Promise<Activity[]> {
  const sorted = [...vtxos].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
  );

  const activities: Activity[] = [];
  const { network, boardingAddress, arkadeAddress } = options;

  for (const tx of allBoardingTxs) {
    const boardingTxid = tx.key.boardingTxid;
    if (!boardingTxid) continue;
    const boardingMeta: NonNullable<Activity["metadata"]> = { boardingTxid };
    if (boardingAddress) boardingMeta.boardingAddress = boardingAddress;
    activities.push({
      id: activityId("boarding", boardingTxid),
      kind: "payment",
      direction: "in",
      amountSats: tx.amount,
      timestamp: tx.createdAt,
      title: "Boarding deposit",
      status: tx.settled ? "confirmed" : "pending",
      rail: "arkade",
      source: { type: "arkade_tx", walletTxId: boardingTxid },
      metadata: withNetwork(boardingMeta, network),
    });
  }

  const commitmentIds = new Set<string>();
  for (const v of sorted) {
    const leafCommitment = v.virtualStatus.commitmentTxIds?.[0];
    if (v.status.isLeaf && leafCommitment) {
      commitmentIds.add(leafCommitment);
    }
    if (v.settledBy) {
      commitmentIds.add(v.settledBy);
    }
  }

  // The SDK marks commitments that consumed on-chain boarding outputs via
  // `commitmentsToIgnore`, but the underlying outspend lookup can lag — when
  // a boarding output is consumed off-chain before the outspend cache
  // refreshes, the commitment slips through as a plain batch_receive and we
  // end up emitting "Arkade received" next to "Boarding deposit" for the
  // same funds. Match by amount as a fallback, claiming each boarding tx at
  // most once so multi-deposit wallets stay deterministic.
  const usedBoardingTxids = new Set<string>();
  const findBoardingMatch = (
    amount: bigint,
    requireUnsettled: boolean,
  ): ArkTransaction | null => {
    for (const tx of allBoardingTxs) {
      const boardingTxid = tx.key.boardingTxid;
      if (!boardingTxid) continue;
      if (usedBoardingTxids.has(boardingTxid)) continue;
      if (requireUnsettled && tx.settled) continue;
      if (BigInt(tx.amount) === amount) return tx;
    }
    return null;
  };

  for (const commitmentTxid of commitmentIds) {
    const spent = sorted.filter((v) => v.settledBy === commitmentTxid);
    const created = sorted.filter(
      (v) =>
        v.status.isLeaf &&
        v.virtualStatus.commitmentTxIds?.every((id) => id === commitmentTxid),
    );
    const isBoardingMixed = commitmentsToIgnore.has(commitmentTxid);
    const decomp = decomposeCommitmentGroup({
      spent,
      created,
      isBoardingMixed,
    });

    const tsCreated =
      created.length > 0
        ? Math.min(...created.map((v) => v.createdAt.getTime()))
        : 0;
    const tsSpent =
      spent.length > 0
        ? Math.min(...spent.map((v) => v.createdAt.getTime()))
        : 0;
    const tsAnchor = tsCreated > 0 ? tsCreated : tsSpent + 1;

    // Reclassify pure boarding settlements before the default switch:
    //  - SDK-marked + no VTXO inputs → definitely a boarding settlement;
    //    find the boarding tx by amount for the explorer link.
    //  - Plain batch_receive that matches an unsettled boarding deposit by
    //    amount → outspend cache lag; treat as a boarding settlement.
    // In both cases we emit a single "Boarding settled" wallet_event and
    // suppress the "Arkade received" / "Arkade settlement" duplicate.
    let boardingSettlement: {
      settledAmount: bigint;
      boardingTxid: string | null;
    } | null = null;
    if (decomp.kind === "batch_receive") {
      const match = findBoardingMatch(decomp.createdAmount, true);
      if (match) {
        usedBoardingTxids.add(match.key.boardingTxid);
        boardingSettlement = {
          settledAmount: decomp.createdAmount,
          boardingTxid: match.key.boardingTxid,
        };
      }
    } else if (
      decomp.kind === "settlement" &&
      decomp.reason === "boarding_mixed_unresolved" &&
      spent.length === 0 &&
      created.length > 0
    ) {
      const match = findBoardingMatch(decomp.createdAmount, false);
      if (match) usedBoardingTxids.add(match.key.boardingTxid);
      boardingSettlement = {
        settledAmount: decomp.createdAmount,
        boardingTxid: match?.key.boardingTxid ?? null,
      };
    }

    if (boardingSettlement) {
      const meta: NonNullable<Activity["metadata"]> = {
        commitmentTxid,
        settledAmountSats: Number(boardingSettlement.settledAmount),
      };
      if (boardingSettlement.boardingTxid) {
        meta.boardingTxid = boardingSettlement.boardingTxid;
      }
      activities.push({
        id: activityId("boarding_settled", commitmentTxid),
        kind: "wallet_event",
        direction: "self",
        timestamp: tsCreated > 0 ? tsCreated : tsAnchor,
        title: "Boarding settled",
        status: "confirmed",
        rail: "arkade",
        source: {
          type: "wallet_event",
          eventId: activityId("boarding_settled", commitmentTxid),
        },
        metadata: withNetwork(meta, network),
      });
      continue;
    }

    switch (decomp.kind) {
      case "batch_receive": {
        const meta: NonNullable<Activity["metadata"]> = { commitmentTxid };
        if (arkadeAddress) meta.arkadeAddress = arkadeAddress;
        activities.push({
          id: activityId("batch", commitmentTxid),
          kind: "payment",
          direction: "in",
          amountSats: Number(decomp.createdAmount),
          timestamp: tsCreated,
          title: "Arkade received",
          status: "confirmed",
          rail: "arkade",
          source: { type: "arkade_tx", walletTxId: commitmentTxid },
          metadata: withNetwork(meta, network),
        });
        break;
      }
      case "exit":
        activities.push({
          id: activityId("exit", commitmentTxid),
          kind: "payment",
          direction: "out",
          amountSats: Number(decomp.spentAmount),
          timestamp: tsAnchor,
          title: "Collaborative exit",
          status: "confirmed",
          rail: "arkade",
          source: { type: "arkade_tx", walletTxId: commitmentTxid },
          metadata: withNetwork({ commitmentTxid }, network),
        });
        break;
      case "renewal":
        activities.push({
          id: activityId("renewal", commitmentTxid),
          kind: "wallet_event",
          direction: "self",
          timestamp: tsCreated > 0 ? tsCreated : tsSpent,
          title: "VTXO renewed",
          status: "confirmed",
          rail: "arkade",
          source: {
            type: "wallet_event",
            eventId: activityId("renewal", commitmentTxid),
          },
          metadata: withNetwork(
            {
              commitmentTxid,
              inputCount: spent.length,
              outputCount: created.length,
              renewedAmountSats: Number(decomp.spentAmount),
            },
            network,
          ),
        });
        break;
      case "renewal_plus_receive": {
        activities.push({
          id: activityId("renewal", commitmentTxid),
          kind: "wallet_event",
          direction: "self",
          timestamp: tsCreated,
          title: "VTXO renewed",
          status: "confirmed",
          rail: "arkade",
          source: {
            type: "wallet_event",
            eventId: activityId("renewal", commitmentTxid),
          },
          metadata: withNetwork(
            {
              commitmentTxid,
              inputCount: spent.length,
              outputCount: created.length,
              renewedAmountSats: Number(decomp.renewalAmount),
              netDeltaSats: Number(decomp.receiveAmount),
            },
            network,
          ),
        });
        const receiveMeta: NonNullable<Activity["metadata"]> = {
          commitmentTxid,
          mixedWithRenewal: true,
          netDeltaSats: Number(decomp.receiveAmount),
        };
        if (arkadeAddress) receiveMeta.arkadeAddress = arkadeAddress;
        activities.push({
          id: activityId("batch", commitmentTxid),
          kind: "payment",
          direction: "in",
          amountSats: Number(decomp.receiveAmount),
          timestamp: tsCreated,
          title: "Arkade received",
          status: "confirmed",
          rail: "arkade",
          source: { type: "arkade_tx", walletTxId: commitmentTxid },
          metadata: withNetwork(receiveMeta, network),
        });
        break;
      }
      case "renewal_plus_exit":
        activities.push({
          id: activityId("renewal", commitmentTxid),
          kind: "wallet_event",
          direction: "self",
          timestamp: tsCreated,
          title: "VTXO renewed",
          status: "confirmed",
          rail: "arkade",
          source: {
            type: "wallet_event",
            eventId: activityId("renewal", commitmentTxid),
          },
          metadata: withNetwork(
            {
              commitmentTxid,
              inputCount: spent.length,
              outputCount: created.length,
              renewedAmountSats: Number(decomp.renewalAmount),
              netDeltaSats: -Number(decomp.exitAmount),
            },
            network,
          ),
        });
        activities.push({
          id: activityId("exit", commitmentTxid),
          kind: "payment",
          direction: "out",
          amountSats: Number(decomp.exitAmount),
          timestamp: tsAnchor,
          title: "Collaborative exit",
          status: "confirmed",
          rail: "arkade",
          source: { type: "arkade_tx", walletTxId: commitmentTxid },
          metadata: withNetwork(
            {
              commitmentTxid,
              mixedWithRenewal: true,
              netDeltaSats: -Number(decomp.exitAmount),
            },
            network,
          ),
        });
        break;
      case "settlement": {
        if (decomp.reason === "empty_group") break;
        const unresolved =
          decomp.createdAmount > decomp.spentAmount
            ? decomp.createdAmount - decomp.spentAmount
            : decomp.spentAmount - decomp.createdAmount;
        activities.push({
          id: activityId("settlement", commitmentTxid),
          kind: "wallet_event",
          direction: "self",
          timestamp: tsAnchor,
          title: "Arkade settlement",
          status: "info",
          rail: "arkade",
          source: {
            type: "wallet_event",
            eventId: activityId("settlement", commitmentTxid),
          },
          metadata: withNetwork(
            {
              commitmentTxid,
              spentAmount: Number(decomp.spentAmount),
              createdAmount: Number(decomp.createdAmount),
              unresolvedAmountSats: Number(unresolved),
              settlementReason: decomp.reason,
              inputCount: spent.length,
              outputCount: created.length,
            },
            network,
          ),
        });
        break;
      }
    }
  }

  const offchainSendsEmitted = new Set<string>();
  const offchainReceivesEmitted = new Set<string>();

  for (const v of sorted) {
    if (!v.status.isLeaf && v.txid) {
      const isChangeOfOwnTx = sorted.some((u) => u.arkTxId === v.txid);
      if (!isChangeOfOwnTx && !offchainReceivesEmitted.has(v.txid)) {
        offchainReceivesEmitted.add(v.txid);
        const assets = collectAssets([v]);
        const ts = v.createdAt.getTime();
        if (assets.length > 0) {
          activities.push(
            buildAssetActivity({
              arkTxid: v.txid,
              timestamp: ts,
              direction: "receive",
              anchorSats: BigInt(v.value),
              assetDelta: assets,
              network,
            }),
          );
        } else {
          const receiveMeta: NonNullable<Activity["metadata"]> = {
            arkTxid: v.txid,
          };
          if (arkadeAddress) receiveMeta.arkadeAddress = arkadeAddress;
          activities.push({
            id: activityId("offchain", v.txid),
            kind: "payment",
            direction: "in",
            amountSats: v.value,
            timestamp: ts,
            title: "Arkade received",
            status: "confirmed",
            rail: "arkade",
            source: { type: "arkade_tx", walletTxId: v.txid },
            metadata: withNetwork(receiveMeta, network),
          });
        }
      }
    }

    if (v.isSpent && v.arkTxId && !offchainSendsEmitted.has(v.arkTxId)) {
      offchainSendsEmitted.add(v.arkTxId);
      const arkTxId = v.arkTxId;
      const allSpent = sorted.filter((u) => u.arkTxId === arkTxId);
      const changes = sorted.filter((u) => u.txid === arkTxId);
      const spentBtc = sumValue(allSpent);
      const changeBtc = sumValue(changes);
      const txAmount = changes.length > 0 ? spentBtc - changeBtc : spentBtc;
      const tsTx =
        changes.length > 0
          ? changes[0].createdAt.getTime()
          : ((getTxCreatedAt ? await getTxCreatedAt(arkTxId) : undefined) ??
            v.createdAt.getTime() + 1);
      const assets = subtractAssets(allSpent, changes);

      if (assets.length > 0) {
        activities.push(
          buildAssetActivity({
            arkTxid: arkTxId,
            timestamp: tsTx,
            direction: "send",
            anchorSats: txAmount,
            assetDelta: assets,
            network,
          }),
        );
      } else {
        activities.push({
          id: activityId("offchain", arkTxId),
          kind: "payment",
          direction: "out",
          amountSats: Number(txAmount),
          timestamp: tsTx,
          title: "Arkade sent",
          status: "confirmed",
          rail: "arkade",
          source: { type: "arkade_tx", walletTxId: arkTxId },
          metadata: withNetwork({ arkTxid: arkTxId }, network),
        });
      }
    }
  }

  activities.sort((a, b) => b.timestamp - a.timestamp);
  return activities;
}
