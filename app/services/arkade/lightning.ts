import {
  ArkadeSwaps,
  type ArkToBtcResponse,
  type BoltzChainSwap,
  type BoltzReverseSwap,
  type BoltzSubmarineSwap,
  type BoltzSwap,
  type ChainFeesResponse,
  type CreateLightningInvoiceRequest,
  type CreateLightningInvoiceResponse,
  type FeesResponse,
  isChainFinalStatus,
  isChainSwapRefundable,
  isReverseFailedStatus,
  isReverseFinalStatus,
  isSubmarineFailedStatus,
  isSubmarineFinalStatus,
  type LimitsResponse,
  type SendLightningPaymentRequest,
  type SendLightningPaymentResponse,
  type SwapRepository,
  updateReverseSwapStatus,
  updateSubmarineSwapStatus,
} from "@arkade-os/boltz-swap";
import { ExpoArkadeSwaps } from "@arkade-os/boltz-swap/expo";
import type { ArkTransaction, NetworkName, VirtualCoin } from "@arkade-os/sdk";
import { hex } from "@scure/base";
import type {
  ArkadeWalletMetadata,
  LightningResumeTrigger,
  WalletBehavior,
} from "../../store/types";
import { recordError } from "../diagnostics/recorder";
import {
  asBoltzNetwork,
  type BoltzSwapEndpointNotFound,
  boltzApiUrlForNetwork,
  boltzApiUrlsForNetwork,
  boltzLegacyApiUrlsForNetwork,
  boltzPrimaryApiUrlForNetwork,
  createBoltzSwapProvider,
  isLightningSupportedForNetwork,
  resolveBoltzSwapEndpoint,
} from "./boltz-endpoints";
import { mergeChainSwap } from "./chain-swap-merge";
import { ArkadeError, toArkadeError } from "./errors";
import { ensureWallet, getWallet } from "./runtime";
import { getSharedSqlExecutor } from "./storage";
import {
  createSwapRepository,
  drainSwapPollResults,
  ensureSwapBackgroundRegistered,
  rememberSwapBackgroundWallet,
  seedSwapPollTask,
  swapTaskQueue,
} from "./swap-background";
import {
  findUnambiguousHistoryMatch,
  LINKAGE_LOOKAHEAD_MS,
  LINKAGE_LOOKBACK_MS,
} from "./swap-linkage";
import {
  getAllSwapMetadata,
  getSwapMetadata,
  type LocalSwapMetadata,
  linkSwapToWalletTx,
  recordSwapMetadata,
} from "./swap-storage";

type LightningInstance = ArkadeSwaps | ExpoArkadeSwaps;

type ChainArkRefundOutcome = { swept: number; skipped: number };

export {
  boltzApiUrlForNetwork,
  boltzLegacyApiUrlsForNetwork,
  isLightningSupportedForNetwork,
};

let activeWalletId: string | null = null;
let activeNetwork: string | null = null;
let activePromise: Promise<LightningInstance> | null = null;
let activeInstance: LightningInstance | null = null;
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

type LinkageProfile = {
  direction: "in" | "out";
  amountSats: number;
};

/**
 * Project a restorable reverse/submarine swap to the (direction, amount) used
 * by the history-match heuristic. Returns null for chain swaps, failed
 * states or refunded submarine swaps — those should remain separately
 * visible instead of being collapsed into a successful Lightning row.
 */
function linkageProfileFor(
  swap: BoltzSwap,
  meta: LocalSwapMetadata | null,
): LinkageProfile | null {
  if (swap.type === "reverse") {
    if (isReverseFailedStatus(swap.status)) return null;
    const amount = meta?.arkadeAmountSats ?? swap.response.onchainAmount;
    if (amount == null) return null;
    return { direction: "in", amountSats: amount };
  }
  if (swap.type === "submarine") {
    if (isSubmarineFailedStatus(swap.status)) return null;
    if (swap.refunded) return null;
    const amount = meta?.arkadeAmountSats ?? swap.response.expectedAmount;
    if (amount == null) return null;
    return { direction: "out", amountSats: amount };
  }
  return null;
}

/**
 * History-match linkage handshake.
 *
 * After a swap completes live or is recovered during seed-only restore, attempt to link it to the
 * matching Arkade payment row so `mergeActivities` collapses both rows into
 * one Lightning activity. Two paths drive this:
 *
 * - Live (`onSwapCompleted`): the SDK already routes us through here when a
 *   swap finishes during a normal session. The capture-on-create paths
 *   (`send_result`, `receive_claim`) usually fire first; this is the fallback.
 * - Seed-only restore: `restoreLightningActivity` calls this once per restored
 *   swap. With no backup material, this heuristic is the *only* way to
 *   re-establish the `walletTxId` link for both reverse and submarine swaps,
 *   so the user doesn't see a bare "Arkade sent/received" row next to the
 *   Lightning row.
 *
 * Multi-match rule: when 2+ candidate Arkade rows match the swap's
 * (direction, amount, time-window), link none — let both swap rows and both
 * Arkade rows coexist until one reaches a terminal status that disambiguates.
 *
 * The `history` argument is optional. `restoreLightningActivity` fetches it
 * once and reuses it across all restored swaps to avoid N round-trips.
 */
