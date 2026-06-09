import { pbkdf2Async } from "@noble/hashes/pbkdf2.js";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Crypto from "expo-crypto";

jest.mock("@react-native-async-storage/async-storage", () => ({
  setItem: jest.fn(),
  getItem: jest.fn(),
  removeItem: jest.fn(),
}));

jest.mock("expo-crypto", () => ({
  getRandomBytes: jest.fn((len) => new Uint8Array(len).fill(1)),
}));

jest.mock("@noble/hashes/pbkdf2.js", () => ({
  // Deterministic 32-byte derivation keyed off the inputs so tests can assert
  // the password+salt round-trip without running 300k real iterations. Each
  // output byte mixes one password byte with one salt byte (both modulo their
  // own length), guaranteeing different (password, salt) pairs diverge.
  pbkdf2Async: jest.fn((_hash, pw, salt, _opts) => {
    const p = pw as Uint8Array;
    const s = salt as Uint8Array;
    const out = new Uint8Array(32);
    for (let i = 0; i < 32; i++) {
      out[i] = (p[i % p.length] ^ s[i % s.length]) & 0xff;
    }
    return Promise.resolve(out);
  }),
}));

jest.mock("@noble/hashes/sha2.js", () => ({
  sha256: { tag: "sha256-mock" },
}));

jest.mock("expo-constants", () => ({
  expoConfig: {
    version: "1.0.0",
  },
}));

jest.mock("expo-local-authentication", () => ({
  authenticateAsync: jest.fn(),
}));

// Mock services to avoid pulling in heavy dependencies
jest.mock("../../services/arkade/lightning", () => ({
  isLightningSupportedForNetwork: jest.fn(() => true),
  resumeLightningSwaps: jest.fn(),
  ensureLightning: jest.fn(),
  disposeLightning: jest.fn(),
  setSwapEventListener: jest.fn(),
  getLatestBoltzSwapWriteAt: jest.fn(async () => null),
  getLightningActivitySources: jest.fn(),
  getNonTerminalSwapCount: jest.fn(),
  snapshotBoltzSwaps: jest.fn(async () => []),
  refreshSwapsStatus: jest.fn(),
  restoreBoltzSwaps: jest.fn(),
  restoreLightningActivity: jest.fn(),
  sendLightningPayment: jest.fn(),
  quoteArkToBtcChainSwap: jest.fn(),
  createArkToBtcChainSwap: jest.fn(),
  refundChainSwapById: jest.fn(),
  waitAndClaimChainSwap: jest.fn(),
  clearAllSwaps: jest.fn(),
}));

jest.mock("../../services/arkade/swap-storage", () => ({
  getAllSwapMetadata: jest.fn(async () => []),
  getLatestSwapMetadataWriteAt: jest.fn(async () => null),
  restoreSwapMetadataRows: jest.fn(),
  recordSwapMetadata: jest.fn(),
  linkSwapToWalletTx: jest.fn(),
  clearSwapMetadataForWallet: jest.fn(),
  isLocalSwapFlow: jest.fn(() => true),
}));

jest.mock("../../services/arkade/swap-mappers", () => ({
  mergeActivities: jest.fn(() => []),
}));

jest.mock("../../services/arkade/secret-store", () => ({
  readSecret: jest.fn(async () => ({ kind: "mnemonic", mnemonic: "x" })),
  saveSecret: jest.fn(),
  deleteSecret: jest.fn(),
}));

jest.mock("../../services/backup/crypto", () => ({
  BackupError: class BackupError extends Error {},
  encryptBundle: jest.fn(async () => ({
    createdAt: 1_700_000_000_000,
    payload: new Uint8Array(),
  })),
  decryptBundle: jest.fn(),
}));

jest.mock("../../services/backup/storage", () => ({
  writeBackupToTemp: jest.fn(() => "file:///tmp/backup"),
  deleteBackupTempFile: jest.fn(),
}));

jest.mock("../../services/arkade/runtime", () => ({
  ensureWallet: jest.fn(),
  disposeWallet: jest.fn(),
  setIncomingFundsListener: jest.fn(),
  refreshWalletSnapshot: jest.fn(),
}));

jest.mock("../notify-diff", () => ({
  clearNotifyState: jest.fn(),
  diffAndNotifyActivities: jest.fn(async () => {}),
}));

