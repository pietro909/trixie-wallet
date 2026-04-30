import {
  ArkadeSwaps,
  type ArkToBtcResponse,
  type BoltzChainSwap,
  type BoltzSwap,
  BoltzSwapProvider,
  type ChainFeesResponse,
  type CreateLightningInvoiceRequest,
  type CreateLightningInvoiceResponse,
  type FeesResponse,
  isChainFinalStatus,
  isReverseFinalStatus,
  isReverseSuccessStatus,
  isSubmarineFinalStatus,
  type LimitsResponse,
  type SendLightningPaymentRequest,
  type SendLightningPaymentResponse,
} from "@arkade-os/boltz-swap";
import { SQLiteSwapRepository } from "@arkade-os/boltz-swap/repositories/sqlite";
import { type ArkTransaction, type NetworkName, TxType } from "@arkade-os/sdk";
import type { ArkadeWalletMetadata, WalletBehavior } from "../../store/types";
import { recordError } from "../diagnostics/recorder";
import { ArkadeError, toArkadeError } from "./errors";
import { ensureWallet, getWallet } from "./runtime";
import { getSharedSqlExecutor } from "./storage";
import {
  getAllSwapMetadata,
  getSwapMetadata,
  type LocalSwapMetadata,
  linkSwapToWalletTx,
} from "./swap-storage";

const BOLTZ_API_URLS: Partial<Record<NetworkName, string>> = {
  bitcoin: "https://api.ark.boltz.exchange",
  mutinynet: "https://api.boltz.mutinynet.arkade.sh",
  signet: "https://boltz.signet.arkade.sh",
  regtest: "http://localhost:9069",
};

function asBoltzNetwork(network: string): NetworkName | null {
  const n = network.toLowerCase() as NetworkName;
  return BOLTZ_API_URLS[n] != null ? n : null;
}

export function boltzApiUrlForNetwork(network: string): string | null {
  const n = asBoltzNetwork(network);
  return n ? (BOLTZ_API_URLS[n] ?? null) : null;
}

export function isLightningSupportedForNetwork(
  network: string | null | undefined,
): boolean {
  if (!network) return false;
  return asBoltzNetwork(network) != null;
}

let activeWalletId: string | null = null;
let activeNetwork: string | null = null;
let activePromise: Promise<ArkadeSwaps> | null = null;
let activeInstance: ArkadeSwaps | null = null;
let activeUnsubscribers: Array<() => void> = [];
let limitsCache: { network: string; limits: LimitsResponse } | null = null;
let feesCache: { network: string; fees: FeesResponse } | null = null;
let chainLimitsCache: {
  network: string;
  limits: LimitsResponse;
} | null = null;
let chainFeesCache: {
  network: string;
  fees: ChainFeesResponse;
} | null = null;

export type SwapEventKind = "update" | "completed" | "failed" | "action";
export type SwapEvent = {
  kind: SwapEventKind;
  swap: BoltzSwap;
};

let swapEventListener: ((event: SwapEvent) => void) | null = null;

export function setSwapEventListener(
  listener: ((event: SwapEvent) => void) | null,
): void {
  swapEventListener = listener;
}

