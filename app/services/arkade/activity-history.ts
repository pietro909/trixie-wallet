import type {
  ArkTransaction,
  Asset,
  VirtualCoin,
  Wallet,
} from "@arkade-os/sdk";
import type { Activity, ActivityDirection } from "../../store/types";

// The Expo adapter (`@arkade-os/sdk/adapters/expo`) is loaded lazily inside
// `makeTimestampResolver` so the pure helpers and `buildActivityHistory`
// stay jest-loadable. The lazy load also means refreshes that never hit a
// timestamp cache miss never pay the cost of constructing the indexer.

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
      reason: "boarding_mixed_unresolved" | "empty_group";
    }
  // Asset-bearing commitments split the row pair: a BTC payment row
  // matching the BTC delta sign, plus an asset row carrying the
  // signed per-asset delta.
  | {
      kind: "asset_batch_receive";
      receiveAmount: bigint;
      assetDelta: Asset[];
    }
  | { kind: "asset_exit"; exitAmount: bigint; assetDelta: Asset[] }
  | { kind: "asset_settlement"; assetDelta: Asset[] };

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
    // Split by BTC delta sign so the user sees both the value movement
    // (batch/exit/settlement) and the asset movement (asset row) — the
    // catch-all settlement row would hide the asset delta.
    const btcDelta = createdAmount - spentAmount;
    if (btcDelta > 0n) {
      return {
        kind: "asset_batch_receive",
        receiveAmount: btcDelta,
        assetDelta,
      };
    }
    if (btcDelta < 0n) {
      return { kind: "asset_exit", exitAmount: -btcDelta, assetDelta };
    }
    return { kind: "asset_settlement", assetDelta };
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
  // Asset semantics carry no fast-finality promise (unlike BTC off-chain
  // receives, see commit 94b4a34), so the row reflects the real flag.
  settled: boolean;
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
    status: args.settled ? "confirmed" : "pending",
    rail: "arkade",
    source: { type: "wallet_event", eventId: id },
    metadata,
    assets: args.assetDelta.map((d) => ({
      assetId: d.assetId,
      amount: d.amount.toString(),
    })),
  };
}

// ===== Timestamp resolver =====

// Minimal indexer surface the resolver depends on. Keeping the type
// narrow lets the factory stay loadable under jest-expo without dragging
// in the SDK's ESM-only adapter.
type TimestampOutpoint = { txid: string; vout: number };
type TimestampVtxo = TimestampOutpoint & { createdAt: Date };
type TimestampPage = { current: number; next: number; total: number };

export type IndexerLike = {
  getVtxos: (opts: {
    outpoints: TimestampOutpoint[];
    pageIndex?: number;
    pageSize?: number;
  }) => Promise<{ vtxos: TimestampVtxo[]; page?: TimestampPage }>;
};

export type TxCreatedAtResolver = {
  (txid: string): Promise<number | undefined>;
  getMany?: (txids: string[]) => Promise<Map<string, number>>;
};

export type TimestampResolverDeps = {
  getTimestamp: (txid: string) => Promise<number | undefined>;
  saveTimestamp: (txid: string, ts: number) => Promise<void>;
  /**
   * Resolves to a constructed indexer the first time it's invoked.
   * Construction failures resolve to `null` so the resolver can fall
   * back without throwing — the builder treats `undefined` as a miss
   * and uses `v.createdAt + 1`.
   */
  loadIndexer: () => Promise<IndexerLike>;
};

const TIMESTAMP_FETCH_BATCH_SIZE = 100;

function timestampOutpointKey(outpoint: TimestampOutpoint): string {
  return `${outpoint.txid}:${outpoint.vout}`;
}