// The SDK's seed-identity path pulls in @bitcoinerlab/descriptors-scure, which
// instantiates a real @noble/curves hasher at module load and clashes with the
// `@noble/hashes/sha2.js` mock above. Stub both the SDK package and the local
// identity helpers so useAppStore does not transitively require seedIdentity.
jest.mock("@arkade-os/sdk", () => ({
  Ramps: jest.fn(),
  ESPLORA_URL: {},
}));

// `@arkade-os/boltz-swap` initialises @noble/curves secp256k1 at module load,
// which fails under the `@noble/hashes/sha2.js` mock. Mock the package itself
// so anything in the dep graph below useAppStore that imports types/values
// from it gets a no-op stub instead of triggering the curves init.
jest.mock("@arkade-os/boltz-swap", () => ({
  BoltzSwapProvider: jest.fn(),
  isChainFinalStatus: jest.fn(() => false),
  isChainSwapRefundable: jest.fn(() => false),
  isReverseFinalStatus: jest.fn(() => false),
  isReverseSuccessStatus: jest.fn(() => false),
  isSubmarineFinalStatus: jest.fn(() => false),
}));

jest.mock("@arkade-os/boltz-swap/expo", () => ({
  ExpoArkadeSwaps: jest.fn(),
}));

jest.mock("../../services/arkade/identity", () => ({
  buildMnemonicIdentity: jest.fn(),
  buildRandomSingleKeyIdentity: jest.fn(),
  buildSingleKeyIdentityFromHex: jest.fn(),
  buildSingleKeyIdentityFromNsec: jest.fn(),
  bytesToHex: jest.fn((bytes: Uint8Array) =>
    Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join(""),
  ),
  hexToBytes: jest.fn((hex: string) => {
    const out = new Uint8Array(hex.length / 2);
    for (let i = 0; i < out.length; i++) {
      out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    }
    return out;
  }),
  createMnemonic: jest.fn(() => "test mnemonic"),
}));

jest.mock("../../services/arkade/swap-background", () => ({
  ensureSwapBackgroundRegistered: jest.fn(),
  unregisterSwapBackgroundTask: jest.fn(),
}));

// recovery.ts re-pulls @arkade-os/boltz-swap which has the same noble-curves
// load-time issue as the SDK; stub it so the store imports cleanly.
jest.mock("../../services/arkade/recovery", () => ({
  isSwapBeingProcessed: jest.fn(),
  lookupSubmarineRecovery: jest.fn(),
  runSubmarineRecovery: jest.fn(),
  scanRecoveryState: jest.fn(),
}));

jest.mock("../../services/arkade/pending-tx-recovery", () => ({
  finalizePendingTx: jest.fn(),
}));

jest.mock("../../services/arkade/asset-format", () => ({
  isValidAssetId: jest.fn(() => true),
}));

jest.mock("../../services/diagnostics/persisted", () => ({
  drainPersistedErrors: jest.fn(() => Promise.resolve([])),
}));

// feePreview transitively requires @scure/btc-signer, whose nested @noble/curves
// fails to initialise under the @noble/hashes/sha2 mock above. Stub it so the
// store module can load.
jest.mock("../../services/arkade/feePreview", () => ({
  estimateOffboardFee: jest.fn(),
  OffboardFeeEstimateError: class OffboardFeeEstimateError extends Error {
    kind = "amount_exceeds_balance";
  },
}));

// paymentParser uses @scure/btc-signer for address validation; same load-time
// failure as feePreview.
jest.mock("../../services/paymentParser", () => ({
  isBitcoinAddressForNetwork: jest.fn(() => true),
  networkNameOrNull: jest.fn((n: string) => n),
}));

import {
  ensureLightning,
  getLightningActivitySources,
} from "../../services/arkade/lightning";
import {
  MAINNET_ARK_SERVER_URL,
  MUTINYNET_ARK_SERVER_URL,
} from "../../services/arkade/network";
import {
  ensureWallet,
  refreshWalletSnapshot,
} from "../../services/arkade/runtime";
import { diffAndNotifyActivities } from "../notify-diff";
import { LEGACY_STORAGE_KEYS, STORAGE_KEY } from "../storage-keys";
import type { SyncState } from "../types";
import { generateSalt, hashPassword, useAppStore } from "../useAppStore";

const ensureWalletMock = ensureWallet as jest.Mock;
const refreshWalletSnapshotMock = refreshWalletSnapshot as jest.Mock;
const getLightningActivitySourcesMock =
  getLightningActivitySources as jest.Mock;
