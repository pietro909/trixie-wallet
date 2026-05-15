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
}));

jest.mock("../../services/arkade/runtime", () => ({
  ensureWallet: jest.fn(),
  disposeWallet: jest.fn(),
  setIncomingFundsListener: jest.fn(),
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

import {
  MAINNET_ARK_SERVER_URL,
  MUTINYNET_ARK_SERVER_URL,
} from "../../services/arkade/network";
import { LEGACY_STORAGE_KEYS, STORAGE_KEY } from "../storage-keys";
import { generateSalt, hashPassword, useAppStore } from "../useAppStore";

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
      JSON.stringify({ schemaVersion: 6, wallet: null }),
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
