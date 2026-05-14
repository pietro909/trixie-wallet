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

import { generateSalt, hashPassword, migrate } from "../useAppStore";

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

  describe("migrate", () => {
    it("should clear password hash and salt when migrating from v4 to v5", () => {
      const v4State = {
        schemaVersion: 4,
        security: {
          isLocked: true,
          passwordHash: "old-simple-hash",
          biometricsEnabled: true,
        },
        preferences: { theme: "dark" },
      };

      const migrated = migrate(v4State, 4);
      const sec = migrated.security as Record<string, unknown>;
      const prefs = migrated.preferences as Record<string, unknown>;

      expect(migrated.schemaVersion).toBe(5);
      expect(sec.passwordHash).toBeUndefined();
      expect(sec.passwordSalt).toBeUndefined();
      expect(sec.isLocked).toBe(false);
      expect(sec.biometricsEnabled).toBe(true);
      expect(prefs.theme).toBe("dark");
    });

    it("should not modify security if version is already 5", () => {
      const v5State = {
        schemaVersion: 5,
        security: {
          isLocked: true,
          passwordHash: "secure-hash",
          passwordSalt: "secure-salt",
        },
      };

      const migrated = migrate(v5State, 5);
      expect(migrated).toEqual(v5State);
    });

    it("should handle missing security object gracefully during migration", () => {
      const v4State = {
        schemaVersion: 4,
        preferences: { theme: "light" },
      };

      const migrated = migrate(v4State, 4);
      const prefs = migrated.preferences as Record<string, unknown>;

      expect(migrated.schemaVersion).toBe(5);
      expect(prefs.theme).toBe("light");
      expect(migrated.security).toBeUndefined();
    });
  });
});