const ensureLightningMock = ensureLightning as jest.Mock;
const diffAndNotifyActivitiesMock = diffAndNotifyActivities as jest.Mock;

describe("useAppStore security utilities", () => {
  describe("hashPassword", () => {
    beforeEach(() => {
      (pbkdf2Async as jest.Mock).mockClear();
    });

    it("derives a 32-byte hash via PBKDF2-SHA256 over password + salt bytes", async () => {
      const password = "password123";
      // 32-char hex (16 bytes), matches `generateSalt()` shape.
      const saltHex = "0011223344556677889900aabbccddee";
      const hash = await hashPassword(password, saltHex);

      expect(pbkdf2Async).toHaveBeenCalledTimes(1);
      const [hashFn, pwBytes, saltBytes, opts] = (pbkdf2Async as jest.Mock).mock
        .calls[0];
      expect(hashFn).toEqual({ tag: "sha256-mock" });
      // Password is utf8-encoded — `password123` → 11 bytes.
      expect(pwBytes).toBeInstanceOf(Uint8Array);
      expect(pwBytes.length).toBe(password.length);
      // Salt hex (32 chars) → 16 bytes.
      expect(saltBytes).toBeInstanceOf(Uint8Array);
      expect(saltBytes.length).toBe(16);
      expect(opts).toEqual({ c: 300_000, dkLen: 32 });
      // Output is hex-encoded 32 bytes → 64 chars.
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it("produces different hashes for different salts", async () => {
      const password = "password123";
      const hash1 = await hashPassword(password, "01".repeat(16));
      const hash2 = await hashPassword(password, "02".repeat(16));
      expect(hash1).not.toBe(hash2);
    });

    it("produces different hashes for different passwords", async () => {
      const salt = "0011223344556677889900aabbccddee";
      const h1 = await hashPassword("alpha-pass", salt);
      const h2 = await hashPassword("beta-pass-x", salt);
      expect(h1).not.toBe(h2);
    });
  });

  describe("generateSalt", () => {
    it("should generate a random 16-byte (32-char hex) string", () => {
      const salt = generateSalt();
      expect(salt.length).toBe(32);
      expect(Crypto.getRandomBytes).toHaveBeenCalledWith(16);
    });
  });
});

describe("useAppStore hydrate / schema mismatch", () => {
  const getItem = AsyncStorage.getItem as jest.Mock;
  const removeItem = AsyncStorage.removeItem as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    useAppStore.setState({
      _hydrated: false,
      _schemaMismatch: false,
      wallet: null,
    });
  });

  it("marks fresh install as hydrated without flagging mismatch", async () => {
    getItem.mockResolvedValueOnce(null);

    await useAppStore.getState().hydrate();

    const state = useAppStore.getState();
    expect(state._hydrated).toBe(true);
    expect(state._schemaMismatch).toBe(false);
  });

  it("flags mismatch and leaves storage intact when stored version is older", async () => {
    getItem.mockResolvedValueOnce(
      JSON.stringify({ schemaVersion: 5, wallet: null }),
    );

    await useAppStore.getState().hydrate();

    const state = useAppStore.getState();
    expect(state._schemaMismatch).toBe(true);
    expect(state._hydrated).toBe(false);
    expect(removeItem).not.toHaveBeenCalledWith(STORAGE_KEY);
  });

  it("flags mismatch and leaves storage intact when stored version is newer", async () => {
    getItem.mockResolvedValueOnce(
      JSON.stringify({ schemaVersion: 999, wallet: null }),
    );

    await useAppStore.getState().hydrate();

    const state = useAppStore.getState();
    expect(state._schemaMismatch).toBe(true);
    expect(state._hydrated).toBe(false);
    expect(removeItem).not.toHaveBeenCalledWith(STORAGE_KEY);
  });

  it("flags mismatch and leaves storage intact when stored JSON is corrupted", async () => {
    getItem.mockResolvedValueOnce("{not valid json");

    await useAppStore.getState().hydrate();

    const state = useAppStore.getState();
    expect(state._schemaMismatch).toBe(true);
    expect(state._hydrated).toBe(false);
    expect(removeItem).not.toHaveBeenCalled();
  });

  it("hydrates normally when stored version matches", async () => {
    getItem.mockResolvedValueOnce(
      JSON.stringify({ schemaVersion: 7, wallet: null }),
    );

    await useAppStore.getState().hydrate();

    const state = useAppStore.getState();
    expect(state._hydrated).toBe(true);
    expect(state._schemaMismatch).toBe(false);
  });
});

