import {
  ArkadeSwaps,
  type BoltzSwap,
  BoltzSwapProvider,
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
  } catch {
    // listener errors must not crash the swap manager
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
  } catch {
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
        } catch {
          // best-effort linkage
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
  } catch {
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

export function clearLightningCaches(): void {
  limitsCache = null;
  feesCache = null;
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
  } catch {
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