async function attemptSwapLinkage(
  swap: BoltzSwap,
  history?: ArkTransaction[],
): Promise<void> {
  const meta = await getSwapMetadata(swap.id).catch(() => null);
  if (!meta || meta.walletTxId) return;
  const profile = linkageProfileFor(swap, meta);
  if (!profile) return;
  let txHistory: ArkTransaction[];
  if (history) {
    txHistory = history;
  } else {
    try {
      const wallet = await getWallet();
      txHistory = await wallet.getTransactionHistory();
    } catch (e) {
      recordError(
        "swap",
        `swap_linkage_history_unavailable: ${e instanceof Error ? e.message : String(e)}`,
      );
      return;
    }
  }
  const swapCreatedAtMs = swap.createdAt * 1000;
  const txId = findUnambiguousHistoryMatch({
    history: txHistory,
    direction: profile.direction,
    amountSats: profile.amountSats,
    lowerBoundMs: swapCreatedAtMs - LINKAGE_LOOKBACK_MS,
    upperBoundMs: Date.now() + LINKAGE_LOOKAHEAD_MS,
  });
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
  swapBackgroundEnabled: boolean,
): Promise<LightningInstance> {
  const network = asBoltzNetwork(metadata.network);
  const apiUrl = boltzPrimaryApiUrlForNetwork(metadata.network);
  if (!network || !apiUrl) {
    throw new ArkadeError(
      "lightning_unavailable",
      `Lightning is not configured for ${metadata.network}`,
    );
  }
  const wallet = await ensureWallet({ metadata, behavior });
  const swapProvider = createBoltzSwapProvider({ apiUrl, network });
  const swapRepository = createSwapRepository();
  let instance: LightningInstance;
  try {
    await rememberSwapBackgroundWallet(metadata);
    instance = await ExpoArkadeSwaps.setup({
      wallet,
      arkServerUrl: metadata.arkServerUrl,
      swapProvider,
      swapRepository,
      swapManager: true,
      background: {
        taskQueue: swapTaskQueue,
      },
    });
  } catch (e) {
    throw toArkadeError(
      "lightning_init_failed",
      "Failed to initialize Lightning service",
      e,
    );
  }
  if (swapBackgroundEnabled) {
    await ensureSwapBackgroundRegistered().catch(() => {});
    await seedSwapPollTask().catch(() => {});
  }
  await attachSwapManagerSubscriptions(instance);
  return instance;
}