describe("useAppStore setArkadeNetwork", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useAppStore.setState({
      wallet: null,
      network: {
        arkServerUrl: MUTINYNET_ARK_SERVER_URL,
        detectedNetwork: "mutinynet",
        status: "online",
        lastError: null,
        serverInfo: {
          version: "1.0.0",
          network: "mutinynet",
          signerPubkey: "abc",
          forfeitAddress: "xyz",
          dustSats: 1000,
          unilateralExitDelaySeconds: 60,
          txFeeRate: "1",
          intentFee: {},
        },
      },
    });
  });

  it("writes the canonical mainnet URL when network is bitcoin", async () => {
    await useAppStore.getState().setArkadeNetwork("bitcoin");
    const state = useAppStore.getState();
    expect(state.network.arkServerUrl).toBe(MAINNET_ARK_SERVER_URL);
    expect(state.network.detectedNetwork).toBeNull();
    expect(state.network.serverInfo).toBeNull();
    expect(state.network.status).toBe("idle");
  });

  it("writes the canonical mutinynet URL when network is mutinynet", async () => {
    // Pre-condition: already on mutinynet but with stale detectedNetwork from a
    // prior probe. Action should still reset to idle so the user re-probes on
    // create/restore.
    useAppStore.setState({
      network: {
        arkServerUrl: MAINNET_ARK_SERVER_URL,
        detectedNetwork: "bitcoin",
        status: "online",
        lastError: null,
        serverInfo: null,
      },
    });
    await useAppStore.getState().setArkadeNetwork("mutinynet");
    const state = useAppStore.getState();
    expect(state.network.arkServerUrl).toBe(MUTINYNET_ARK_SERVER_URL);
    expect(state.network.detectedNetwork).toBeNull();
    expect(state.network.status).toBe("idle");
  });

  it("refuses to switch when a wallet already exists", async () => {
    useAppStore.setState({
      wallet: {
        id: "w1",
        type: "arkade",
        label: "x",
        identityKind: "mnemonic",
        walletMode: "static" as const,
        publicKeyHex: "00",
        arkServerUrl: MUTINYNET_ARK_SERVER_URL,
        network: "mutinynet",
        arkAddress: "tark1example",
        boardingAddress: "tb1example",
        balanceSats: 0,
        balanceTotalSats: 0,
        balanceBoardingSats: 0,
        assetBalances: [],
        activities: [],
        backup: { hasMnemonic: true, hasPrivateKey: false },
      },
    });
    await expect(
      useAppStore.getState().setArkadeNetwork("bitcoin"),
    ).rejects.toThrow(/Reset to switch/);
    // URL should be unchanged.
    expect(useAppStore.getState().network.arkServerUrl).toBe(
      MUTINYNET_ARK_SERVER_URL,
    );
  });
});

describe("useAppStore acknowledgeSchemaMismatchAndWipe", () => {
  const removeItem = AsyncStorage.removeItem as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    useAppStore.setState({ _hydrated: false, _schemaMismatch: true });
  });

  it("wipes STORAGE_KEY and legacy keys, then marks hydrated", async () => {
    await useAppStore.getState().acknowledgeSchemaMismatchAndWipe();

    expect(removeItem).toHaveBeenCalledWith(STORAGE_KEY);
    for (const key of LEGACY_STORAGE_KEYS) {
      expect(removeItem).toHaveBeenCalledWith(key);
    }
    const state = useAppStore.getState();
    expect(state._hydrated).toBe(true);
    expect(state._schemaMismatch).toBe(false);
    expect(state.wallet).toBeNull();
  });
});

// ----- Contract action tests -----

function makeWalletMetadata() {
  return {
    id: "w1",
    type: "arkade" as const,
    label: "x",
    identityKind: "mnemonic" as const,
    walletMode: "static" as const,
    publicKeyHex: "00",
    arkServerUrl: MUTINYNET_ARK_SERVER_URL,
    network: "mutinynet",
    arkAddress: "tark1example",
    boardingAddress: "tb1example",
    balanceSats: 0,
    balanceTotalSats: 0,
    balanceBoardingSats: 0,
    assetBalances: [],
    activities: [],
    backup: { hasMnemonic: true, hasPrivateKey: false },
  };
}

