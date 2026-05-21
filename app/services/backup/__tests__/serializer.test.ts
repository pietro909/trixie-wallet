// Round-trip the backup serializer for LNURL-tagged swap metadata. The
// parser previously rejected anything outside "send"/"receive" — these
// tests pin the broader LocalSwapFlow domain.

import type { BoltzSwap } from "@arkade-os/boltz-swap";
import type {
  ArkadeWalletMetadata,
  WalletBehavior,
} from "../../../store/types";
import type { StoredSecret } from "../../arkade/secret-store";
import type { LocalSwapMetadata } from "../../arkade/swap-storage";
import {
  buildBackupPayload,
  PayloadParseError,
  parseBackupPayload,
} from "../serializer";

const wallet: ArkadeWalletMetadata = {
  id: "w1",
  type: "arkade",
  label: "Test wallet",
  identityKind: "mnemonic",
  publicKeyHex: "00",
  arkServerUrl: "https://ark.example",
  network: "mutinynet",
  arkAddress: "ark1example",
  boardingAddress: "tb1example",
  balanceSats: 0,
  balanceTotalSats: 0,
  balanceBoardingSats: 0,
  assetBalances: [],
  activities: [],
  backup: { hasMnemonic: true, hasPrivateKey: false },
};

const walletBehavior: WalletBehavior = {
  vtxoAutoRenewal: false,
  delegatedRenewal: false,
};

const secret: StoredSecret = {
  kind: "mnemonic",
  mnemonic:
    "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
};

function makeMeta(over: Partial<LocalSwapMetadata>): LocalSwapMetadata {
  return {
    swapId: "s1",
    walletId: "w1",
    direction: "in",
    createdForFlow: "receive",
    invoiceAmountSats: 1000,
    arkadeAmountSats: 950,
    walletTxId: null,
    paymentHash: "ph-1",
    linkSource: null,
    backgroundNotified: false,
    restoredAt: null,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    ...over,
  };
}

describe("backup serializer LNURL round-trip", () => {
  it("round-trips lnurl_receive and lnurl_send metadata", () => {
    const swapMetadata: LocalSwapMetadata[] = [
      makeMeta({
        swapId: "r1",
        direction: "in",
        createdForFlow: "lnurl_receive",
      }),
      makeMeta({
        swapId: "r2",
        direction: "in",
        createdForFlow: "receive",
      }),
      makeMeta({
        swapId: "s1",
        direction: "out",
        createdForFlow: "lnurl_send",
        invoiceAmountSats: 2000,
        arkadeAmountSats: 2100,
      }),
      makeMeta({
        swapId: "s2",
        direction: "out",
        createdForFlow: "send",
        invoiceAmountSats: 2000,
        arkadeAmountSats: 2100,
      }),
    ];

    const built = buildBackupPayload({
      wallet,
      walletBehavior,
      preferences: {
        theme: "system",
        fiatCurrency: "EUR",
        bitcoinUnit: "auto",
        notifications: { enabled: false, swaps: false, payments: false },
      },
      secret,
      swapMetadata,
      boltzSwaps: [] as BoltzSwap[],
      importedAssetIds: [],
      contractLabels: [],
    });

    // Serialize → deserialize via JSON to mirror the on-disk envelope path.
    const wire = JSON.parse(JSON.stringify(built));
    const parsed = parseBackupPayload(wire);

    const byId = new Map(parsed.swapMetadata.map((m) => [m.swapId, m]));
    expect(byId.get("r1")?.createdForFlow).toBe("lnurl_receive");
    expect(byId.get("r2")?.createdForFlow).toBe("receive");
    expect(byId.get("s1")?.createdForFlow).toBe("lnurl_send");
    expect(byId.get("s2")?.createdForFlow).toBe("send");
  });

  it("rejects an unknown createdForFlow value", () => {
    const payload = buildBackupPayload({
      wallet,
      walletBehavior,
      preferences: {
        theme: "system",
        fiatCurrency: "EUR",
        bitcoinUnit: "auto",
        notifications: { enabled: false, swaps: false, payments: false },
      },
      secret,
      swapMetadata: [],
      boltzSwaps: [] as BoltzSwap[],
      importedAssetIds: [],
      contractLabels: [],
    });
    const wire = JSON.parse(JSON.stringify(payload)) as Record<string, unknown>;
    (wire.swapMetadata as unknown[]).push({
      swapId: "x",
      walletId: "w1",
      direction: "in",
      createdForFlow: "bogus",
      createdAt: 1,
      updatedAt: 1,
    });
    expect(() => parseBackupPayload(wire)).toThrow(PayloadParseError);
  });
});

