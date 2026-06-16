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
  probeServer: jest.fn(),
  setIncomingFundsListener: jest.fn(),
  setServerInfoChangedListener: jest.fn(),
  waitForServerInfoChangedListener: jest.fn(async () => {}),
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
  DigestMismatchError: class DigestMismatchError extends Error {
    constructor(message = "DIGEST_MISMATCH") {
      super(message);
      this.name = "DigestMismatchError";
    }
  },
  // Default: not an ArkError. Individual tests override via the imported mock.
  maybeArkError: jest.fn(() => undefined),
  isCooperativelyMigratable: (status: string) =>
    status === "MIGRATABLE" || status === "DUE_NOW",
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

import { DigestMismatchError, maybeArkError, Ramps } from "@arkade-os/sdk";
import { estimateOffboardFee } from "../../services/arkade/feePreview";
import {
  disposeLightning,
  ensureLightning,
  getLightningActivitySources,
} from "../../services/arkade/lightning";
import {
  MAINNET_ARK_SERVER_URL,
  MUTINYNET_ARK_SERVER_URL,
} from "../../services/arkade/network";
import {
  disposeWallet,
  ensureWallet,
  probeServer,
  refreshWalletSnapshot,
} from "../../services/arkade/runtime";
import { diffAndNotifyActivities } from "../notify-diff";
import { LEGACY_STORAGE_KEYS, STORAGE_KEY } from "../storage-keys";
import type { ArkadeServerInfo, SyncState } from "../types";
import {
  generateSalt,
  hashPassword,
  rebuildActiveWalletAfterDigestMismatch,
  useAppStore,
} from "../useAppStore";

