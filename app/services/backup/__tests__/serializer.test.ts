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