function fakeWalletRuntime(opts: {
  getContracts?: jest.Mock;
  updateContract?: jest.Mock;
}) {
  const cm = {
    getContracts: opts.getContracts ?? jest.fn(async () => []),
    updateContract: opts.updateContract ?? jest.fn(async () => ({})),
  };
  return {
    getContractManager: jest.fn(async () => cm),
    _cm: cm,
  };
}

describe("useAppStore contract actions — guards", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useAppStore.setState({
      wallet: null,
      security: {
        isLocked: false,
        biometricsEnabled: false,
      },
    });
  });

  it.each([
    [
      "loadWalletContractSummaries",
      () => useAppStore.getState().loadWalletContractSummaries(),
    ],
    [
      "loadWalletContractParams",
      () => useAppStore.getState().loadWalletContractParams("script"),
    ],
    [
      "updateWalletContractLabel",
      () => useAppStore.getState().updateWalletContractLabel("script", "L"),
    ],
  ])("rejects %s when no wallet is present", async (_name, run) => {
    await expect(run()).rejects.toMatchObject({ kind: "wallet_not_ready" });
  });

  it.each([
    [
      "loadWalletContractSummaries",
      () => useAppStore.getState().loadWalletContractSummaries(),
    ],
    [
      "loadWalletContractParams",
      () => useAppStore.getState().loadWalletContractParams("script"),
    ],
    [
      "updateWalletContractLabel",
      () => useAppStore.getState().updateWalletContractLabel("script", "L"),
    ],
  ])("rejects %s when the wallet is locked", async (_name, run) => {
    useAppStore.setState({
      wallet: makeWalletMetadata(),
      security: { isLocked: true, biometricsEnabled: false },
    });
    await expect(run()).rejects.toMatchObject({ kind: "wallet_not_ready" });
  });
});

