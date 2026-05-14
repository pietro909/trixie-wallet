import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Crypto from "expo-crypto";

jest.mock("@react-native-async-storage/async-storage", () => ({
  setItem: jest.fn(),
  getItem: jest.fn(),
  removeItem: jest.fn(),
}));

jest.mock("expo-crypto", () => ({
  digestStringAsync: jest.fn((_alg, str) => Promise.resolve(`hashed-${str}`)),
  getRandomBytes: jest.fn((len) => new Uint8Array(len).fill(1)),
  CryptoDigestAlgorithm: {
    SHA256: "SHA256",
  },
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

jest.mock("../../services/arkade/swap-background", () => ({
  ensureSwapBackgroundRegistered: jest.fn(),
  unregisterSwapBackgroundTask: jest.fn(),
}));

jest.mock("../../services/arkade/asset-format", () => ({
  isValidAssetId: jest.fn(() => true),
}));

jest.mock("../../services/diagnostics/persisted", () => ({
  drainPersistedErrors: jest.fn(() => Promise.resolve([])),
}));

import { LEGACY_STORAGE_KEYS, STORAGE_KEY } from "../storage-keys";
import { generateSalt, hashPassword, useAppStore } from "../useAppStore";

describe("useAppStore security utilities", () => {
  describe("hashPassword", () => {
    it("should generate a SHA-256 hash of password + salt", async () => {
      const password = "password123";
      const salt = "somesalt";
      const hash = await hashPassword(password, salt);

      expect(Crypto.digestStringAsync).toHaveBeenCalledWith(
        "SHA256",
        password + salt,
      );
      expect(hash).toBe(`hashed-${password}${salt}`);
    });

    it("should produce different hashes for different salts", async () => {
      (Crypto.digestStringAsync as jest.Mock).mockImplementation((_alg, str) =>
        Promise.resolve(`hash-${str}`),
      );

      const password = "password123";
      const hash1 = await hashPassword(password, "salt1");
      const hash2 = await hashPassword(password, "salt2");
      expect(hash1).not.toBe(hash2);
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
      JSON.stringify({ schemaVersion: 4, wallet: null }),
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
      JSON.stringify({ schemaVersion: 5, wallet: null }),
    );

    await useAppStore.getState().hydrate();

    const state = useAppStore.getState();
    expect(state._hydrated).toBe(true);
    expect(state._schemaMismatch).toBe(false);
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