const probeServerMock = probeServer as jest.Mock;
const disposeWalletMock = disposeWallet as jest.Mock;
const disposeLightningMock = disposeLightning as jest.Mock;
const maybeArkErrorMock = maybeArkError as jest.Mock;
const RampsMock = Ramps as unknown as jest.Mock;
const estimateOffboardFeeMock = estimateOffboardFee as jest.Mock;

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

  it("flags mismatch and leaves storage intact when stored version is older (v7 alpha install)", async () => {
    getItem.mockResolvedValueOnce(
      JSON.stringify({ schemaVersion: 7, wallet: null }),
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
      JSON.stringify({ schemaVersion: 8, wallet: null }),
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
          deprecatedSigners: [],
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

// Drain any fire-and-forget signer-status refresh so the module-level
// in-flight gate is clear before a test that asserts on it.
const flushMicrotasks = () => new Promise<void>((r) => setTimeout(r, 0));

function stubRefreshWalletDeps() {
  refreshWalletSnapshotMock.mockResolvedValue({
    publicKeyHex: "00",
    arkAddress: "tark1example",
    boardingAddress: "tb1example",
    balance: {
      available: 0,
      total: 0,
      settled: 0,
      preconfirmed: 0,
      boardingTotal: 0,
      assets: [],
    },
    activities: [],
  });
  ensureLightningMock.mockResolvedValue(undefined);
  getLightningActivitySourcesMock.mockResolvedValue({
    swaps: [],
    metadata: [],
  });
  diffAndNotifyActivitiesMock.mockResolvedValue(undefined);
}

const SERVER_INFO: ArkadeServerInfo = {
  network: "bitcoin",
  version: "2.0.0",
  signerPubkey: "new-signer",
  forfeitAddress: "forfeit",
  dustSats: 546,
  unilateralExitDelaySeconds: 100,
  txFeeRate: "2",
  intentFee: { offchainInput: "99" },
  deprecatedSigners: [{ pubkey: "dep", cutoffDateSeconds: "0" }],
};

describe("useAppStore.updateServerInfo", () => {
  const setItem = AsyncStorage.setItem as jest.Mock;

  beforeEach(async () => {
    await flushMicrotasks();
    jest.clearAllMocks();
    useAppStore.setState({
      network: {
        arkServerUrl: MAINNET_ARK_SERVER_URL,
        detectedNetwork: null,
        status: "offline",
        lastError: "stale error",
        serverInfo: null,
      },
    });
  });

  it("mirrors fresh server info into persisted network state", async () => {
    await useAppStore.getState().updateServerInfo(SERVER_INFO);

    const s = useAppStore.getState();
    expect(s.network.serverInfo).toEqual(SERVER_INFO);
    expect(s.network.detectedNetwork).toBe("bitcoin");
    expect(s.network.status).toBe("online");
    expect(s.network.lastError).toBeNull();

    const writes = setItem.mock.calls.map((c) => JSON.parse(c[1] as string));
    const last = writes[writes.length - 1];
    expect(last.network.serverInfo.deprecatedSigners).toEqual([
      { pubkey: "dep", cutoffDateSeconds: "0" },
    ]);
  });
});

describe("useAppStore — transient state excluded from persistence", () => {
  const setItem = AsyncStorage.setItem as jest.Mock;

  it("never writes signerRotationStatus / _updateRequired / _signerMigrationInFlight", async () => {
    await flushMicrotasks();
    jest.clearAllMocks();
    useAppStore.setState({
      signerRotationStatus: {
        worstStatus: "DUE_NOW",
        hasMigratableFunds: true,
        reports: [],
      },
      _updateRequired: true,
      _signerMigrationInFlight: true,
    });

    await useAppStore.getState().setTheme("dark");

    const writes = setItem.mock.calls.map((c) => JSON.parse(c[1] as string));
    expect(writes.length).toBeGreaterThanOrEqual(1);
    const last = writes[writes.length - 1];
    expect("signerRotationStatus" in last).toBe(false);
    expect("_updateRequired" in last).toBe(false);
    expect("_signerMigrationInFlight" in last).toBe(false);
  });
});

describe("useAppStore.refreshSignerRotationStatus", () => {
  beforeEach(async () => {
    await flushMicrotasks();
    jest.clearAllMocks();
    useAppStore.setState({
      wallet: makeWalletMetadata(),
      security: { isLocked: false, biometricsEnabled: false },
      signerRotationStatus: null,
    });
  });

  it("returns before ensureWallet when locked, even with a cached wallet", async () => {
    useAppStore.setState({
      security: { isLocked: true, biometricsEnabled: false },
    });

    await useAppStore.getState().refreshSignerRotationStatus();

    expect(ensureWalletMock).not.toHaveBeenCalled();
    expect(useAppStore.getState().signerRotationStatus).toBeNull();
  });

  it("aggregates the SDK manager report into store status", async () => {
    const getDeprecatedSignerStatus = jest.fn(async () => [
      {
        signerPubKey: "dep",
        status: "DUE_NOW",
        vtxoCount: 1,
        totalValue: 1000,
        boardingCount: 0,
        boardingValue: 0,
        recoverableCount: 0,
        recoverableValue: 0,
        awaitingSweepCount: 0,
        awaitingSweepValue: 0,
      },
    ]);
    ensureWalletMock.mockResolvedValue({
      getVtxoManager: jest.fn(async () => ({ getDeprecatedSignerStatus })),
    });

    await useAppStore.getState().refreshSignerRotationStatus();

    const status = useAppStore.getState().signerRotationStatus;
    expect(status?.worstStatus).toBe("DUE_NOW");
    expect(status?.hasMigratableFunds).toBe(true);
  });

  it("coalesces duplicate triggers into one in-flight SDK pass", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const getDeprecatedSignerStatus = jest.fn(async () => {
      await gate;
      return [];
    });
    const getVtxoManager = jest.fn(async () => ({ getDeprecatedSignerStatus }));
    ensureWalletMock.mockResolvedValue({ getVtxoManager });
    (AsyncStorage.setItem as jest.Mock).mockClear();

    const store = useAppStore.getState();
    const p1 = store.refreshSignerRotationStatus();
    const p2 = store.refreshSignerRotationStatus();
    const p3 = store.refreshSignerRotationStatus();
    expect(p1).toBe(p2);
    expect(p2).toBe(p3);

    release();
    await Promise.all([p1, p2, p3]);

    expect(getVtxoManager).toHaveBeenCalledTimes(1);
    expect(getDeprecatedSignerStatus).toHaveBeenCalledTimes(1);
    // Signer-status refresh never persists serverInfo (no duplicate writes).
    expect(AsyncStorage.setItem as jest.Mock).not.toHaveBeenCalled();
  });
});

describe("rebuildActiveWalletAfterDigestMismatch", () => {
  beforeEach(async () => {
    await flushMicrotasks();
    jest.clearAllMocks();
  });

  it("no-ops when there is no wallet", async () => {
    useAppStore.setState({
      wallet: null,
      security: { isLocked: false, biometricsEnabled: false },
    });
    await rebuildActiveWalletAfterDigestMismatch();
    expect(disposeLightningMock).not.toHaveBeenCalled();
    expect(disposeWalletMock).not.toHaveBeenCalled();
    expect(ensureWalletMock).not.toHaveBeenCalled();
  });

  it("no-ops when the app is locked, even with a cached wallet", async () => {
    useAppStore.setState({
      wallet: makeWalletMetadata(),
      security: { isLocked: true, biometricsEnabled: false },
    });
    await rebuildActiveWalletAfterDigestMismatch();
    expect(disposeLightningMock).not.toHaveBeenCalled();
    expect(disposeWalletMock).not.toHaveBeenCalled();
    expect(ensureWalletMock).not.toHaveBeenCalled();
  });

  it("disposes Lightning before the SDK wallet, then re-acquires", async () => {
    const order: string[] = [];
    disposeLightningMock.mockImplementation(async () => {
      order.push("lightning");
    });
    disposeWalletMock.mockImplementation(async () => {
      order.push("wallet");
    });
    ensureWalletMock.mockImplementation(async () => {
      order.push("ensure");
      return {};
    });
    useAppStore.setState({
      wallet: makeWalletMetadata(),
      security: { isLocked: false, biometricsEnabled: false },
    });

    await rebuildActiveWalletAfterDigestMismatch();

    expect(order).toEqual(["lightning", "wallet", "ensure"]);
  });
});

describe("useAppStore.sendOnchain — digest retry barrier", () => {
  beforeEach(async () => {
    await flushMicrotasks();
    jest.clearAllMocks();
    maybeArkErrorMock.mockReturnValue(undefined);
    stubRefreshWalletDeps();
    estimateOffboardFeeMock.mockReturnValue({ feeSats: 100 });
    useAppStore.setState({
      wallet: { ...makeWalletMetadata(), balanceSats: 100_000 },
      security: { isLocked: false, biometricsEnabled: false },
      network: {
        arkServerUrl: MUTINYNET_ARK_SERVER_URL,
        detectedNetwork: "mutinynet",
        status: "online",
        lastError: null,
        serverInfo: {
          network: "mutinynet",
          version: "1.0.0",
          signerPubkey: "old-signer",
          forfeitAddress: "f",
          dustSats: 546,
          unilateralExitDelaySeconds: 60,
          txFeeRate: "1",
          intentFee: { offchainInput: "10" },
          deprecatedSigners: [],
        },
      },
    });
  });

  it("waits for the listener barrier + rebuild, then re-reads fresh serverInfo on retry", async () => {
    const sequence: string[] = [];

    ensureWalletMock.mockResolvedValue({
      getVtxos: jest.fn(async () => []),
      getVtxoManager: jest.fn(async () => ({
        getDeprecatedSignerStatus: jest.fn(async () => []),
      })),
    });

    disposeLightningMock.mockImplementation(async () => {
      sequence.push("disposeLightning");
    });
    disposeWalletMock.mockImplementation(async () => {
      sequence.push("disposeWallet");
    });

    // The provider listener (simulated) refreshes persisted serverInfo with a
    // fresh fee before the wait barrier resolves.
    const fresh: ArkadeServerInfo = {
      network: "mutinynet",
      version: "1.1.0",
      signerPubkey: "rotated-signer",
      forfeitAddress: "f",
      dustSats: 546,
      unilateralExitDelaySeconds: 60,
      txFeeRate: "9",
      intentFee: { offchainInput: "777" },
      deprecatedSigners: [],
    };
    (
      jest.requireMock("../../services/arkade/runtime")
        .waitForServerInfoChangedListener as jest.Mock
    ).mockImplementation(async () => {
      sequence.push("wait");
      await useAppStore.getState().updateServerInfo(fresh);
    });

    let capturedRetryFee: unknown;
    const offboard = jest.fn(async (_addr: string, feeOpts: unknown) => {
      if (offboard.mock.calls.length === 1) {
        sequence.push("offboard:initial");
        throw new DigestMismatchError("DIGEST_MISMATCH");
      }
      sequence.push("offboard:retry");
      capturedRetryFee = feeOpts;
      return "txid-retry";
    });
    RampsMock.mockImplementation(() => ({ offboard }));

    const result = await useAppStore
      .getState()
      .sendOnchain("bc1qexample", 1000);

    expect(result.txId).toBe("txid-retry");
    expect(offboard).toHaveBeenCalledTimes(2);
    // The barrier ran (wait + rebuild) strictly before the retry attempt.
    expect(sequence).toEqual([
      "offboard:initial",
      "wait",
      "disposeLightning",
      "disposeWallet",
      "offboard:retry",
    ]);
    // Retry rebuilt the offboard against the fresh fee/server info.
    expect(capturedRetryFee).toEqual({
      intentFee: { offchainInput: "777" },
      txFeeRate: "9",
    });
  });

  it("rebuilds and retries when the digest mismatch surfaces in the getVtxos preflight", async () => {
    disposeLightningMock.mockResolvedValue(undefined);
    disposeWalletMock.mockResolvedValue(undefined);

    const getVtxos = jest
      .fn()
      .mockRejectedValueOnce(new DigestMismatchError("DIGEST_MISMATCH"))
      .mockResolvedValue([]);
    ensureWalletMock.mockResolvedValue({
      getVtxos,
      getVtxoManager: jest.fn(async () => ({
        getDeprecatedSignerStatus: jest.fn(async () => []),
      })),
    });
    const offboard = jest.fn(async () => "txid-after-preflight-retry");
    RampsMock.mockImplementation(() => ({ offboard }));

    const result = await useAppStore
      .getState()
      .sendOnchain("bc1qexample", 1000);

    expect(result.txId).toBe("txid-after-preflight-retry");
    // The preflight digest mismatch drove a rebuild, not a generic failure.
    expect(getVtxos).toHaveBeenCalledTimes(2);
    expect(disposeWalletMock).toHaveBeenCalled();
    expect(offboard).toHaveBeenCalledTimes(1);
  });

  it("flags _updateRequired when BUILD_VERSION_TOO_OLD surfaces in the getVtxos preflight", async () => {
    const buildErr = new Error("BUILD_VERSION_TOO_OLD (48): client too old");
    maybeArkErrorMock.mockImplementation((e) =>
      e === buildErr ? { name: "BUILD_VERSION_TOO_OLD", code: 48 } : undefined,
    );
    const getVtxos = jest.fn().mockRejectedValue(buildErr);
    ensureWalletMock.mockResolvedValue({ getVtxos });
    RampsMock.mockImplementation(() => ({ offboard: jest.fn() }));

    await expect(
      useAppStore.getState().sendOnchain("bc1qexample", 1000),
    ).rejects.toMatchObject({ kind: "update_required" });
    expect(useAppStore.getState()._updateRequired).toBe(true);

    maybeArkErrorMock.mockReturnValue(undefined);
    useAppStore.setState({ _updateRequired: false });
  });
});

describe("withDigestRetry — update-required outranks digest-mismatch", () => {
  beforeEach(async () => {
    await flushMicrotasks();
    jest.clearAllMocks();
    maybeArkErrorMock.mockReturnValue(undefined);
    useAppStore.setState({
      wallet: { ...makeWalletMetadata(), balanceSats: 100_000 },
      security: { isLocked: false, biometricsEnabled: false },
      _updateRequired: false,
    });
  });

  afterEach(() => {
    maybeArkErrorMock.mockReturnValue(undefined);
    useAppStore.setState({ _updateRequired: false });
  });

  it("does not retry an error that is both digest-mismatch and build-version-too-old", async () => {
    // An error that is a DigestMismatchError instance AND parses as
    // BUILD_VERSION_TOO_OLD: update-required must win — no retry, modal shown.
    const both = new DigestMismatchError("DIGEST_MISMATCH");
    maybeArkErrorMock.mockImplementation((e) =>
      e === both ? { name: "BUILD_VERSION_TOO_OLD", code: 48 } : undefined,
    );
    const send = jest.fn(async () => {
      throw both;
    });
    ensureWalletMock.mockResolvedValue({ send });

    await expect(
      useAppStore.getState().sendArkade("tark1example", 1000),
    ).rejects.toMatchObject({ kind: "update_required" });

    // Surfaced, not retried: send invoked once and the rebuild barrier (which
    // only the digest path runs) never fired.
    expect(send).toHaveBeenCalledTimes(1);
    expect(disposeWalletMock).not.toHaveBeenCalled();
    expect(useAppStore.getState()._updateRequired).toBe(true);
  });
});

describe("useAppStore.issueAsset — digest retry", () => {
  beforeEach(async () => {
    await flushMicrotasks();
    jest.clearAllMocks();
    maybeArkErrorMock.mockReturnValue(undefined);
    stubRefreshWalletDeps();
    disposeLightningMock.mockResolvedValue(undefined);
    disposeWalletMock.mockResolvedValue(undefined);
    useAppStore.setState({
      wallet: makeWalletMetadata(),
      security: { isLocked: false, biometricsEnabled: false },
      assets: { importedAssetIds: [] },
      _updateRequired: false,
    });
  });

  it("mints the control asset exactly once when the main issuance hits a digest mismatch", async () => {
    let mainCalls = 0;
    const issue = jest.fn(async (params: { amount: bigint }) => {
      if (params.amount === 1n) return { assetId: "control-id" };
      mainCalls += 1;
      if (mainCalls === 1) throw new DigestMismatchError("DIGEST_MISMATCH");
      return { assetId: "main-id" };
    });
    ensureWalletMock.mockResolvedValue({
      assetManager: { issue },
      getVtxoManager: jest.fn(async () => ({
        getDeprecatedSignerStatus: jest.fn(async () => []),
      })),
    });

    const result = await useAppStore
      .getState()
      .issueAsset({ amount: 100n, controlMode: "new" });

    expect(result).toEqual({ assetId: "main-id" });
    // Control asset minted exactly once despite the main-issuance retry.
    const controlCalls = issue.mock.calls.filter((c) => c[0].amount === 1n);
    expect(controlCalls).toHaveLength(1);
    // Main issuance was attempted twice (rebuild + retry).
    expect(mainCalls).toBe(2);
    expect(disposeWalletMock).toHaveBeenCalled();
  });

  it("flags _updateRequired when ensureWallet hits BUILD_VERSION_TOO_OLD", async () => {
    const buildErr = new Error("BUILD_VERSION_TOO_OLD (48): client too old");
    maybeArkErrorMock.mockImplementation((e) =>
      e === buildErr ? { name: "BUILD_VERSION_TOO_OLD", code: 48 } : undefined,
    );
    ensureWalletMock.mockRejectedValue(buildErr);

    await expect(
      useAppStore.getState().issueAsset({ amount: 100n, controlMode: "new" }),
    ).rejects.toMatchObject({ kind: "update_required" });
    expect(useAppStore.getState()._updateRequired).toBe(true);

    maybeArkErrorMock.mockReturnValue(undefined);
    useAppStore.setState({ _updateRequired: false });
  });
});

describe("useAppStore.migrateDeprecatedSigners", () => {
  beforeEach(async () => {
    await flushMicrotasks();
    jest.clearAllMocks();
    stubRefreshWalletDeps();
    useAppStore.setState({
      wallet: makeWalletMetadata(),
      security: { isLocked: false, biometricsEnabled: false },
      _signerMigrationInFlight: false,
    });
  });

  it("rejects when locked", async () => {
    useAppStore.setState({
      security: { isLocked: true, biometricsEnabled: false },
    });
    await expect(
      useAppStore.getState().migrateDeprecatedSigners(),
    ).rejects.toMatchObject({ kind: "wallet_not_ready" });
  });

  it("runs SDK migration, refreshes wallet + signer status, returns the raw report", async () => {
    const report = {
      rotated: true,
      vtxos: { txid: "t", migrated: [{ txid: "v", vout: 0, value: 10 }] },
      expired: [],
      signers: [],
    };
    const migrateDeprecatedSignerVtxos = jest.fn(async () => report);
    const getDeprecatedSignerStatus = jest.fn(async () => []);
    ensureWalletMock.mockResolvedValue({
      getVtxoManager: jest.fn(async () => ({
        migrateDeprecatedSignerVtxos,
        getDeprecatedSignerStatus,
      })),
    });

    const result = await useAppStore.getState().migrateDeprecatedSigners();

    expect(migrateDeprecatedSignerVtxos).toHaveBeenCalledTimes(1);
    expect(result).toBe(report);
    // refreshWallet ran (snapshot) and signer status was re-derived.
    expect(refreshWalletSnapshotMock).toHaveBeenCalled();
    expect(getDeprecatedSignerStatus).toHaveBeenCalled();
    expect(useAppStore.getState()._signerMigrationInFlight).toBe(false);
  });

  it("clears the in-flight flag and wraps a hard failure", async () => {
    const migrateDeprecatedSignerVtxos = jest.fn(async () => {
      throw new Error("settle boom");
    });
    ensureWalletMock.mockResolvedValue({
      getVtxoManager: jest.fn(async () => ({ migrateDeprecatedSignerVtxos })),
    });

    await expect(
      useAppStore.getState().migrateDeprecatedSigners(),
    ).rejects.toMatchObject({ kind: "signer_migration_failed" });
    expect(useAppStore.getState()._signerMigrationInFlight).toBe(false);
  });
});

describe("useAppStore — update-required onboarding", () => {
  beforeEach(async () => {
    await flushMicrotasks();
    jest.clearAllMocks();
    maybeArkErrorMock.mockReturnValue(undefined);
    useAppStore.setState({
      wallet: null,
      _updateRequired: false,
      network: {
        arkServerUrl: MAINNET_ARK_SERVER_URL,
        detectedNetwork: null,
        status: "idle",
        lastError: null,
        serverInfo: null,
      },
    });
  });

  afterEach(() => {
    maybeArkErrorMock.mockReturnValue(undefined);
  });

  it("createWallet flags _updateRequired on BUILD_VERSION_TOO_OLD and suppresses the generic error", async () => {
    const buildErr = new Error("BUILD_VERSION_TOO_OLD (48): client too old");
    probeServerMock.mockRejectedValueOnce(buildErr);
    maybeArkErrorMock.mockImplementation((e) =>
      e === buildErr ? { name: "BUILD_VERSION_TOO_OLD", code: 48 } : undefined,
    );

    await expect(
      useAppStore.getState().createWallet("mnemonic", "static"),
    ).rejects.toMatchObject({ kind: "update_required" });

    const s = useAppStore.getState();
    expect(s._updateRequired).toBe(true);
    expect(s.network.status).toBe("offline");
    // No generic "server unreachable" message competes with the global modal.
    expect(s.network.lastError).toBeNull();
  });

  it("refreshServer flags _updateRequired without surfacing a generic error", async () => {
    const buildErr = new Error("BUILD_VERSION_TOO_OLD (48): client too old");
    probeServerMock.mockRejectedValueOnce(buildErr);
    maybeArkErrorMock.mockImplementation((e) =>
      e === buildErr ? { name: "BUILD_VERSION_TOO_OLD", code: 48 } : undefined,
    );

    await useAppStore.getState().refreshServer();

    const s = useAppStore.getState();
    expect(s._updateRequired).toBe(true);
    expect(s.network.status).toBe("offline");
    expect(s.network.lastError).toBeNull();
  });

  it("refreshServer keeps the generic error for an ordinary unreachable server", async () => {
    probeServerMock.mockRejectedValueOnce(new Error("network down"));
    maybeArkErrorMock.mockReturnValue(undefined);

    await useAppStore.getState().refreshServer();

    const s = useAppStore.getState();
    expect(s._updateRequired).toBe(false);
    expect(s.network.status).toBe("offline");
    expect(s.network.lastError).toBe("network down");
  });
});
