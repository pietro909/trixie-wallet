// runtime.ts pulls the SDK, expo adapters, identity (descriptors-scure),
// storage (sqlite), and activity-history. Stub them so we can exercise the
// pure `arkInfoToServerInfo` converter in isolation.
jest.mock("@arkade-os/sdk", () => ({
  Wallet: { create: jest.fn() },
  RestDelegatorProvider: jest.fn(),
  DigestMismatchError: class DigestMismatchError extends Error {},
  maybeArkError: jest.fn(() => undefined),
}));

jest.mock("@arkade-os/sdk/adapters/expo", () => ({
  ExpoArkProvider: jest.fn(),
  ExpoIndexerProvider: jest.fn(),
}));

jest.mock("../activity-history", () => ({ getActivityHistory: jest.fn() }));
jest.mock("../identity", () => ({
  buildIdentityFromSecret: jest.fn(),
  bytesToHex: jest.fn(),
}));
jest.mock("../secret-store", () => ({ readSecret: jest.fn() }));
jest.mock("../storage", () => ({
  clearWalletData: jest.fn(),
  createRepositories: jest.fn(),
}));
jest.mock("../tx-cache", () => ({ clearAllTimestamps: jest.fn() }));

import type { ArkInfo } from "@arkade-os/sdk";
import { arkInfoToServerInfo } from "../runtime";

function makeArkInfo(partial: Partial<ArkInfo> = {}): ArkInfo {
  return {
    boardingExitDelay: 100n,
    checkpointTapscript: "cp",
    deprecatedSigners: partial.deprecatedSigners ?? [],
    digest: "digest",
    dust: partial.dust ?? 546n,
    fees: partial.fees ?? {
      txFeeRate: "1.5",
      intentFee: {
        offchainInput: "10",
        onchainInput: "20",
        offchainOutput: "30",
        onchainOutput: "40",
      },
    },
    forfeitAddress: "forfeit-addr",
    forfeitPubkey: "forfeit-pk",
    network: partial.network ?? "bitcoin",
    serviceStatus: {},
    sessionDuration: 0n,
    signerPubkey: partial.signerPubkey ?? "signer-pk",
    unilateralExitDelay: partial.unilateralExitDelay ?? 86_400n,
    utxoMaxAmount: -1n,
    utxoMinAmount: 0n,
    version: partial.version ?? "1.2.3",
    vtxoMaxAmount: -1n,
    vtxoMinAmount: 0n,
  } as ArkInfo;
}

describe("arkInfoToServerInfo", () => {
  it("maps scalar fields and coerces bigints to numbers", () => {
    const info = arkInfoToServerInfo(
      makeArkInfo({
        network: "mutinynet",
        version: "9.9.9",
        signerPubkey: "abc",
        dust: 1234n,
        unilateralExitDelay: 604_800n,
      }),
    );
    expect(info).toMatchObject({
      network: "mutinynet",
      version: "9.9.9",
      signerPubkey: "abc",
      forfeitAddress: "forfeit-addr",
      dustSats: 1234,
      unilateralExitDelaySeconds: 604_800,
      txFeeRate: "1.5",
    });
    expect(typeof info.dustSats).toBe("number");
    expect(typeof info.unilateralExitDelaySeconds).toBe("number");
  });

  it("maps the four intent-fee programs", () => {
    const info = arkInfoToServerInfo(makeArkInfo());
    expect(info.intentFee).toEqual({
      offchainInput: "10",
      onchainInput: "20",
      offchainOutput: "30",
      onchainOutput: "40",
    });
  });

  it("serializes every deprecated signer cutoff as a decimal string", () => {
    const info = arkInfoToServerInfo(
      makeArkInfo({
        deprecatedSigners: [
          { pubkey: "key-future", cutoffDate: 1_900_000_000n },
          { pubkey: "key-due-now", cutoffDate: 0n },
        ],
      }),
    );
    expect(info.deprecatedSigners).toEqual([
      { pubkey: "key-future", cutoffDateSeconds: "1900000000" },
      { pubkey: "key-due-now", cutoffDateSeconds: "0" },
    ]);
    for (const s of info.deprecatedSigners) {
      expect(typeof s.cutoffDateSeconds).toBe("string");
    }
  });

  it("produces an empty deprecatedSigners array when none are advertised", () => {
    expect(arkInfoToServerInfo(makeArkInfo()).deprecatedSigners).toEqual([]);
  });
});