function notify(event: SwapEvent): void {
  const listener = swapEventListener;
  if (!listener) return;
  try {
    listener(event);
  } catch (e) {
    // Listener errors must not crash the swap manager.
    recordError(
      "swap",
      `swap_listener_failed: ${event.kind}: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

/**
 * Receive linkage handshake (history-match fallback).
 *
 * After a reverse swap completes, attempt to link it to a fresh incoming
 * Arkade tx so the merged Activity list collapses both rows into one. If the
 * package surface ever exposes a way to capture the claim tx id directly via
 * `SwapManagerCallbacks.claim`, prefer that path with `source: "receive_claim"`.
 *
 * Multi-match rule: when 2+ candidate Arkade rows match the swap's
 * (amount, time-window), link none — let both swap rows and both Arkade rows
 * coexist until one of them reaches a terminal status that disambiguates.
 */
async function attemptReverseLinkage(swap: BoltzSwap): Promise<void> {
  if (swap.type !== "reverse") return;
  if (!isReverseSuccessStatus(swap.status)) return;
  const meta = await getSwapMetadata(swap.id).catch(() => null);
  if (!meta || meta.walletTxId) return;
  const onchainAmount = swap.response.onchainAmount;
  if (onchainAmount == null) return;
  let history: ArkTransaction[];
  try {
    const wallet = await getWallet();
    history = await wallet.getTransactionHistory();
  } catch (e) {
    recordError(
      "swap",
      `reverse_linkage_history_unavailable: ${e instanceof Error ? e.message : String(e)}`,
    );
    return;
  }
  const swapCreatedAtMs = swap.createdAt * 1000;
  const lowerBound = swapCreatedAtMs - 30_000;
  const upperBound = Date.now() + 5_000;
  const matches = history.filter((tx) => {
    if (tx.type !== TxType.TxReceived) return false;
    if (Math.abs(tx.amount) !== onchainAmount) return false;
    return tx.createdAt >= lowerBound && tx.createdAt <= upperBound;
  });
  if (matches.length !== 1) return;
  const txId =
    matches[0].key.arkTxid ||
    matches[0].key.commitmentTxid ||
    matches[0].key.boardingTxid;
  if (!txId) return;
  await linkSwapToWalletTx({
    swapId: swap.id,
    walletTxId: txId,
    source: "history_match",
  }).catch(() => {});
}

function instanceKey(metadata: ArkadeWalletMetadata): string {
  return `${metadata.id}:${metadata.network}`;
}

async function buildInstance(
  metadata: ArkadeWalletMetadata,
  behavior: WalletBehavior,
): Promise<ArkadeSwaps> {
  const network = asBoltzNetwork(metadata.network);
  const apiUrl = network ? BOLTZ_API_URLS[network] : null;
  if (!network || !apiUrl) {
    throw new ArkadeError(
      "lightning_unavailable",
      `Lightning is not configured for ${metadata.network}`,
    );
  }
  const wallet = await ensureWallet({ metadata, behavior });
  const swapProvider = new BoltzSwapProvider({ apiUrl, network });
  const swapRepository = new SQLiteSwapRepository(getSharedSqlExecutor());
  let instance: ArkadeSwaps;
  try {
    instance = await ArkadeSwaps.create({
      wallet,
      swapProvider,
      swapRepository,
      swapManager: true,
    });
  } catch (e) {
    throw toArkadeError(
      "lightning_init_failed",
      "Failed to initialize Lightning service",
      e,
    );
  }
  await attachSwapManagerSubscriptions(instance);
  return instance;
}

async function attachSwapManagerSubscriptions(
  instance: ArkadeSwaps,
): Promise<void> {
  const manager = instance.swapManager;
  if (!manager) return;
  const unsubs: Array<() => void> = [];
  try {
    unsubs.push(
      await manager.onSwapUpdate((swap) => {
        notify({ kind: "update", swap });
      }),
    );
    unsubs.push(
      await manager.onSwapCompleted(async (swap) => {
        try {
          await attemptReverseLinkage(swap);
        } catch (e) {
          recordError(
            "swap",
            `reverse_linkage_failed: ${e instanceof Error ? e.message : String(e)}`,
          );
        }
        notify({ kind: "completed", swap });
      }),
    );
    unsubs.push(
      await manager.onSwapFailed((swap) => {
        notify({ kind: "failed", swap });
      }),
    );
    unsubs.push(
      await manager.onActionExecuted((swap) => {
        notify({ kind: "action", swap });
      }),
    );
    activeUnsubscribers = unsubs;
  } catch (e) {
    recordError(
      "swap",
      `swap_subscription_failed: ${e instanceof Error ? e.message : String(e)}`,
    );
    for (const u of unsubs) {
      try {
        u();
      } catch {
        // ignore
      }
    }
  }
}

function detachSwapManagerSubscriptions(): void {
  for (const u of activeUnsubscribers) {
    try {
      u();
    } catch {
      // ignore
    }
  }
  activeUnsubscribers = [];
}

export type EnsureLightningInput = {
  metadata: ArkadeWalletMetadata;
  behavior: WalletBehavior;
};

export async function ensureLightning(
  input: EnsureLightningInput,
): Promise<ArkadeSwaps> {
  const { metadata, behavior } = input;
  if (!isLightningSupportedForNetwork(metadata.network)) {
    throw new ArkadeError(
      "lightning_unavailable",
      `Lightning is not configured for ${metadata.network}`,
    );
  }
  const nextKey = instanceKey(metadata);
  const currentKey =
    activeWalletId && activeNetwork
      ? `${activeWalletId}:${activeNetwork}`
      : null;
  if (currentKey === nextKey && activeInstance && activePromise) {
    return activePromise;
  }
  await disposeLightning();
  const promise = buildInstance(metadata, behavior).then((swaps) => {
    activeInstance = swaps;
    return swaps;
  });
  activeWalletId = metadata.id;
  activeNetwork = metadata.network;
  activePromise = promise.catch((e) => {
    if (activeWalletId === metadata.id) {
      activeWalletId = null;
      activeNetwork = null;
      activeInstance = null;
      activePromise = null;
    }
    throw e;
  });
  return activePromise;
}

export async function getLightning(): Promise<ArkadeSwaps> {
  if (!activePromise) {
    throw new ArkadeError(
      "lightning_unavailable",
      "Lightning service is not initialized",
    );
  }
  return activePromise;
}

export async function disposeLightning(): Promise<void> {
  const instance = activeInstance;
  detachSwapManagerSubscriptions();
  activeWalletId = null;
  activeNetwork = null;
  activeInstance = null;
  activePromise = null;
  if (instance) {
    try {
      await instance.dispose();
    } catch {
      // best-effort dispose
    }
  }
}

/**
 * Wipe every row from the local Boltz swap repository.
 *
 * The `boltz_swaps` table has no `wallet_id` column — it's a single shared
 * table owned by the boltz-swap package. Without this, swaps recorded by a
 * prior wallet remain visible in a freshly-created wallet's Activity feed.
 * Caller must `disposeLightning()` first.
 */
export async function clearAllSwaps(): Promise<void> {
  const repo = new SQLiteSwapRepository(getSharedSqlExecutor());
  await repo.clear();
}

/**
 * Snapshots every Boltz swap row in the local repository, parsed into
 * `BoltzSwap` objects. Used by the backup-export flow.
 */
export async function snapshotBoltzSwaps(): Promise<BoltzSwap[]> {
  const repo = new SQLiteSwapRepository(getSharedSqlExecutor());
  return repo.getAllSwaps();
}

/**
 * Restores Boltz swap rows verbatim into the local repository. Used by the
 * backup-import flow. Existing rows with the same id are overwritten (the
 * backup wins) — this matches how the package's `saveSwap` already behaves.
 */
export async function restoreBoltzSwaps(swaps: BoltzSwap[]): Promise<void> {
  if (swaps.length === 0) return;
  const repo = new SQLiteSwapRepository(getSharedSqlExecutor());
  for (const swap of swaps) {
    await repo.saveSwap(swap);
  }
}

/**
 * Returns the timestamp of the most recent Boltz swap row, in milliseconds
 * since epoch. Null when no rows exist.
 *
 * The `boltz_swaps` table records `created_at` (seconds, populated by the
 * package). It has no `updated_at` column, so this is a lower bound on
 * "latest write" — sufficient for the backup-health calculation, which
 * combines this with an in-memory `dirtyForBackup` flag bumped on every
 * swap event.
 */
export async function getLatestBoltzSwapWriteAt(): Promise<number | null> {
  const exec = getSharedSqlExecutor();
  try {
    const row = await exec.get<{ ts: number | null }>(
      `SELECT MAX(created_at) AS ts FROM boltz_swaps`,
    );
    if (row?.ts == null) return null;
    // The package stores `created_at` in seconds. Convert to ms for parity
    // with `trixie_swap_meta.updated_at`.
    return row.ts * 1000;
  } catch {
    // Table may not exist yet (no Boltz interaction has happened).
    return null;
  }
}

export async function createLightningInvoice(
  args: CreateLightningInvoiceRequest,
): Promise<CreateLightningInvoiceResponse> {
  const swaps = await getLightning();
  try {
    return await swaps.createLightningInvoice(args);
  } catch (e) {
    throw toArkadeError(
      "swap_create_failed",
      "Failed to create Lightning invoice",
      e,
    );
  }
}

export async function sendLightningPayment(
  args: SendLightningPaymentRequest,
): Promise<SendLightningPaymentResponse> {
  const swaps = await getLightning();
  try {
    return await swaps.sendLightningPayment(args);
  } catch (e) {
    throw toArkadeError(
      "swap_settle_failed",
      "Failed to send Lightning payment",
      e,
    );
  }
}

export async function getLightningLimits(
  network: string,
): Promise<LimitsResponse> {
  if (limitsCache && limitsCache.network === network) {
    return limitsCache.limits;
  }
  const swaps = await getLightning();
  const limits = await swaps.swapProvider.getLimits();
  limitsCache = { network, limits };
  return limits;
}

export async function getLightningFees(network: string): Promise<FeesResponse> {
  if (feesCache && feesCache.network === network) {
    return feesCache.fees;
  }
  const swaps = await getLightning();
  const fees = await swaps.swapProvider.getFees();
  feesCache = { network, fees };
  return fees;
}

export type SubmarineFeeQuote = {
  feeSats: number;
  percentage: number;
  minerFeesSats: number;
};

/**
 * Estimate the fee for paying a Lightning invoice (submarine swap) without
 * needing an active `ArkadeSwaps` instance. Fetches Boltz fees through a
 * standalone provider so the Review screen can render a real number before
 * the user taps Send. Returns null when Lightning is not supported on the
 * active network or the fee fetch fails (caller falls back to a generic
 * message).
 */
export async function quoteSubmarineSwapFee(
  network: string,
  amountSats: number,
): Promise<SubmarineFeeQuote | null> {
  const apiUrl = boltzApiUrlForNetwork(network);
  const boltzNetwork = asBoltzNetwork(network);
  if (!apiUrl || !boltzNetwork) return null;
  try {
    let fees = feesCache?.network === network ? feesCache.fees : null;
    if (!fees) {
      const provider = new BoltzSwapProvider({
        apiUrl,
        network: boltzNetwork,
      });
      fees = await provider.getFees();
      feesCache = { network, fees };
    }
    const percentage = fees.submarine.percentage;
    const minerFeesSats = fees.submarine.minerFees;
    const feeSats = Math.ceil((amountSats * percentage) / 100) + minerFeesSats;
    return { feeSats, percentage, minerFeesSats };
  } catch {
    return null;
  }
}

export function clearLightningCaches(): void {
  limitsCache = null;
  feesCache = null;
  chainLimitsCache = null;
  chainFeesCache = null;
}

export type ChainSwapQuote = {
  feeSats: number;
  percentage: number;
  /** Sum of server miner fee + user claim miner fee (lockup is offchain → 0 on Arkade side). */
  minerFeeSats: number;
  withinLimits: boolean;
  min: number;
  max: number;
};

/**
 * Estimate the fee for an ARK → BTC chain swap without creating one. Mirrors
 * `quoteSubmarineSwapFee`'s shape: standalone provider so the Review screen
 * can render real numbers before the user taps Send. Returns null when the
 * network does not have Boltz configured or the fee fetch fails.
 *
 * Cost formula matches `../wallet/src/providers/swaps.tsx`'s
 * `calcArkToBtcSwapFee`: `ceil(amount * pct / 100) + minerFees.server +
 * minerFees.user.claim`. The lockup miner fee is ignored on the user side
 * because the lockup leg is offchain (vtxo → Boltz address), not a mainnet tx.
 */
export async function quoteArkToBtcChainSwap(
  network: string,
  amountSats: number,
): Promise<ChainSwapQuote | null> {
  const apiUrl = boltzApiUrlForNetwork(network);
  const boltzNetwork = asBoltzNetwork(network);
  if (!apiUrl || !boltzNetwork) return null;
  try {
    let fees = chainFeesCache?.network === network ? chainFeesCache.fees : null;
    let limits =
      chainLimitsCache?.network === network ? chainLimitsCache.limits : null;
    if (!fees || !limits) {
      const provider = new BoltzSwapProvider({ apiUrl, network: boltzNetwork });
      const [f, l] = await Promise.all([
        provider.getChainFees("ARK", "BTC"),
        provider.getChainLimits("ARK", "BTC"),
      ]);
      fees = f;
      limits = l;
      chainFeesCache = { network, fees };
      chainLimitsCache = { network, limits };
    }
    const percentage = fees.percentage;
    const minerFeeSats = fees.minerFees.server + fees.minerFees.user.claim;
    const feeSats = Math.ceil((amountSats * percentage) / 100) + minerFeeSats;
    const withinLimits = amountSats >= limits.min && amountSats <= limits.max;
    return {
      feeSats,
      percentage,
      minerFeeSats,
      withinLimits,
      min: limits.min,
      max: limits.max,
    };
  } catch {
    return null;
  }
}

export async function createArkToBtcChainSwap(args: {
  btcAddress: string;
  /** Amount the destination receives. */
  receiverLockAmount: number;
}): Promise<ArkToBtcResponse> {
  const swaps = await getLightning();
  try {
    return await swaps.arkToBtc({
      btcAddress: args.btcAddress,
      receiverLockAmount: args.receiverLockAmount,
    });
  } catch (e) {
    throw toArkadeError("swap_create_failed", "Failed to create chain swap", e);
  }
}

export async function waitAndClaimChainSwap(
  pendingSwap: BoltzChainSwap,
): Promise<{ txid: string }> {
  const swaps = await getLightning();
  try {
    return await swaps.waitAndClaimBtc(pendingSwap);
  } catch (e) {
    throw toArkadeError("swap_settle_failed", "Chain swap claim failed", e);
  }
}

export async function refundChainSwap(
  pendingSwap: BoltzChainSwap,
): Promise<void> {
  const swaps = await getLightning();
  try {
    await swaps.refundArk(pendingSwap);
  } catch (e) {
    throw toArkadeError("swap_refund_failed", "Chain swap refund failed", e);
  }
}

/**
 * Look up a chain swap by id and call `refundArk`. Used by the Activity
 * detail screen, which only knows the swap id (not the full swap object).
 * Throws `swap_refund_failed` when the swap is missing or not a chain swap.
 */
export async function refundChainSwapById(swapId: string): Promise<void> {
  const swaps = await getLightning();
  const all = await swaps.swapRepository.getAllSwaps({ type: "chain" });
  const target = all.find((s) => s.id === swapId);
  if (!target || target.type !== "chain") {
    throw new ArkadeError(
      "swap_refund_failed",
      "Chain swap not found in local repository",
    );
  }
  try {
    await swaps.refundArk(target);
  } catch (e) {
    throw toArkadeError("swap_refund_failed", "Chain swap refund failed", e);
  }
}

export type LightningActivitySources = {
  swaps: BoltzSwap[];
  metadata: LocalSwapMetadata[];
};

/**
 * Returns the raw inputs needed by `mergeActivities` from the Lightning side.
 * Returns empty arrays when Lightning is not initialized — callers can merge
 * unconditionally without checking for support first.
 */
export async function getLightningActivitySources(
  walletId: string,
): Promise<LightningActivitySources> {
  if (!activeInstance) {
    return { swaps: [], metadata: [] };
  }
  try {
    const [swaps, metadata] = await Promise.all([
      activeInstance.swapRepository.getAllSwaps({
        orderBy: "createdAt",
        orderDirection: "desc",
      }),
      getAllSwapMetadata(walletId),
    ]);
    return { swaps, metadata };
  } catch (e) {
    recordError(
      "activity",
      `lightning_activity_sources_failed: ${e instanceof Error ? e.message : String(e)}`,
    );
    return { swaps: [], metadata: [] };
  }
}

function isSwapNonTerminal(swap: BoltzSwap): boolean {
  if (swap.type === "reverse") return !isReverseFinalStatus(swap.status);
  if (swap.type === "submarine") return !isSubmarineFinalStatus(swap.status);
  return !isChainFinalStatus(swap.status);
}

/**
 * Returns the count of swaps still in a non-terminal Boltz status. Used to
 * gate destructive flows (reset, network switch). Returns 0 when Lightning is
 * not initialized.
 */
export async function getNonTerminalSwapCount(): Promise<number> {
  if (!activeInstance) return 0;
  try {
    const swaps = await activeInstance.swapRepository.getAllSwaps();
    return swaps.filter(isSwapNonTerminal).length;
  } catch {
    return 0;
  }
}

/**
 * Returns the most recent submarine swap id created at or after `afterTs`.
 * Used by the send flow to bridge `sendLightningPayment`'s `txid`-only response
 * back to the swap row in the repository for linkage. Returns null if no fresh
 * candidate is found.
 */
export async function findRecentSubmarineSwapId(
  afterTs: number,
): Promise<string | null> {
  if (!activeInstance) return null;
  try {
    const swaps = await activeInstance.swapRepository.getAllSwaps({
      type: "submarine",
      orderBy: "createdAt",
      orderDirection: "desc",
    });
    for (const swap of swaps) {
      if (swap.createdAt * 1000 >= afterTs) return swap.id;
    }
  } catch {
    // ignore
  }
  return null;
}

export type LightningRestoreSummary = {
  reverseCount: number;
  submarineCount: number;
  chainCount: number;
};

export async function restoreLightningActivity(): Promise<LightningRestoreSummary> {
  const swaps = await getLightning();
  try {
    const result = await swaps.restoreSwaps();
    return {
      reverseCount: result.reverseSwaps.length,
      submarineCount: result.submarineSwaps.length,
      chainCount: result.chainSwaps.length,
    };
  } catch (e) {
    throw toArkadeError(
      "swap_restore_failed",
      "Failed to restore Lightning activity",
      e,
    );
  }
}

/**
 * Pull the latest Boltz status for every non-final swap in the local repo.
 *
 * The SwapManager normally receives status updates over WebSocket and falls
 * back to polling every 30s. But if the WS dropped while the app was
 * backgrounded — or if Boltz pushed `invoice.settled` in between — the local
 * swap row can stay stuck at `transaction.confirmed` until the next poll
 * cycle. Calling this on pull-to-refresh closes that gap so titles/statuses
 * line up with reality immediately.
 *
 * Best-effort: returns silently when Lightning is not initialized or the
 * Boltz API is unreachable. Callers should not block their critical path on
 * the result.
 */
export async function refreshSwapsStatus(): Promise<void> {
  if (!activeInstance) return;
  try {
    await activeInstance.refreshSwapsStatus();
  } catch {
    // best-effort; the next polling cycle will catch up
  }
}