describe("useAppStore.updateWalletContractLabel", () => {
  const setItem = AsyncStorage.setItem as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    useAppStore.setState({
      wallet: makeWalletMetadata(),
      security: {
        isLocked: false,
        biometricsEnabled: false,
        dirtyForBackup: false,
        latestContractLabelWriteAt: null,
      },
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("commits dirtyForBackup + latestContractLabelWriteAt atomically and persists once", async () => {
    const updateContract = jest.fn(async () => ({}));
    const wallet = fakeWalletRuntime({ updateContract });
    ensureWalletMock.mockResolvedValueOnce(wallet);
    const pinnedTs = 1_750_000_000_000;
    jest.spyOn(Date, "now").mockReturnValue(pinnedTs);

    // Pre-assert defaults so the post-condition is a meaningful transition.
    expect(useAppStore.getState().security.dirtyForBackup).toBe(false);
    expect(
      useAppStore.getState().security.latestContractLabelWriteAt,
    ).toBeNull();

    // Subscribe to capture every transition. Both fields must move together.
    const transitions: Array<{
      dirty: boolean | undefined;
      ts: number | null | undefined;
    }> = [];
    const unsub = useAppStore.subscribe((s) => {
      transitions.push({
        dirty: s.security.dirtyForBackup,
        ts: s.security.latestContractLabelWriteAt,
      });
    });

    await useAppStore.getState().updateWalletContractLabel("s", "Primary");
    unsub();

    expect(useAppStore.getState().security.dirtyForBackup).toBe(true);
    expect(useAppStore.getState().security.latestContractLabelWriteAt).toBe(
      pinnedTs,
    );

    // Exactly one transition should have flipped both fields — no intermediate
    // state where dirty=true but ts is still null.
    const flips = transitions.filter(
      (t) => t.dirty === true && t.ts === pinnedTs,
    );
    expect(flips.length).toBeGreaterThanOrEqual(1);
    const halfFlips = transitions.filter(
      (t) => t.dirty === true && t.ts == null,
    );
    expect(halfFlips).toHaveLength(0);

    // The SDK update must have happened.
    expect(updateContract).toHaveBeenCalledWith("s", { label: "Primary" });

    // Persistence must have landed with both fields.
    const writes = setItem.mock.calls.map((c) => JSON.parse(c[1] as string));
    expect(writes.length).toBeGreaterThanOrEqual(1);
    const last = writes[writes.length - 1];
    expect(last.security.dirtyForBackup).toBe(true);
    expect(last.security.latestContractLabelWriteAt).toBe(pinnedTs);
  });

  it("does not mark dirty or stamp the timestamp when the SDK update fails", async () => {
    const updateContract = jest.fn(async () => {
      throw new Error("blip");
    });
    const wallet = fakeWalletRuntime({ updateContract });
    ensureWalletMock.mockResolvedValueOnce(wallet);

    setItem.mockClear();

    await expect(
      useAppStore.getState().updateWalletContractLabel("s", "Primary"),
    ).rejects.toMatchObject({ kind: "contracts_update_failed" });

    expect(useAppStore.getState().security.dirtyForBackup).toBe(false);
    expect(
      useAppStore.getState().security.latestContractLabelWriteAt,
    ).toBeNull();
    expect(setItem).not.toHaveBeenCalled();
  });

  it("stamps the timestamp even when clearing a label (empty string)", async () => {
    const updateContract = jest.fn(async () => ({}));
    const wallet = fakeWalletRuntime({ updateContract });
    ensureWalletMock.mockResolvedValueOnce(wallet);
    const pinnedTs = 1_760_000_000_000;
    jest.spyOn(Date, "now").mockReturnValue(pinnedTs);

    await useAppStore.getState().updateWalletContractLabel("s", "");

    expect(updateContract).toHaveBeenCalledWith("s", { label: undefined });
    expect(useAppStore.getState().security.latestContractLabelWriteAt).toBe(
      pinnedTs,
    );
    expect(useAppStore.getState().security.dirtyForBackup).toBe(true);
  });
});

describe("useAppStore.getBackupHealth — contract labels", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useAppStore.setState({
      wallet: makeWalletMetadata(),
      security: {
        isLocked: false,
        biometricsEnabled: false,
        dirtyForBackup: false,
        latestContractLabelWriteAt: null,
      },
      assets: { importedAssetIds: [] },
    });
  });

  it("flags labels alone as backup material", async () => {
    useAppStore.setState({
      security: {
        isLocked: false,
        biometricsEnabled: false,
        dirtyForBackup: false,
        latestContractLabelWriteAt: 1_700_000_000_000,
      },
    });
    const health = await useAppStore.getState().getBackupHealth();
    expect(health.hasBackupMaterial).toBe(true);
  });

  it("keeps backup material true after the user has cleared every label", async () => {
    // Timestamp persists even after a clear — mirrors the swap-storage
    // write-timestamp pattern; intentional asymmetry, documented in §8.
    useAppStore.setState({
      security: {
        isLocked: false,
        biometricsEnabled: false,
        dirtyForBackup: false,
        latestContractLabelWriteAt: 1_700_000_000_000,
      },
    });
    const health = await useAppStore.getState().getBackupHealth();
    expect(health.hasBackupMaterial).toBe(true);
  });

  it("folds latestContractLabelWriteAt into the staleness calculation", async () => {
    useAppStore.setState({
      security: {
        isLocked: false,
        biometricsEnabled: false,
        lastBackupAt: 100,
        dirtyForBackup: false,
        latestContractLabelWriteAt: 200,
      },
    });
    const health = await useAppStore.getState().getBackupHealth();
    expect(health.isStale).toBe(true);
  });
});

