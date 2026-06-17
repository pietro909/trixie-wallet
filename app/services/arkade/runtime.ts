import {
  type ArkInfo,
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

type ServerInfoChangedListener = (
  info: ArkadeServerInfo,
) => void | Promise<void>;

let serverInfoChangedListener: ServerInfoChangedListener | null = null;
let serverInfoUnsubscribe: (() => void) | null = null;
/**
 * Tail of the chain of app-listener invocations triggered by
 * `onServerInfoChanged`. The SDK fires its listeners synchronously and does
 * NOT await returned promises before throwing `DigestMismatchError`, so the
 * digest-retry path needs an explicit barrier — {@link
 * waitForServerInfoChangedListener} — to know when our persisted `serverInfo`
 * and transient signer status have caught up with the SDK event.
 */
let serverInfoListenerChain: Promise<void> = Promise.resolve();

export function setIncomingFundsListener(
  listener: ((funds: IncomingFunds) => void) | null,
): void {
  incomingFundsListener = listener;
}

/**
 * Install the app-side server-info listener. Mirrors
 * {@link setIncomingFundsListener}: the store wires this up after creation so
 * `runtime.ts` never imports the store.
 */
export function setServerInfoChangedListener(
  listener: ServerInfoChangedListener | null,
): void {
  serverInfoChangedListener = listener;
}

/**
 * Resolve once the most recent `onServerInfoChanged` listener work has settled
 * (handled or logged — never rejects, so it cannot mask an original digest
 * retry). Digest-retry code awaits this before rebuilding so it does not race
 * the async store listener.
 */
export function waitForServerInfoChangedListener(): Promise<void> {
  return serverInfoListenerChain;
}

function attachServerInfoSubscription(provider: ExpoArkProvider): void {
  detachServerInfoSubscription();
  try {
    serverInfoUnsubscribe = provider.onServerInfoChanged((info) => {
      const listener = serverInfoChangedListener;
      let converted: ArkadeServerInfo;
      try {
        converted = arkInfoToServerInfo(info);
      } catch (e) {
        recordError(
          "server",
          `server_info_convert_failed: ${e instanceof Error ? e.message : String(e)}`,
        );
        return;
      }
      // Chain the listener work so `waitForServerInfoChangedListener` can act
      // as a barrier. Errors are recorded inside the chain and swallowed — they
      // must never throw back into the provider's synchronous emit loop, and
      // the wait helper must resolve (not reject) so digest retry proceeds.
      serverInfoListenerChain = serverInfoListenerChain
        .catch(() => undefined)
        .then(() => (listener ? listener(converted) : undefined))
        .then(
          () => undefined,
          (e) => {
            recordError(
              "server",
              `server_info_changed_listener_failed: ${e instanceof Error ? e.message : String(e)}`,
            );
          },
        );
    });
  } catch (e) {
    recordError(
      "server",
      `server_info_subscribe_failed: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

function detachServerInfoSubscription(): void {
  const stop = serverInfoUnsubscribe;
  serverInfoUnsubscribe = null;
  if (stop) {
    try {
      stop();
    } catch {
      // ignore
    }
  }
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

/**
 * Single source of truth for `ArkInfo` → {@link ArkadeServerInfo}. Used by
 * `fetchServerInfo`, `probeServer`, create/restore setup, and the mid-session
 * `onServerInfoChanged` bridge so every server-info sync path produces the same
 * shape. Each `deprecatedSigners[].cutoffDate` (`bigint`) is serialized as a
 * decimal string so the persisted blob round-trips safely.
 */
export function arkInfoToServerInfo(info: ArkInfo): ArkadeServerInfo {
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
    deprecatedSigners: info.deprecatedSigners.map((s) => ({
      pubkey: s.pubkey,
      cutoffDateSeconds: s.cutoffDate.toString(),
    })),
  };
}

async function fetchServerInfo(
  arkServerUrl: string,
): Promise<ArkadeServerInfo> {
  try {
    const provider = new ExpoArkProvider(arkServerUrl);
    const info = await provider.getInfo();
    return arkInfoToServerInfo(info);
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

type BuiltWallet = {
  wallet: Wallet;
  /**
   * The exact `ExpoArkProvider` instance handed to `Wallet.create`. The
   * caller subscribes to its `onServerInfoChanged` stream; subscribing to a
   * different instance would never fire. {@link buildWallet} itself does not
   * subscribe (no module-state side effects).
   */
  arkProvider: ExpoArkProvider;
};

async function buildWallet(
  walletId: string,
  artifacts: IdentityArtifacts,
  arkServerUrl: string,
  network: string,
  behavior: WalletBehavior,
  walletMode: "static" | "hd",
  esploraUrl?: string,
): Promise<BuiltWallet> {
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

  const arkProvider = new ExpoArkProvider(arkServerUrl);
  try {
    const wallet = await Wallet.create({
      identity: artifacts.identity,
      walletMode,
      arkServerUrl,
      arkProvider,
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
    return { wallet, arkProvider };
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
  const { wallet, arkProvider } = await buildWallet(
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
  attachServerInfoSubscription(arkProvider);
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
  const { wallet, arkProvider } = await buildWallet(
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
  attachServerInfoSubscription(arkProvider);

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
    const { wallet, arkProvider } = await buildWallet(
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
    attachServerInfoSubscription(arkProvider);
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
  detachServerInfoSubscription();
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