async function attachSwapManagerSubscriptions(
  instance: LightningInstance,
): Promise<void> {
  const manager = instance.getSwapManager();
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
          await attemptSwapLinkage(swap);
        } catch (e) {
          recordError(
            "swap",
            `swap_linkage_failed: ${e instanceof Error ? e.message : String(e)}`,
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
  /**
   * Whether the user has the OS-scheduled swap-poll task enabled. Threaded
   * through here (rather than read from the store) to avoid a service ⇄ store
   * import cycle; `useAppStore` already imports `lightning.ts`.
   */
  swapBackgroundEnabled: boolean;
};

export async function ensureLightning(
  input: EnsureLightningInput,
): Promise<LightningInstance> {
  const { metadata, behavior, swapBackgroundEnabled } = input;
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
  const promise = buildInstance(metadata, behavior, swapBackgroundEnabled).then(
    (swaps) => {
      activeInstance = swaps;
      return swaps;
    },
  );
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

export async function getLightning(): Promise<LightningInstance> {
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
  const repo = createSwapRepository();
  await repo.clear();
}

/**
 * Snapshots every Boltz swap row in the local repository, parsed into
 * `BoltzSwap` objects. Used by the backup-export flow.
 */
export async function snapshotBoltzSwaps(): Promise<BoltzSwap[]> {
  const repo = createSwapRepository();
  return repo.getAllSwaps();
}

/**
 * Restores Boltz swap rows verbatim into the local repository. Used by the
 * backup-import flow. Existing rows with the same id are overwritten (the
 * backup wins) — this matches how the package's `saveSwap` already behaves.
 */
export async function restoreBoltzSwaps(swaps: BoltzSwap[]): Promise<void> {
  if (swaps.length === 0) return;
  const repo = createSwapRepository();
  for (const swap of swaps) {
    await repo.saveSwap(swap);
  }
}

/**
 * Returns the full Boltz swap object for `swapId` from the local repository,
 * or null when no row matches. Reads through a fresh repository handle (like
 * `snapshotBoltzSwaps`) so it works even when the Lightning service has not
 * been initialized this session.
 *
 * WARNING: the returned object carries secret material — the proof-of-payment
 * `preimage` and the raw Boltz request/response — that is deliberately kept
 * out of `Activity.metadata` (see `swap-mappers.ts`). Treat the result as
 * sensitive; it is only assembled for the manual "Copy metadata" support
 * action on the Activity detail screen.
 */
export async function getBoltzSwapById(
  swapId: string,
): Promise<BoltzSwap | null> {
  const repo = createSwapRepository();
  const all = await repo.getAllSwaps();
  return all.find((s) => s.id === swapId) ?? null;
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

export type SendLightningPaymentResult = SendLightningPaymentResponse & {
  swapId: string | null;
};

let lightningSendLock: Promise<unknown> = Promise.resolve();

export async function sendLightningPayment(
  args: SendLightningPaymentRequest,
): Promise<SendLightningPaymentResult> {
  const run = async (): Promise<SendLightningPaymentResult> => {
    const swaps = await getLightning();
    const knownIds = await captureSubmarineSwapIds();
    let response: SendLightningPaymentResponse;
    try {
      response = await swaps.sendLightningPayment(args);
    } catch (e) {
      throw toArkadeError(
        "swap_settle_failed",
        "Failed to send Lightning payment",
        e,
      );
    }
    const swapId = await findNewSubmarineSwapId(knownIds);
    return { ...response, swapId };
  };
  const next = lightningSendLock.catch(() => {}).then(run);
  lightningSendLock = next;
  return next;
}

export async function getLightningLimits(
  network: string,
): Promise<LimitsResponse> {
  if (limitsCache && limitsCache.network === network) {
    return limitsCache.limits;
  }
  const swaps = await getLightning();
  const limits = await swaps.getLimits();
  limitsCache = { network, limits };
  return limits;
}

export async function getLightningFees(network: string): Promise<FeesResponse> {
  if (feesCache && feesCache.network === network) {
    return feesCache.fees;
  }
  const swaps = await getLightning();
  const fees = await swaps.getFees();
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
  const apiUrl = boltzPrimaryApiUrlForNetwork(network);
  const boltzNetwork = asBoltzNetwork(network);
  if (!apiUrl || !boltzNetwork) return null;
  try {
    let fees = feesCache?.network === network ? feesCache.fees : null;
    if (!fees) {
      const provider = createBoltzSwapProvider({
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
  const apiUrl = boltzPrimaryApiUrlForNetwork(network);
  const boltzNetwork = asBoltzNetwork(network);
  if (!apiUrl || !boltzNetwork) return null;
  try {
    let fees = chainFeesCache?.network === network ? chainFeesCache.fees : null;
    let limits =
      chainLimitsCache?.network === network ? chainLimitsCache.limits : null;
    if (!fees || !limits) {
      const provider = createBoltzSwapProvider({
        apiUrl,
        network: boltzNetwork,
      });
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

export type ChainSwapRecoveryEndpointState =
  | { kind: "resolved"; source: "primary" | "legacy"; apiUrl: string }
  | { kind: "not_found" }
  | { kind: "unknown"; error: string };

export type ChainRefundReadiness =
  | "ready"
  | "missing_material"
  | "endpoint_not_found"
  | "not_refundable"
  | "not_found"
  | "unknown";

export type ChainRefundVhtlcState =
  | { kind: "unspent"; totalCount: number; unspentCount: number }
  | { kind: "not_found" }
  | { kind: "spent"; totalCount: number }
  | { kind: "unknown"; error: string };

function normalizeToXOnlyHex(
  keyHex: string,
  label: string,
  swapId: string,
): string {
  const clean = keyHex.trim().toLowerCase();
  if (/^[0-9a-f]{64}$/.test(clean)) return clean;
  if (/^(02|03)[0-9a-f]{64}$/.test(clean)) return clean.slice(2);
  throw new Error(`Swap ${swapId}: invalid ${label} public key length`);
}

function isArkToBtcChainSwap(swap: BoltzChainSwap): boolean {
  return swap.request.from === "ARK" && swap.request.to === "BTC";
}

export function canAttemptArkChainRefund(swap: BoltzChainSwap): boolean {
  return (
    swap.type === "chain" &&
    isArkToBtcChainSwap(swap) &&
    typeof swap.request.preimageHash === "string" &&
    swap.request.preimageHash.length > 0 &&
    typeof swap.response.lockupDetails?.lockupAddress === "string" &&
    swap.response.lockupDetails.lockupAddress.length > 0 &&
    typeof swap.response.lockupDetails?.serverPublicKey === "string" &&
    swap.response.lockupDetails.serverPublicKey.length > 0 &&
    swap.response.lockupDetails?.timeouts != null
  );
}

export async function resolveChainSwapRecoveryEndpoint(
  swapId: string,
): Promise<ChainSwapRecoveryEndpointState> {
  try {
    if (!activeNetwork) {
      return { kind: "unknown", error: "Lightning network is not initialized" };
    }
    const result = await resolveBoltzSwapEndpoint({
      network: activeNetwork,
      swapId,
    });
    if ("kind" in result) return { kind: "not_found" };
    return {
      kind: "resolved",
      source: result.source,
      apiUrl: result.apiUrl,
    };
  } catch (e) {
    return {
      kind: "unknown",
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

export async function inspectArkChainRefundVhtlc(
  swap: BoltzChainSwap,
): Promise<ChainRefundVhtlcState> {
  if (!canAttemptArkChainRefund(swap)) {
    return { kind: "unknown", error: "Chain swap is missing refund details" };
  }
  try {
    const [lightning, wallet] = await Promise.all([
      getLightning(),
      getWallet(),
    ]);
    const arkInfo = await wallet.arkProvider.getInfo();
    const ourXOnlyPublicKey = normalizeToXOnlyHex(
      hex.encode(await wallet.identity.xOnlyPublicKey()),
      "user",
      swap.id,
    );
    const serverXOnlyPublicKey = normalizeToXOnlyHex(
      arkInfo.signerPubkey,
      "server",
      swap.id,
    );
    const boltzXOnlyPublicKey = normalizeToXOnlyHex(
      swap.response.lockupDetails.serverPublicKey,
      "boltz",
      swap.id,
    );
    const timeouts = swap.response.lockupDetails.timeouts;
    if (!timeouts) {
      return {
        kind: "unknown",
        error: "Chain swap is missing refund timeouts",
      };
    }
    const { vhtlcAddress, vhtlcScript } = lightning.createVHTLCScript({
      network: arkInfo.network,
      preimageHash: hex.decode(swap.request.preimageHash),
      serverPubkey: serverXOnlyPublicKey,
      senderPubkey: ourXOnlyPublicKey,
      receiverPubkey: boltzXOnlyPublicKey,
      timeoutBlockHeights: timeouts,
    });
    if (swap.response.lockupDetails.lockupAddress !== vhtlcAddress) {
      return { kind: "unknown", error: "VHTLC address mismatch" };
    }
    const { vtxos } = await wallet.indexerProvider.getVtxos({
      scripts: [hex.encode(vhtlcScript.pkScript)],
    });
    if (vtxos.length === 0) return { kind: "not_found" };
    const unspent = (vtxos as VirtualCoin[]).filter((vtxo) => !vtxo.isSpent);
    if (unspent.length === 0) {
      return { kind: "spent", totalCount: vtxos.length };
    }
    return {
      kind: "unspent",
      totalCount: vtxos.length,
      unspentCount: unspent.length,
    };
  } catch (e) {
    return {
      kind: "unknown",
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

export async function getChainRefundReadinessById(
  swapId: string,
): Promise<ChainRefundReadiness> {
  const swaps = await getLightning().catch(() => null);
  if (!swaps) return "unknown";
  const all = await swaps.swapRepository.getAllSwaps({ type: "chain" });
  const target = all.find((s) => s.id === swapId);
  if (target?.type !== "chain") return "not_found";
  if (!isArkToBtcChainSwap(target) || !isChainSwapRefundable(target)) {
    return "not_refundable";
  }
  if (!canAttemptArkChainRefund(target)) return "missing_material";
  if (!activeNetwork) return "unknown";
  try {
    const endpoint = await resolveBoltzSwapEndpoint({
      network: activeNetwork,
      swapId,
    });
    if ("kind" in endpoint) return "endpoint_not_found";
  } catch {
    return "unknown";
  }
  const vhtlc = await inspectArkChainRefundVhtlc(target);
  return vhtlc.kind === "unspent" ? "ready" : "not_refundable";
}

export async function refundChainSwap(
  pendingSwap: BoltzChainSwap,
): Promise<ChainArkRefundOutcome> {
  try {
    return await refundChainSwapThroughResolvedEndpoint(pendingSwap);
  } catch (e) {
    throw toArkadeError("swap_refund_failed", "Chain swap refund failed", e);
  }
}

async function refundChainSwapThroughResolvedEndpoint(
  target: BoltzChainSwap,
): Promise<ChainArkRefundOutcome> {
  const swaps = await getLightning();
  if (!activeNetwork) {
    throw new ArkadeError(
      "swap_refund_failed",
      "Lightning network is not initialized",
    );
  }
  const network = asBoltzNetwork(activeNetwork);
  if (!network) {
    throw new ArkadeError(
      "swap_refund_failed",
      `Boltz is not configured for ${activeNetwork}`,
    );
  }
  if (!isArkToBtcChainSwap(target)) {
    throw new ArkadeError(
      "swap_refund_failed",
      "Chain swap is not an ARK→BTC refund target",
    );
  }
  const targetStatus = target.status;
  if (!isChainSwapRefundable(target)) {
    throw new ArkadeError(
      "swap_refund_failed",
      `Chain swap is no longer refundable (status ${targetStatus})`,
    );
  }
  if (!canAttemptArkChainRefund(target)) {
    throw new ArkadeError(
      "swap_refund_failed",
      "Chain swap is missing refund details on this device",
    );
  }

  const vhtlc = await inspectArkChainRefundVhtlc(target);
  if (vhtlc.kind === "not_found") {
    throw new ArkadeError(
      "swap_refund_failed",
      "No refundable Arkade VHTLC was found for this swap",
    );
  }
  if (vhtlc.kind === "spent") {
    throw new ArkadeError(
      "swap_refund_failed",
      "The Arkade VHTLC for this swap is already spent",
    );
  }
  if (vhtlc.kind === "unknown") {
    throw new ArkadeError(
      "swap_refund_failed",
      `Chain swap refund readiness could not be verified: ${vhtlc.error}`,
    );
  }

  const endpoint = await resolveBoltzSwapEndpoint({
    network: activeNetwork,
    swapId: target.id,
  });
  if ("kind" in endpoint) {
    throw new ArkadeError(
      "swap_refund_failed",
      "Chain swap was not found on primary or legacy Boltz endpoints",
    );
  }
  if (endpoint.source === "primary") {
    return swaps.refundArk(target);
  }

  const wallet = await getWallet();
  const temporary = await ArkadeSwaps.create({
    wallet,
    swapProvider: createBoltzSwapProvider({
      network,
      apiUrl: endpoint.apiUrl,
    }),
    swapRepository: swaps.swapRepository,
    swapManager: false,
  });
  try {
    return await temporary.refundArk(target);
  } finally {
    await temporary.dispose().catch(() => {});
  }
}

/**
 * Look up a chain swap by id and call refundArk. Re-checks refundability,
 * endpoint ownership, local material, and VHTLC presence so stale Recovery
 * rows cannot drive a doomed refund attempt.
 */
export async function refundChainSwapById(
  swapId: string,
): Promise<ChainArkRefundOutcome> {
  const swaps = await getLightning();
  const all = await swaps.swapRepository.getAllSwaps({ type: "chain" });
  const target = all.find((s) => s.id === swapId);
  if (target?.type !== "chain") {
    throw new ArkadeError(
      "swap_refund_failed",
      "Chain swap not found in local repository",
    );
  }
  try {
    return await refundChainSwapThroughResolvedEndpoint(target);
  } catch (e) {
    if (e instanceof ArkadeError) throw e;
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

async function captureSubmarineSwapIds(): Promise<Set<string>> {
  if (!activeInstance) return new Set();
  try {
    const swaps = await activeInstance.swapRepository.getAllSwaps({
      type: "submarine",
      orderBy: "createdAt",
      orderDirection: "desc",
    });
    return new Set(swaps.map((s) => s.id));
  } catch {
    return new Set();
  }
}

async function findNewSubmarineSwapId(
  knownIds: Set<string>,
): Promise<string | null> {
  if (!activeInstance) return null;
  try {
    const swaps = await activeInstance.swapRepository.getAllSwaps({
      type: "submarine",
      orderBy: "createdAt",
      orderDirection: "desc",
    });
    for (const swap of swaps) {
      if (!knownIds.has(swap.id)) return swap.id;
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

async function recordRestoredLightningMetadata(args: {
  walletId: string;
  restoredAt: number;
  reverseSwaps: BoltzReverseSwap[];
  submarineSwaps: BoltzSubmarineSwap[];
  chainSwaps: BoltzChainSwap[];
}): Promise<void> {
  const writes: Array<Promise<void>> = [];
  for (const swap of args.reverseSwaps) {
    writes.push(
      recordSwapMetadata({
        swapId: swap.id,
        walletId: args.walletId,
        direction: "in",
        createdForFlow: "receive",
        invoiceAmountSats: swap.request.invoiceAmount,
        arkadeAmountSats: swap.response.onchainAmount ?? null,
        paymentHash: swap.request.preimageHash,
        restoredAt: args.restoredAt,
      }),
    );
  }
  for (const swap of args.submarineSwaps) {
    writes.push(
      recordSwapMetadata({
        swapId: swap.id,
        walletId: args.walletId,
        direction: "out",
        createdForFlow: "send",
        invoiceAmountSats: null,
        arkadeAmountSats: swap.response.expectedAmount,
        paymentHash: swap.preimageHash ?? null,
        restoredAt: args.restoredAt,
      }),
    );
  }
  // The send flow only ever creates ARK→BTC chain swaps. Filter explicitly so
  // a hypothetical BTC→ARK row from a future code path isn't recorded with the
  // wrong direction. The original `walletTxId` linkage to the offchain lockup
  // tx is unrecoverable post-restore — without that link, Activity will show
  // the lockup send and the chain swap as separate rows, but at least the
  // direction/amount/hash are present for the merge logic.
  for (const swap of args.chainSwaps) {
    if (swap.request.from !== "ARK" || swap.request.to !== "BTC") continue;
    writes.push(
      recordSwapMetadata({
        swapId: swap.id,
        walletId: args.walletId,
        direction: "out",
        createdForFlow: "send",
        invoiceAmountSats: swap.amount,
        arkadeAmountSats: swap.request.userLockAmount ?? null,
        paymentHash: swap.request.preimageHash,
        restoredAt: args.restoredAt,
      }),
    );
  }
  await Promise.allSettled(writes);
}

type RestoredEndpointSwaps = {
  source: "primary" | "legacy";
  apiUrl: string;
  reverseSwaps: BoltzReverseSwap[];
  submarineSwaps: BoltzSubmarineSwap[];
  chainSwaps: BoltzChainSwap[];
};

async function restoreLightningActivityFromLegacyEndpoint(args: {
  wallet: Awaited<ReturnType<typeof getWallet>>;
  swapRepository: SwapRepository;
  network: NetworkName;
  apiUrl: string;
}): Promise<RestoredEndpointSwaps> {
  const temporary = await ArkadeSwaps.create({
    wallet: args.wallet,
    swapProvider: createBoltzSwapProvider({
      network: args.network,
      apiUrl: args.apiUrl,
    }),
    swapRepository: args.swapRepository,
    swapManager: false,
  });
  try {
    const result = await temporary.restoreSwaps();
    return {
      source: "legacy",
      apiUrl: args.apiUrl,
      reverseSwaps: result.reverseSwaps,
      submarineSwaps: result.submarineSwaps,
      chainSwaps: result.chainSwaps,
    };
  } finally {
    await temporary.dispose().catch(() => {});
  }
}

function mergeRestoredEndpointSwaps(endpointResults: RestoredEndpointSwaps[]): {
  reverseSwaps: BoltzReverseSwap[];
  submarineSwaps: BoltzSubmarineSwap[];
  chainSwaps: BoltzChainSwap[];
} {
  const reverse = new Map<string, BoltzReverseSwap>();
  const submarine = new Map<string, BoltzSubmarineSwap>();
  const chain = new Map<string, BoltzChainSwap>();

  for (const result of endpointResults) {
    for (const swap of result.reverseSwaps) {
      if (!reverse.has(swap.id)) reverse.set(swap.id, swap);
    }
    for (const swap of result.submarineSwaps) {
      if (!submarine.has(swap.id)) submarine.set(swap.id, swap);
    }
    for (const swap of result.chainSwaps) {
      const prior = chain.get(swap.id);
      chain.set(swap.id, prior ? mergeChainSwap(prior, swap) : swap);
    }
  }

  return {
    reverseSwaps: [...reverse.values()],
    submarineSwaps: [...submarine.values()],
    chainSwaps: [...chain.values()],
  };
}

export async function restoreLightningActivity(
  walletId?: string,
): Promise<LightningRestoreSummary> {
  const swaps = await getLightning();
  const networkName = activeNetwork ? asBoltzNetwork(activeNetwork) : null;
  if (!activeNetwork || !networkName) {
    throw new ArkadeError(
      "swap_restore_failed",
      "Boltz is not configured for the active network",
    );
  }

  const restoredAt = Date.now();
  const wallet = await getWallet();
  const endpointResults: RestoredEndpointSwaps[] = [];
  const endpointErrors: string[] = [];
  const [primaryApiUrl, ...legacyApiUrls] =
    boltzApiUrlsForNetwork(activeNetwork);

  try {
    const result = await swaps.restoreSwaps();
    endpointResults.push({
      source: "primary",
      apiUrl: primaryApiUrl,
      reverseSwaps: result.reverseSwaps,
      submarineSwaps: result.submarineSwaps,
      chainSwaps: result.chainSwaps,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    endpointErrors.push(`primary ${primaryApiUrl}: ${message}`);
    recordError("swap", `restore_primary_failed: ${message}`);
  }

  for (const apiUrl of legacyApiUrls) {
    try {
      endpointResults.push(
        await restoreLightningActivityFromLegacyEndpoint({
          wallet,
          swapRepository: swaps.swapRepository,
          network: networkName,
          apiUrl,
        }),
      );
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      endpointErrors.push(`legacy ${apiUrl}: ${message}`);
      recordError("swap", `restore_legacy_failed: ${message}`);
    }
  }

  if (endpointResults.length === 0) {
    throw new ArkadeError(
      "swap_restore_failed",
      "Boltz restore failed for all configured endpoints",
    );
  }

  const result = mergeRestoredEndpointSwaps(endpointResults);
  const restoredSwaps: BoltzSwap[] = [
    ...result.reverseSwaps,
    ...result.submarineSwaps,
    ...result.chainSwaps,
  ];
  await Promise.allSettled(
    restoredSwaps.map((swap) => swaps.swapRepository.saveSwap(swap)),
  );

  if (walletId) {
    await recordRestoredLightningMetadata({
      walletId,
      restoredAt,
      reverseSwaps: result.reverseSwaps,
      submarineSwaps: result.submarineSwaps,
      chainSwaps: result.chainSwaps,
    });

    let history: ArkTransaction[] = [];
    try {
      history = await wallet.getTransactionHistory();
    } catch (e) {
      recordError(
        "swap",
        "restore_linkage_history_unavailable: " +
          (e instanceof Error ? e.message : String(e)),
      );
    }
    if (history.length > 0) {
      const linkageTargets: BoltzSwap[] = [
        ...result.reverseSwaps,
        ...result.submarineSwaps,
      ];
      await Promise.allSettled(
        linkageTargets.map((swap) => attemptSwapLinkage(swap, history)),
      );
    }
  }

  if (endpointErrors.length > 0) {
    recordError("swap", `restore_partial_errors: ${endpointErrors.length}`);
  }

  return {
    reverseCount: result.reverseSwaps.length,
    submarineCount: result.submarineSwaps.length,
    chainCount: result.chainSwaps.length,
  };
}

export type LightningResumeSummary = {
  trigger: LightningResumeTrigger;
  startedAt: number;
  finishedAt: number;
  reverseCount: number;
  submarineCount: number;
  chainCount: number;
  polledCount: number;
  updatedCount: number;
  claimedCount: number;
  refundedCount: number;
  errorCount: number;
  nonTerminalCount: number;
  lastError?: string;
};

function readMetric(
  data: Record<string, unknown> | undefined,
  key: string,
): number {
  const value = data?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function appendError(current: string | undefined, message: string): string {
  return current ? `${current}; ${message}` : message;
}

/**
 * Foreground does not run the swap-poll processor — the SwapManager's
 * WebSocket inside `ExpoArkadeSwaps` already drives real-time status while
 * the app is open. Instead, drain whatever the OS background task pushed to
 * the outbox while we were backgrounded, sum it into resume metrics, and
 * re-seed the task for the next OS wake. No `runTasks` here means no race
 * with a concurrently-firing background task on the shared queue.
 */
async function drainBackgroundSwapPollResults(): Promise<
  Pick<
    LightningResumeSummary,
    | "polledCount"
    | "updatedCount"
    | "claimedCount"
    | "refundedCount"
    | "errorCount"
  >
> {
  const results = await drainSwapPollResults();
  let polledCount = 0;
  let updatedCount = 0;
  let claimedCount = 0;
  let refundedCount = 0;
  let errorCount = 0;
  for (const result of results) {
    const claimed = readMetric(result.data, "claimed");
    const refunded = readMetric(result.data, "refunded");
    polledCount += readMetric(result.data, "polled");
    updatedCount += readMetric(result.data, "updated");
    claimedCount += claimed;
    refundedCount += refunded;
    errorCount += readMetric(result.data, "errors");
    if (result.status === "failed") errorCount += 1;
  }

  return {
    polledCount,
    updatedCount,
    claimedCount,
    refundedCount,
    errorCount,
  };
}

export async function resumeLightningSwaps(args: {
  metadata: ArkadeWalletMetadata;
  behavior: WalletBehavior;
  trigger: LightningResumeTrigger;
  swapBackgroundEnabled: boolean;
}): Promise<LightningResumeSummary> {
  const startedAt = Date.now();
  let reverseCount = 0;
  let submarineCount = 0;
  let chainCount = 0;
  let polledCount = 0;
  let updatedCount = 0;
  let claimedCount = 0;
  let refundedCount = 0;
  let errorCount = 0;
  let lastError: string | undefined;

  try {
    await ensureLightning({
      metadata: args.metadata,
      behavior: args.behavior,
      swapBackgroundEnabled: args.swapBackgroundEnabled,
    });
  } catch (e) {
    const message =
      e instanceof Error
        ? e.message
        : "Lightning service initialization failed";
    return {
      trigger: args.trigger,
      startedAt,
      finishedAt: Date.now(),
      reverseCount,
      submarineCount,
      chainCount,
      polledCount,
      updatedCount,
      claimedCount,
      refundedCount,
      errorCount: errorCount + 1,
      nonTerminalCount: 0,
      lastError: message,
    };
  }

  // `restoreSwaps()` is a chain scan — only run it on cold/locked entry,
  // not on every foreground transition. The SwapManager's WebSocket and the
  // OS background poll keep state in sync once the wallet is live.
  if (args.trigger !== "foreground") {
    try {
      const restored = await restoreLightningActivity(args.metadata.id);
      reverseCount = restored.reverseCount;
      submarineCount = restored.submarineCount;
      chainCount = restored.chainCount;
    } catch (e) {
      const message = e instanceof Error ? e.message : "Restore failed";
      lastError = appendError(lastError, message);
      errorCount += 1;
      recordError("lightning", `resume_restore_failed: ${message}`);
    }
  }

  try {
    const poll = await drainBackgroundSwapPollResults();
    polledCount = poll.polledCount;
    updatedCount = poll.updatedCount;
    claimedCount = poll.claimedCount;
    refundedCount = poll.refundedCount;
    errorCount += poll.errorCount;
  } catch (e) {
    const message = e instanceof Error ? e.message : "Swap poll failed";
    lastError = appendError(lastError, message);
    errorCount += 1;
    recordError("lightning", `resume_swap_poll_failed: ${message}`);
  }

  await refreshSwapsStatus();

  const nonTerminalCount = await getNonTerminalSwapCount().catch(() => 0);
  return {
    trigger: args.trigger,
    startedAt,
    finishedAt: Date.now(),
    reverseCount,
    submarineCount,
    chainCount,
    polledCount,
    updatedCount,
    claimedCount,
    refundedCount,
    errorCount,
    nonTerminalCount,
    lastError,
  };
}

function isEndpointNotFound(
  result: Awaited<ReturnType<typeof resolveBoltzSwapEndpoint>>,
): result is BoltzSwapEndpointNotFound {
  return "kind" in result && result.kind === "not_found";
}

async function refreshOneSwapStatus(swap: BoltzSwap): Promise<void> {
  if (!activeInstance || !activeNetwork) return;
  if (swap.type === "reverse" && isReverseFinalStatus(swap.status)) return;
  if (swap.type === "submarine" && isSubmarineFinalStatus(swap.status)) return;
  if (swap.type === "chain" && isChainFinalStatus(swap.status)) return;

  try {
    const result = await resolveBoltzSwapEndpoint({
      network: activeNetwork,
      swapId: swap.id,
    });
    if (isEndpointNotFound(result)) {
      recordError(
        "swap",
        `refresh_swap_status_not_found: ${swap.type} ${swap.id}`,
      );
      return;
    }
    if (swap.type === "reverse") {
      await updateReverseSwapStatus(
        swap,
        result.status,
        activeInstance.swapRepository.saveSwap.bind(
          activeInstance.swapRepository,
        ),
      );
      return;
    }
    if (swap.type === "submarine") {
      await updateSubmarineSwapStatus(
        swap,
        result.status,
        activeInstance.swapRepository.saveSwap.bind(
          activeInstance.swapRepository,
        ),
      );
      return;
    }
    await activeInstance.swapRepository.saveSwap({
      ...swap,
      status: result.status,
    });
  } catch (e) {
    recordError(
      "swap",
      "refresh_swap_status_failed: " +
        swap.type +
        " " +
        swap.id +
        ": " +
        (e instanceof Error ? e.message : String(e)),
    );
  }
}

/**
 * Pull the latest Boltz status for every non-final swap in the local repo.
 *
 * The SwapManager normally receives status updates over WebSocket and falls
 * back to polling every 30s. But if the WS dropped while the app was
 * backgrounded — or if Boltz pushed invoice.settled in between — the local
 * swap row can stay stuck until the next poll cycle. Calling this on
 * pull-to-refresh closes that gap so titles/statuses line up with reality.
 *
 * Best-effort: returns silently when Lightning is not initialized or the
 * Boltz API is unreachable. Callers should not block their critical path on
 * the result.
 */
export async function refreshSwapsStatus(): Promise<void> {
  if (!activeInstance || !activeNetwork) return;
  try {
    const swaps = await activeInstance.swapRepository.getAllSwaps();
    await Promise.allSettled(swaps.map((swap) => refreshOneSwapStatus(swap)));
  } catch (e) {
    recordError(
      "swap",
      "refresh_swaps_status_failed: " +
        (e instanceof Error ? e.message : String(e)),
    );
  }
}