describe("useAppStore.exportBackup — contract labels", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useAppStore.setState({
      wallet: makeWalletMetadata(),
      walletBehavior: { vtxoAutoRenewal: true, delegatedRenewal: false },
      security: {
        isLocked: false,
        biometricsEnabled: false,
        dirtyForBackup: true,
        latestContractLabelWriteAt: null,
      },
      preferences: {
        theme: "system",
        fiatCurrency: "EUR",
        bitcoinUnit: "auto",
        notifications: { enabled: false, swaps: true, payments: true },
      },
      assets: { importedAssetIds: [] },
    });
  });

  it("fails loud when contract-label fetch throws, leaving dirtyForBackup intact", async () => {
    const writeBackupToTemp = jest.requireMock("../../services/backup/storage")
      .writeBackupToTemp as jest.Mock;
    const encryptBundle = jest.requireMock("../../services/backup/crypto")
      .encryptBundle as jest.Mock;
    writeBackupToTemp.mockClear();
    encryptBundle.mockClear();

    const getContracts = jest.fn(async () => {
      throw new Error("indexer down");
    });
    ensureWalletMock.mockResolvedValueOnce(fakeWalletRuntime({ getContracts }));

    await expect(
      useAppStore.getState().exportBackup("pw"),
    ).rejects.toMatchObject({ kind: "contracts_fetch_failed" });

    expect(writeBackupToTemp).not.toHaveBeenCalled();
    expect(encryptBundle).not.toHaveBeenCalled();
    // dirtyForBackup must remain true so the stale warning stays visible.
    expect(useAppStore.getState().security.dirtyForBackup).toBe(true);
  });

  it("includes the SDK contract labels in the built payload (version 3)", async () => {
    const getContracts = jest.fn(async () => [
      {
        type: "default",
        state: "active",
        address: "ark1q",
        script: "s1",
        params: {},
        createdAt: 1,
        label: "Primary",
      },
    ]);
    ensureWalletMock.mockResolvedValueOnce(fakeWalletRuntime({ getContracts }));

    const encryptBundle = jest.requireMock("../../services/backup/crypto")
      .encryptBundle as jest.Mock;
    encryptBundle.mockImplementationOnce(
      async ({ plaintext }: { plaintext: Uint8Array }) => {
        // Capture the raw JSON the export path built so we can assert on it.
        const json = Buffer.from(plaintext).toString("utf8");
        (encryptBundle as jest.Mock & { captured?: unknown }).captured =
          JSON.parse(json);
        return { createdAt: 1_700_000_000_000, payload: new Uint8Array() };
      },
    );

    await useAppStore.getState().exportBackup("pw");

    const built = (encryptBundle as jest.Mock & { captured?: unknown })
      .captured as {
      version: number;
      contractLabels: { script: string; label: string }[];
    };
    expect(built.version).toBe(4);
    expect(built.contractLabels).toEqual([{ script: "s1", label: "Primary" }]);
  });
});

describe("useAppStore.refreshWallet — _syncState transitions", () => {
  function stageOf(s: SyncState): string {
    return s.kind === "syncing" ? s.stage : "idle";
  }

  beforeEach(() => {
    jest.clearAllMocks();
    useAppStore.setState({
      wallet: makeWalletMetadata(),
      security: { isLocked: false, biometricsEnabled: false },
      _syncState: { kind: "idle" },
    });
    refreshWalletSnapshotMock.mockResolvedValue({
      publicKeyHex: "00",
      arkAddress: "tark1example",
      boardingAddress: "tb1example",
      balance: { available: 0, total: 0, boardingTotal: 0, assets: [] },
      activities: [],
    });
    ensureLightningMock.mockResolvedValue(undefined);
    getLightningActivitySourcesMock.mockResolvedValue({
      swaps: [],
      metadata: [],
    });
    diffAndNotifyActivitiesMock.mockResolvedValue(undefined);
  });

  it("walks snapshot → lightning → activities → notify, then settles idle", async () => {
    const seen: SyncState[] = [];
    const unsub = useAppStore.subscribe((s, prev) => {
      if (s._syncState !== prev._syncState) seen.push(s._syncState);
    });

    await useAppStore.getState().refreshWallet();
    unsub();

    expect(seen.map(stageOf)).toEqual([
      "snapshot",
      "lightning",
      "activities",
      "notify",
      "idle",
    ]);
    // Final resting state is idle.
    expect(useAppStore.getState()._syncState).toEqual({ kind: "idle" });
  });

  it("keeps startedAt stable across every syncing stage", async () => {
    const startedAts = new Set<number>();
    const unsub = useAppStore.subscribe((s, prev) => {
      if (s._syncState !== prev._syncState && s._syncState.kind === "syncing") {
        startedAts.add(s._syncState.startedAt);
      }
    });

    await useAppStore.getState().refreshWallet();
    unsub();

    // One continuous syncing window — all stages share a single origin.
    expect(startedAts.size).toBe(1);
  });

  it("resets to idle even when the snapshot stage throws", async () => {
    refreshWalletSnapshotMock.mockRejectedValueOnce(new Error("network down"));

    await expect(useAppStore.getState().refreshWallet()).rejects.toThrow(
      "network down",
    );

    expect(useAppStore.getState()._syncState).toEqual({ kind: "idle" });
    // The failed run never reached the notify stage.
    expect(diffAndNotifyActivitiesMock).not.toHaveBeenCalled();
  });
});
