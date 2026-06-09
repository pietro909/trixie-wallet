import {
  type IncomingFunds,
  RestDelegatorProvider,
  Wallet,
} from "@arkade-os/sdk";
import {
  ExpoArkProvider,
  ExpoIndexerProvider,
} from "@arkade-os/sdk/adapters/expo";
import type {
  Activity,
  ArkadeServerInfo,
  ArkadeWalletMetadata,
  WalletBehavior,
} from "../../store/types";
import { recordError } from "../diagnostics/recorder";
import { getActivityHistory } from "./activity-history";
import { ArkadeError, toArkadeError } from "./errors";
import {
  buildIdentityFromSecret,
  bytesToHex,
  type IdentityArtifacts,
} from "./identity";
import {
  defaultDelegatorUrlForNetwork,
  isMainnetForNetworkName,
} from "./network";
import { readSecret, type StoredSecret } from "./secret-store";
import { clearWalletData, createRepositories } from "./storage";
import { clearAllTimestamps } from "./tx-cache";

export type WalletSnapshot = {
  publicKeyHex: string;
  arkAddress: string;
  boardingAddress: string;
  balance: {
    available: number;
    total: number;
    settled: number;
    preconfirmed: number;
    boardingTotal: number;
    /**
     * Per-asset balances reported by `wallet.getBalance()`. Stringified
     * bigint amounts (BigInt does not survive `JSON.stringify`). Sorted
     * by amount desc, then by assetId for stable ordering.
     */
    assets: Array<{ assetId: string; amount: string }>;
  };
  activities: Activity[];
};

let activeWalletId: string | null = null;
let activeBehaviorKey: string | null = null;
let activeWalletMode: "static" | "hd" | null = null;
let activeWalletPromise: Promise<Wallet> | null = null;
let activeWalletInstance: Wallet | null = null;
let incomingFundsListener: ((funds: IncomingFunds) => void) | null = null;
let incomingFundsUnsubscribe: (() => void) | null = null;

export function setIncomingFundsListener(
  listener: ((funds: IncomingFunds) => void) | null,
): void {
  incomingFundsListener = listener;
}

