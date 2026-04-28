import { Wallet } from "@arkade-os/sdk";
import { ExpoArkProvider, ExpoIndexerProvider } from "@arkade-os/sdk/adapters/expo";
import type { ArkadeWalletMetadata } from "../../store/types";
import { ArkadeError, toArkadeError } from "./errors";
import { isMainnetForNetworkName } from "./network";
import {
  buildIdentityFromSecret,
  bytesToHex,
  type IdentityArtifacts,
} from "./identity";
import { mapArkTxs } from "./mappers";
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
  transactions: ReturnType<typeof mapArkTxs>;
};

export type ServerInfo = {
  arkServerUrl: string;
  network: string;
};

let activeWalletId: string | null = null;
let activeWalletPromise: Promise<Wallet> | null = null;
let activeWalletInstance: Wallet | null = null;

async function fetchServerNetwork(arkServerUrl: string): Promise<string> {
  try {
    const provider = new ExpoArkProvider(arkServerUrl);
    const info = await provider.getInfo();
    return info.network;
  } catch (e) {
    throw toArkadeError(
      "server_unreachable",
      `Could not reach Arkade server at ${arkServerUrl}`,
      e,
    );
  }
}

export async function probeServer(arkServerUrl: string): Promise<ServerInfo> {
  const network = await fetchServerNetwork(arkServerUrl);
  return { arkServerUrl, network };
}

async function buildWallet(
  walletId: string,
  artifacts: IdentityArtifacts,
  arkServerUrl: string,
  esploraUrl?: string,
): Promise<Wallet> {
  const repos = createRepositories(walletId);
  try {
    return await Wallet.create({
      identity: artifacts.identity,
      arkServerUrl,
      arkProvider: new ExpoArkProvider(arkServerUrl),
      indexerProvider: new ExpoIndexerProvider(arkServerUrl),
      esploraUrl,
      storage: {
        walletRepository: repos.walletRepository,
        contractRepository: repos.contractRepository,
      },
      settlementConfig: false,
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
      transactions: mapArkTxs(txs),
    };
  } catch (e) {
    throw toArkadeError(
      "refresh_failed",
      "Failed to refresh wallet state",
      e,
    );
  }
}

export type CreateWalletInput = {
  walletId: string;
  artifacts: IdentityArtifacts;
  arkServerUrl: string;
  esploraUrl?: string;
};

export async function createWalletInstance(
  input: CreateWalletInput,
): Promise<{ wallet: Wallet; snapshot: WalletSnapshot }> {
  const wallet = await buildWallet(
    input.walletId,
    input.artifacts,
    input.arkServerUrl,
    input.esploraUrl,
  );
  activeWalletId = input.walletId;
  activeWalletInstance = wallet;
  activeWalletPromise = Promise.resolve(wallet);
  const snapshot = await snapshotWallet(wallet);
  return { wallet, snapshot };
}

export type EnsureWalletInput = {
  metadata: ArkadeWalletMetadata;
};

export async function ensureWallet(
  input: EnsureWalletInput,
): Promise<Wallet> {
  const { metadata } = input;
  if (
    activeWalletId === metadata.id &&
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
      metadata.esploraUrl,
    );
    activeWalletInstance = wallet;
    return wallet;
  })();
  activeWalletId = metadata.id;
  activeWalletPromise = promise.catch((e) => {
    if (activeWalletId === metadata.id) {
      activeWalletId = null;
      activeWalletInstance = null;
      activeWalletPromise = null;
    }
    throw e;
  });
  return activeWalletPromise;
}

export async function getWallet(): Promise<Wallet> {
  if (!activeWalletPromise) {
    throw new ArkadeError("wallet_not_ready", "Arkade wallet is not initialized");
  }
  return activeWalletPromise;
}

export async function refreshWalletSnapshot(
  metadata: ArkadeWalletMetadata,
): Promise<WalletSnapshot> {
  const wallet = await ensureWallet({ metadata });
  return snapshotWallet(wallet);
}

export async function disposeWallet(): Promise<void> {
  const instance = activeWalletInstance;
  activeWalletId = null;
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
