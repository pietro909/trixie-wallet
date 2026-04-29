import { RestDelegatorProvider, Wallet } from "@arkade-os/sdk";
import {
  ExpoArkProvider,
  ExpoIndexerProvider,
} from "@arkade-os/sdk/adapters/expo";
import type {
  ArkadeServerInfo,
  ArkadeWalletMetadata,
  WalletBehavior,
} from "../../store/types";
import { ArkadeError, toArkadeError } from "./errors";
import {
  buildIdentityFromSecret,
  bytesToHex,
  type IdentityArtifacts,
} from "./identity";
import { mapArkTxs } from "./mappers";
import {
  defaultDelegatorUrlForNetwork,
  isMainnetForNetworkName,
} from "./network";
import { readSecret, type StoredSecret } from "./secret-store";
import { clearWalletData, createRepositories } from "./storage";

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
  };
  activities: ReturnType<typeof mapArkTxs>;
};

let activeWalletId: string | null = null;
let activeBehaviorKey: string | null = null;
let activeWalletPromise: Promise<Wallet> | null = null;
let activeWalletInstance: Wallet | null = null;

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

export async function snapshotWallet(wallet: Wallet): Promise<WalletSnapshot> {
  try {
    const [publicKeyBytes, arkAddress, boardingAddress, balance, txs] =
      await Promise.all([
        wallet.identity.compressedPublicKey(),
        wallet.getAddress(),
        wallet.getBoardingAddress(),
        wallet.getBalance(),
        wallet.getTransactionHistory(),
      ]);
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
      },
      activities: mapArkTxs(txs),
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
    input.esploraUrl,
  );
  activeWalletId = input.walletId;
  activeBehaviorKey = behaviorKey(input.behavior);
  activeWalletInstance = wallet;
  activeWalletPromise = Promise.resolve(wallet);
  const snapshot = await snapshotWallet(wallet);
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
      metadata.esploraUrl,
    );
    activeWalletInstance = wallet;
    return wallet;
  })();
  activeWalletId = metadata.id;
  activeBehaviorKey = nextBehaviorKey;
  activeWalletPromise = promise.catch((e) => {
    if (activeWalletId === metadata.id) {
      activeWalletId = null;
      activeBehaviorKey = null;
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
  return snapshotWallet(wallet);
}

export async function disposeWallet(): Promise<void> {
  const instance = activeWalletInstance;
  activeWalletId = null;
  activeBehaviorKey = null;
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
}