async function attachIncomingFundsSubscription(wallet: Wallet): Promise<void> {
  detachIncomingFundsSubscription();
  try {
    incomingFundsUnsubscribe = await wallet.notifyIncomingFunds((funds) => {
      const listener = incomingFundsListener;
      if (!listener) return;
      try {
        listener(funds);
      } catch (e) {
        // Listener errors must not crash the SSE / mempool watchers.
        recordError(
          "wallet",
          `incoming_funds_listener_failed: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    });
  } catch (e) {
    // Best-effort; activity will still update on the next manual refresh.
    recordError(
      "wallet",
      `incoming_funds_subscribe_failed: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

function detachIncomingFundsSubscription(): void {
  const stop = incomingFundsUnsubscribe;
  incomingFundsUnsubscribe = null;
  if (stop) {
    try {
      stop();
    } catch {
      // ignore
    }
  }
}

function behaviorKey(behavior: WalletBehavior): string {
  return `${behavior.vtxoAutoRenewal ? "renew" : "manual"}:${
    behavior.delegatedRenewal ? "delegate" : "self"
  }`;
}

async function fetchServerInfo(
  arkServerUrl: string,
): Promise<ArkadeServerInfo> {
  try {
    const provider = new ExpoArkProvider(arkServerUrl);
    const info = await provider.getInfo();
    return {
      network: info.network,
      version: info.version,
      signerPubkey: info.signerPubkey,
      forfeitAddress: info.forfeitAddress,
      dustSats: Number(info.dust),
      unilateralExitDelaySeconds: Number(info.unilateralExitDelay),
      txFeeRate: info.fees.txFeeRate,
      intentFee: {
        offchainInput: info.fees.intentFee.offchainInput,
        onchainInput: info.fees.intentFee.onchainInput,
        offchainOutput: info.fees.intentFee.offchainOutput,
        onchainOutput: info.fees.intentFee.onchainOutput,
      },
    };
  } catch (e) {
    throw toArkadeError(
      "server_unreachable",
      `Could not reach Arkade server at ${arkServerUrl}`,
      e,
    );
  }
}

async function fetchServerNetwork(arkServerUrl: string): Promise<string> {
  const info = await fetchServerInfo(arkServerUrl);
  return info.network;
}

export async function probeServer(
  arkServerUrl: string,
): Promise<ArkadeServerInfo> {
  return fetchServerInfo(arkServerUrl);
}

function jsonifyDeep(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(jsonifyDeep);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = jsonifyDeep(v);
    }
    return out;
  }
  return value;
}

export async function fetchRawServerInfo(
  arkServerUrl: string,
): Promise<Record<string, unknown>> {
  try {
    const provider = new ExpoArkProvider(arkServerUrl);
    const info = await provider.getInfo();
    return jsonifyDeep(info) as Record<string, unknown>;
  } catch (e) {
    throw toArkadeError(
      "server_unreachable",
      `Could not reach Arkade server at ${arkServerUrl}`,
      e,
    );
  }
}

async function buildWallet(
  walletId: string,
  artifacts: IdentityArtifacts,
  arkServerUrl: string,
  network: string,
  behavior: WalletBehavior,
  walletMode: "static" | "hd",
  esploraUrl?: string,
): Promise<Wallet> {
  const repos = createRepositories(walletId);
  const delegatorUrl = behavior.delegatedRenewal
    ? defaultDelegatorUrlForNetwork(network)
    : null;
  if (behavior.delegatedRenewal && !delegatorUrl) {
    throw new ArkadeError(
      "delegator_unavailable",
      `No default Arkade delegate is configured for ${network}`,
    );
  }
  const settlementConfig =
    behavior.vtxoAutoRenewal || behavior.delegatedRenewal
      ? {
          vtxoThreshold: 60 * 60 * 24 * 3,
          boardingUtxoSweep: true,
          pollIntervalMs: 60_000,
        }
      : false;

  try {
    return await Wallet.create({
      identity: artifacts.identity,
      walletMode,
      arkServerUrl,
      arkProvider: new ExpoArkProvider(arkServerUrl),
      indexerProvider: new ExpoIndexerProvider(arkServerUrl),
      delegatorProvider: delegatorUrl
        ? new RestDelegatorProvider(delegatorUrl)
        : undefined,
      esploraUrl,
      storage: {
        walletRepository: repos.walletRepository,
        contractRepository: repos.contractRepository,
      },
      settlementConfig,
    });
  } catch (e) {
    throw toArkadeError(
      "wallet_init_failed",
      "Failed to initialize Arkade wallet",
      e,
    );
  }
}

export type SnapshotWalletOptions = {
  /** Active network — stamped onto every emitted Activity for offline detail rendering. */
  network?: string | null;
  /**
   * Previously built Activity rows. Confirmed rows with matching ids are
   * reused verbatim by the activity builder, skipping the per-row derivation
   * and any network-bound timestamp fetches.
   */
  previousActivities?: Activity[];
};

export async function snapshotWallet(
  wallet: Wallet,
  arkServerUrl: string,
  options: SnapshotWalletOptions = {},
): Promise<WalletSnapshot> {
  try {
    const [publicKeyBytes, arkAddress, boardingAddress, balance] =
      await Promise.all([
        wallet.identity.compressedPublicKey(),
        wallet.getAddress(),
        wallet.getBoardingAddress(),
        wallet.getBalance(),
      ]);
    const activities = await getActivityHistory(wallet, arkServerUrl, {
      network: options.network ?? null,
      arkadeAddress: arkAddress,
      boardingAddress,
      previousActivities: options.previousActivities,
    });
    const assetEntries = (balance.assets ?? [])
      .filter((a) => a.amount !== 0n)
      .map((a) => ({ assetId: a.assetId, amount: a.amount.toString() }))
      .sort((a, b) => {
        const av = BigInt(a.amount);
        const bv = BigInt(b.amount);
        if (av === bv) return a.assetId.localeCompare(b.assetId);
        return bv > av ? 1 : -1;
      });
    return {
      publicKeyHex: bytesToHex(publicKeyBytes),
      arkAddress,
      boardingAddress,
      balance: {
        available: balance.available,
        total: balance.total,
        settled: balance.settled,
        preconfirmed: balance.preconfirmed,
        boardingTotal: balance.boarding.total,
        assets: assetEntries,
      },
      activities,
    };
  } catch (e) {
    throw toArkadeError("refresh_failed", "Failed to refresh wallet state", e);
  }
}

export type CreateWalletInput = {
  walletId: string;
  artifacts: IdentityArtifacts;
  arkServerUrl: string;
  network: string;
  behavior: WalletBehavior;
  walletMode: "static" | "hd";
  esploraUrl?: string;
};

export async function createWalletInstance(
  input: CreateWalletInput,
): Promise<{ wallet: Wallet; snapshot: WalletSnapshot }> {
  const wallet = await buildWallet(
    input.walletId,
    input.artifacts,
    input.arkServerUrl,
    input.network,
    input.behavior,
    input.walletMode,
    input.esploraUrl,
  );
  activeWalletId = input.walletId;
  activeBehaviorKey = behaviorKey(input.behavior);
  activeWalletMode = input.walletMode;
  activeWalletInstance = wallet;
  activeWalletPromise = Promise.resolve(wallet);
  await attachIncomingFundsSubscription(wallet);
  const snapshot = await snapshotWallet(wallet, input.arkServerUrl, {
    network: input.network,
  });
  return { wallet, snapshot };
}

export type RestoreStage = "initializing" | "scanning" | "syncing";

export type RestoreWalletInput = CreateWalletInput & {
  gapLimit?: number;
  onStage?: (stage: RestoreStage) => void;
};

export async function restoreWalletInstance(
  input: RestoreWalletInput,
): Promise<{ wallet: Wallet; snapshot: WalletSnapshot }> {
  input.onStage?.("initializing");
  const wallet = await buildWallet(
    input.walletId,
    input.artifacts,
    input.arkServerUrl,
    input.network,
    input.behavior,
    input.walletMode,
    input.esploraUrl,
  );

  if (
    input.walletMode === "hd" &&
    input.artifacts.identityKind === "mnemonic"
  ) {
    input.onStage?.("scanning");
    await wallet.restore({ gapLimit: input.gapLimit ?? 20 });
  }

  activeWalletId = input.walletId;
  activeBehaviorKey = behaviorKey(input.behavior);
  activeWalletMode = input.walletMode;
  activeWalletInstance = wallet;
  activeWalletPromise = Promise.resolve(wallet);
  await attachIncomingFundsSubscription(wallet);

  input.onStage?.("syncing");
  const snapshot = await snapshotWallet(wallet, input.arkServerUrl, {
    network: input.network,
  });
  return { wallet, snapshot };
}

export type EnsureWalletInput = {
  metadata: ArkadeWalletMetadata;
  behavior: WalletBehavior;
};

export async function ensureWallet(input: EnsureWalletInput): Promise<Wallet> {
  const { behavior, metadata } = input;
  const nextBehaviorKey = behaviorKey(behavior);
  if (
    activeWalletId === metadata.id &&
    activeBehaviorKey === nextBehaviorKey &&
    activeWalletMode === metadata.walletMode &&
    activeWalletInstance &&
    activeWalletPromise
  ) {
    return activeWalletPromise;
  }
  await disposeWallet();
  const promise = (async () => {
    const secret: StoredSecret = await readSecret(metadata.id);
    const network =
      metadata.network ?? (await fetchServerNetwork(metadata.arkServerUrl));
    const artifacts = buildIdentityFromSecret(
      secret,
      isMainnetForNetworkName(network),
    );
    const wallet = await buildWallet(
      metadata.id,
      artifacts,
      metadata.arkServerUrl,
      network,
      behavior,
      metadata.walletMode,
      metadata.esploraUrl,
    );
    activeWalletInstance = wallet;
    await attachIncomingFundsSubscription(wallet);
    return wallet;
  })();
  activeWalletId = metadata.id;
  activeBehaviorKey = nextBehaviorKey;
  activeWalletMode = metadata.walletMode;
  activeWalletPromise = promise.catch((e) => {
    if (activeWalletId === metadata.id) {
      activeWalletId = null;
      activeBehaviorKey = null;
      activeWalletMode = null;
      activeWalletInstance = null;
      activeWalletPromise = null;
    }
    throw e;
  });
  return activeWalletPromise;
}

export async function getWallet(): Promise<Wallet> {
  if (!activeWalletPromise) {
    throw new ArkadeError(
      "wallet_not_ready",
      "Arkade wallet is not initialized",
    );
  }
  return activeWalletPromise;
}

export async function refreshWalletSnapshot(
  metadata: ArkadeWalletMetadata,
  behavior: WalletBehavior,
): Promise<WalletSnapshot> {
  const wallet = await ensureWallet({ behavior, metadata });
  return snapshotWallet(wallet, metadata.arkServerUrl, {
    network: metadata.network,
    // Hand the stored Arkade rows to the builder so confirmed history is
    // reused verbatim instead of being rederived (and re-fetching no-change
    // off-chain send timestamps from the indexer).
    previousActivities: metadata.activities,
  });
}

export async function disposeWallet(): Promise<void> {
  const instance = activeWalletInstance;
  detachIncomingFundsSubscription();
  activeWalletId = null;
  activeBehaviorKey = null;
  activeWalletMode = null;
  activeWalletInstance = null;
  activeWalletPromise = null;
  if (instance) {
    try {
      await instance.dispose();
    } catch {
      // best-effort dispose; ignore secondary errors
    }
  }
}

export async function clearAllWalletData(walletId: string): Promise<void> {
  await disposeWallet();
  try {
    await clearWalletData(walletId);
  } catch (e) {
    throw toArkadeError(
      "wallet_init_failed",
      "Failed to clear wallet repositories",
      e,
    );
  }
  // Shared (non-wallet-prefixed) caches must also be wiped on reset so a
  // fresh wallet doesn't inherit timestamps from the previous identity.
  await clearAllTimestamps();
}