async function fetchTimestampsForOutpoints(
  indexer: IndexerLike,
  outpoints: TimestampOutpoint[],
): Promise<Map<string, number>> {
  const requestedByOutpoint = new Map(
    outpoints.map((outpoint) => [
      timestampOutpointKey(outpoint),
      outpoint.txid,
    ]),
  );
  const timestamps = new Map<string, number>();
  let pageIndex = 0;
  const seenPages = new Set<number>();

  while (true) {
    if (seenPages.has(pageIndex)) break;
    seenPages.add(pageIndex);

    const opts: {
      outpoints: TimestampOutpoint[];
      pageIndex?: number;
      pageSize?: number;
    } = { outpoints };
    if (pageIndex > 0) opts.pageIndex = pageIndex;
    if (outpoints.length > 1) opts.pageSize = outpoints.length;

    const res = await indexer.getVtxos(opts);
    for (const v of res.vtxos) {
      const txid = requestedByOutpoint.get(timestampOutpointKey(v));
      if (!txid) continue;
      const ts = v.createdAt.getTime();
      const existing = timestamps.get(txid);
      if (existing === undefined || ts < existing) timestamps.set(txid, ts);
    }

    if (timestamps.size === requestedByOutpoint.size) break;
    const page = res.page;
    if (!page || page.total <= 1) break;
    if (
      page.next === page.current ||
      page.next < 0 ||
      page.next >= page.total
    ) {
      break;
    }
    pageIndex = page.next;
  }

  return timestamps;
}

/**
 * Builds a `getTxCreatedAt(txid)` that consults the persistent timestamp
 * cache first and only loads/constructs the indexer on a miss. The
 * indexer load is memoised across calls so repeated misses share one
 * provider. A cache lookup throw is treated as a miss, matching the
 * best-effort behavior of the production `tx-cache` helpers.
 */
export function makeTimestampResolver(
  deps: TimestampResolverDeps,
): TxCreatedAtResolver {
  let indexerPromise: Promise<IndexerLike | null> | null = null;
  const loadOnce = (): Promise<IndexerLike | null> => {
    if (!indexerPromise) {
      indexerPromise = deps.loadIndexer().then(
        (idx) => idx,
        () => null,
      );
    }
    return indexerPromise;
  };

  const saveTimestamp = async (txid: string, ts: number): Promise<void> => {
    try {
      await deps.saveTimestamp(txid, ts);
    } catch {
      // Timestamp persistence is a cache optimization; never fail refreshes on it.
    }
  };

  const resolver: TxCreatedAtResolver = async (
    txid: string,
  ): Promise<number | undefined> => {
    let cached: number | undefined;
    try {
      cached = await deps.getTimestamp(txid);
    } catch {
      cached = undefined;
    }
    if (cached !== undefined) return cached;
    const indexer = await loadOnce();
    if (!indexer) return undefined;
    let fetched: Map<string, number>;
    try {
      fetched = await fetchTimestampsForOutpoints(indexer, [{ txid, vout: 0 }]);
    } catch {
      return undefined;
    }
    const ts = fetched.get(txid);
    if (ts !== undefined) await saveTimestamp(txid, ts);
    return ts;
  };

  resolver.getMany = async (txids: string[]): Promise<Map<string, number>> => {
    const timestamps = new Map<string, number>();
    const missingTxids: string[] = [];
    for (const txid of new Set(txids)) {
      try {
        const cached = await deps.getTimestamp(txid);
        if (cached !== undefined) {
          timestamps.set(txid, cached);
        } else {
          missingTxids.push(txid);
        }
      } catch {
        missingTxids.push(txid);
      }
    }

    if (missingTxids.length === 0) return timestamps;
    const indexer = await loadOnce();
    if (!indexer) return timestamps;

    for (let i = 0; i < missingTxids.length; i += TIMESTAMP_FETCH_BATCH_SIZE) {
      const outpoints = missingTxids
        .slice(i, i + TIMESTAMP_FETCH_BATCH_SIZE)
        .map((txid) => ({ txid, vout: 0 }));
      let fetched: Map<string, number>;
      try {
        fetched = await fetchTimestampsForOutpoints(indexer, outpoints);
      } catch {
        continue;
      }
      for (const [txid, ts] of fetched) {
        timestamps.set(txid, ts);
        await saveTimestamp(txid, ts);
      }
    }

    return timestamps;
  };

  return resolver;
}