describe("backup serializer network round-trip", () => {
  it("round-trips a wallet with network bitcoin", () => {
    const mainnetWallet: ArkadeWalletMetadata = {
      ...wallet,
      network: "bitcoin",
      arkServerUrl: "https://arkade.computer",
    };
    const built = buildBackupPayload({
      wallet: mainnetWallet,
      walletBehavior,
      preferences: {
        theme: "system",
        fiatCurrency: "EUR",
        bitcoinUnit: "auto",
        notifications: { enabled: false, swaps: false, payments: false },
      },
      secret,
      swapMetadata: [],
      boltzSwaps: [] as BoltzSwap[],
      importedAssetIds: [],
      contractLabels: [],
    });
    const wire = JSON.parse(JSON.stringify(built));
    const parsed = parseBackupPayload(wire);
    expect(parsed.wallet.network).toBe("bitcoin");
    expect(parsed.wallet.arkServerUrl).toBe("https://arkade.computer");
  });
});

describe("backup serializer contract labels round-trip", () => {
  function buildWithLabels(
    contractLabels: { script: string; label: string }[],
  ) {
    return buildBackupPayload({
      wallet,
      walletBehavior,
      preferences: {
        theme: "system",
        fiatCurrency: "EUR",
        bitcoinUnit: "auto",
        notifications: { enabled: false, swaps: false, payments: false },
      },
      secret,
      swapMetadata: [],
      boltzSwaps: [] as BoltzSwap[],
      importedAssetIds: [],
      contractLabels,
    });
  }

  it("round-trips contractLabels byte-for-byte", () => {
    const built = buildWithLabels([
      { script: "s1", label: "Primary" },
      { script: "s2", label: "Delegate" },
    ]);
    const wire = JSON.parse(JSON.stringify(built));
    const parsed = parseBackupPayload(wire);
    expect(parsed.contractLabels).toEqual([
      { script: "s1", label: "Primary" },
      { script: "s2", label: "Delegate" },
    ]);
  });

  it("stamps the new version as 3", () => {
    const built = buildWithLabels([]);
    expect(built.version).toBe(3);
  });

  it("falls back to an empty contractLabels list for v1 backups", () => {
    const v1 = {
      version: 1,
      createdAt: 1,
      wallet: {
        id: "w1",
        label: "x",
        identityKind: "mnemonic",
        arkServerUrl: "https://ark.example",
        esploraUrl: null,
        network: "mutinynet",
      },
      walletBehavior,
      preferences: {
        theme: "system",
        fiatCurrency: "EUR",
        bitcoinUnit: "auto",
      },
      secret,
      swapMetadata: [],
      boltzSwaps: [],
    };
    const parsed = parseBackupPayload(v1);
    expect(parsed.contractLabels).toEqual([]);
    expect(parsed.importedAssetIds).toEqual([]);
  });

  it("falls back to an empty contractLabels list for v2 backups", () => {
    const v2 = {
      version: 2,
      createdAt: 1,
      wallet: {
        id: "w1",
        label: "x",
        identityKind: "mnemonic",
        arkServerUrl: "https://ark.example",
        esploraUrl: null,
        network: "mutinynet",
      },
      walletBehavior,
      preferences: {
        theme: "system",
        fiatCurrency: "EUR",
        bitcoinUnit: "auto",
      },
      secret,
      swapMetadata: [],
      boltzSwaps: [],
      importedAssetIds: ["a"],
    };
    const parsed = parseBackupPayload(v2);
    expect(parsed.contractLabels).toEqual([]);
    expect(parsed.importedAssetIds).toEqual(["a"]);
  });

  it("rejects a contractLabels entry with an empty script", () => {
    const payload = buildWithLabels([{ script: "ok", label: "L" }]);
    const wire = JSON.parse(JSON.stringify(payload)) as Record<string, unknown>;
    (wire.contractLabels as unknown[]).push({ script: "", label: "x" });
    expect(() => parseBackupPayload(wire)).toThrow(PayloadParseError);
  });

  it("rejects a contractLabels entry with an empty label", () => {
    const payload = buildWithLabels([{ script: "ok", label: "L" }]);
    const wire = JSON.parse(JSON.stringify(payload)) as Record<string, unknown>;
    (wire.contractLabels as unknown[]).push({ script: "s", label: "" });
    expect(() => parseBackupPayload(wire)).toThrow(PayloadParseError);
  });

  it("rejects a non-array contractLabels field", () => {
    const payload = buildWithLabels([]);
    const wire = JSON.parse(JSON.stringify(payload)) as Record<string, unknown>;
    wire.contractLabels = "not-an-array";
    expect(() => parseBackupPayload(wire)).toThrow(PayloadParseError);
  });

  it("dedupes by script (last write wins)", () => {
    const payload = buildWithLabels([
      { script: "s1", label: "First" },
      { script: "s1", label: "Second" },
    ]);
    const wire = JSON.parse(JSON.stringify(payload));
    const parsed = parseBackupPayload(wire);
    expect(parsed.contractLabels).toEqual([{ script: "s1", label: "Second" }]);
  });
});