function hasBatchTimestampResolver(
  resolver: TxCreatedAtResolver | undefined,
): resolver is TxCreatedAtResolver & {
  getMany: NonNullable<TxCreatedAtResolver["getMany"]>;
} {
  return typeof resolver?.getMany === "function";
}

// ===== Main builder =====

export type GetActivityHistoryOptions = {
  /** Active network — stamped onto each Activity for offline detail rendering. */
  network: string | null;
  /** Our own boarding address — stamped onto boarding rows for the details view. */
  boardingAddress?: string | null;
  /** Our own Arkade address — stamped onto inbound rows so the details view can show "received at <our address>". */
  arkadeAddress?: string | null;
  /**
   * Previously built Activity rows (typically `wallet.activities` from the store).
   * When a row being built has a matching id AND the prior row is `confirmed`,
   * the prior row is reused verbatim — skipping per-row derivation and any
   * network-bound timestamp lookup. Pending/info rows are always recomputed
   * so they can transition.
   */
  previousActivities?: Activity[];
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
  // Cache helpers load eagerly so a cached timestamp doesn't need to
  // pull in the ESM-only Expo adapter. The indexer constructor is
  // deferred until a no-change off-chain send produces a cache miss.
  const { getTimestamp, saveTimestamp } = await import("./tx-cache");
  const getTxCreatedAt = makeTimestampResolver({
    getTimestamp,
    saveTimestamp,
    loadIndexer: async () => {
      const { ExpoIndexerProvider } = await import(
        "@arkade-os/sdk/adapters/expo"
      );
      return new ExpoIndexerProvider(arkServerUrl);
    },
  });
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
  getTxCreatedAt?: TxCreatedAtResolver,
  options: GetActivityHistoryOptions = { network: null },
): Promise<Activity[]> {
  const sorted = [...vtxos].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
  );

  const activities: Activity[] = [];
  const { network, boardingAddress, arkadeAddress, previousActivities } =
    options;

  // Confirmed Arkade rows are terminal — their derivation is settled. Look
  // them up by id to skip the build (and any network-bound timestamp fetch)
  // when the store already has the row. Pending/info rows are intentionally
  // excluded so they can transition on a refresh.
  const reusableById = new Map<string, Activity>();
  if (previousActivities) {
    for (const a of previousActivities) {
      if (a.status === "confirmed") reusableById.set(a.id, a);
    }
  }
  const tryReuse = (id: string): Activity | undefined => reusableById.get(id);

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

  // Single pass over `sorted` builds the commitment id set and four lookup
  // indexes that replace the per-iteration `sorted.filter(...)` calls below.
  // Each map preserves sorted order because we iterate `sorted` in order and
  // append to the bucket. Misses return `[]` via `?? EMPTY`.
  const commitmentIds = new Set<string>();
  const vtxosBySettledBy = new Map<string, VirtualCoin[]>();
  const leafVtxosByFirstCommitment = new Map<string, VirtualCoin[]>();
  const vtxosByArkTxId = new Map<string, VirtualCoin[]>();
  const vtxosByTxid = new Map<string, VirtualCoin[]>();
  const pushIndex = (
    m: Map<string, VirtualCoin[]>,
    k: string,
    v: VirtualCoin,
  ): void => {
    const existing = m.get(k);
    if (existing) existing.push(v);
    else m.set(k, [v]);
  };
  for (const v of sorted) {
    const leafCommitment = v.virtualStatus.commitmentTxIds?.[0];
    if (v.status.isLeaf && leafCommitment) {
      commitmentIds.add(leafCommitment);
      pushIndex(leafVtxosByFirstCommitment, leafCommitment, v);
    }
    if (v.settledBy) {
      commitmentIds.add(v.settledBy);
      pushIndex(vtxosBySettledBy, v.settledBy, v);
    }
    if (v.arkTxId) pushIndex(vtxosByArkTxId, v.arkTxId, v);
    if (v.txid) pushIndex(vtxosByTxid, v.txid, v);
  }
  const EMPTY: VirtualCoin[] = [];

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

  type OffchainSendPlan = {
    changes: VirtualCoin[];
    assets: Asset[];
    reuse: Activity | undefined;
    txAmount: bigint;
  };

  const offchainSendPlans = new Map<string, OffchainSendPlan>();
  const getOffchainSendPlan = (arkTxId: string): OffchainSendPlan => {
    const existing = offchainSendPlans.get(arkTxId);
    if (existing) return existing;
    const allSpent = vtxosByArkTxId.get(arkTxId) ?? EMPTY;
    const changes = vtxosByTxid.get(arkTxId) ?? EMPTY;
    const assets = subtractAssets(allSpent, changes);
    const reuse = tryReuse(
      activityId(assets.length > 0 ? "asset" : "offchain", arkTxId),
    );
    const spentBtc = sumValue(allSpent);
    const changeBtc = sumValue(changes);
    const txAmount = changes.length > 0 ? spentBtc - changeBtc : spentBtc;
    const plan = { changes, assets, reuse, txAmount };
    offchainSendPlans.set(arkTxId, plan);
    return plan;
  };

  for (const commitmentTxid of commitmentIds) {
    const spent = vtxosBySettledBy.get(commitmentTxid) ?? EMPTY;
    // First-commitment attribution mirrors the SDK
    // (transactionHistory.ts uses commitmentTxIds![0]). A leaf with
    // multiple commitments still surfaces under one group instead of
    // being silently dropped.
    const created = leafVtxosByFirstCommitment.get(commitmentTxid) ?? EMPTY;
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

    if (
      decomp.kind === "batch_receive" ||
      decomp.kind === "renewal_plus_receive" ||
      decomp.kind === "renewal"
    ) {
      const amount =
        decomp.kind === "batch_receive"
          ? decomp.createdAmount
          : decomp.kind === "renewal_plus_receive"
            ? decomp.receiveAmount
            : decomp.createdAmount - decomp.spentAmount;

      if (amount > 0n) {
        const match = findBoardingMatch(amount, false);
        if (match) {
          usedBoardingTxids.add(match.key.boardingTxid);
          boardingSettlement = {
            settledAmount: amount,
            boardingTxid: match.key.boardingTxid,
          };
        }
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

      // Pure payment/settlement rows are fully consumed by boarding reclassification.
      // Mixed rows (renewals) must fall through to the switch to emit the renewal part.
      if (decomp.kind === "batch_receive" || decomp.kind === "settlement") {
        continue;
      }
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

        // Skip the 'Arkade received' payment row if it was already reclassified as boarding_settled
        if (boardingSettlement) break;

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
      case "asset_batch_receive": {
        const batchMeta: NonNullable<Activity["metadata"]> = {
          commitmentTxid,
        };
        if (arkadeAddress) batchMeta.arkadeAddress = arkadeAddress;
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
          metadata: withNetwork(batchMeta, network),
        });
        activities.push(
          buildAssetActivity({
            arkTxid: commitmentTxid,
            timestamp: tsCreated,
            direction: "receive",
            anchorSats: decomp.receiveAmount,
            assetDelta: decomp.assetDelta,
            network,
            settled: true,
          }),
        );
        break;
      }
      case "asset_exit": {
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
          metadata: withNetwork({ commitmentTxid }, network),
        });
        activities.push(
          buildAssetActivity({
            arkTxid: commitmentTxid,
            timestamp: tsAnchor,
            direction: "send",
            anchorSats: decomp.exitAmount,
            assetDelta: decomp.assetDelta,
            network,
            settled: true,
          }),
        );
        break;
      }
      case "asset_settlement": {
        // BTC-neutral commitment with non-zero asset delta. No payment
        // row; the asset row carries the full signal.
        activities.push(
          buildAssetActivity({
            arkTxid: commitmentTxid,
            timestamp: tsAnchor,
            direction: "send",
            anchorSats: 0n,
            assetDelta: decomp.assetDelta,
            network,
            settled: true,
          }),
        );
        break;
      }
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
  const batchTimestampResolver = hasBatchTimestampResolver(getTxCreatedAt)
    ? getTxCreatedAt
    : null;
  const batchedTxCreatedAt = new Map<string, number>();

  if (batchTimestampResolver) {
    const timestampTxids: string[] = [];
    const plannedArkTxids = new Set<string>();
    for (const v of sorted) {
      if (!v.isSpent || !v.arkTxId || plannedArkTxids.has(v.arkTxId)) continue;
      plannedArkTxids.add(v.arkTxId);
      const plan = getOffchainSendPlan(v.arkTxId);
      if (plan.changes.length === 0 && !plan.reuse) {
        timestampTxids.push(v.arkTxId);
      }
    }
    if (timestampTxids.length > 0) {
      try {
        const resolved = await batchTimestampResolver.getMany(timestampTxids);
        for (const [txid, ts] of resolved) batchedTxCreatedAt.set(txid, ts);
      } catch {
        // A batch resolver is an optimization. Missing entries use the row fallback.
      }
    }
  }

  for (const v of sorted) {
    if (!v.status.isLeaf && v.txid) {
      const isChangeOfOwnTx = vtxosByArkTxId.has(v.txid);
      if (!isChangeOfOwnTx && !offchainReceivesEmitted.has(v.txid)) {
        offchainReceivesEmitted.add(v.txid);
        const assets = collectAssets([v]);
        const ts = v.createdAt.getTime();
        if (assets.length > 0) {
          // Asset rows reuse the `arkade:asset:<txid>` id.
          const reuse = tryReuse(activityId("asset", v.txid));
          if (reuse) {
            activities.push(reuse);
          } else {
            activities.push(
              buildAssetActivity({
                arkTxid: v.txid,
                timestamp: ts,
                direction: "receive",
                anchorSats: BigInt(v.value),
                assetDelta: assets,
                network,
                settled: v.status.isLeaf || v.isSpent === true,
              }),
            );
          }
        } else {
          const reuse = tryReuse(activityId("offchain", v.txid));
          if (reuse) {
            activities.push(reuse);
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
    }

    if (v.isSpent && v.arkTxId && !offchainSendsEmitted.has(v.arkTxId)) {
      offchainSendsEmitted.add(v.arkTxId);
      const arkTxId = v.arkTxId;
      const plan = getOffchainSendPlan(arkTxId);
      const { changes, assets, reuse, txAmount } = plan;

      // No-change sends are the hottest cache target: their timestamp
      // requires a network call. Reuse before resolving that timestamp.
      if (reuse) {
        activities.push(reuse);
        continue;
      }

      let resolvedTimestamp: number | undefined;
      if (changes.length === 0) {
        resolvedTimestamp = batchTimestampResolver
          ? batchedTxCreatedAt.get(arkTxId)
          : undefined;
        if (resolvedTimestamp === undefined && getTxCreatedAt) {
          resolvedTimestamp = await getTxCreatedAt(arkTxId);
        }
      }
      const tsTx =
        changes.length > 0
          ? changes[0].createdAt.getTime()
          : (resolvedTimestamp ?? v.createdAt.getTime() + 1);

      if (assets.length > 0) {
        activities.push(
          buildAssetActivity({
            arkTxid: arkTxId,
            timestamp: tsTx,
            direction: "send",
            anchorSats: txAmount,
            assetDelta: assets,
            network,
            settled: true,
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
