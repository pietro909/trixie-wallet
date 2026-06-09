import type { ArkadeWalletMetadata } from "../../store/types";
import {
  makeAllPayloads,
  makeArkadePayload,
  makeBitcoinPayload,
  makeReceivePayload,
} from "../receive";

// Synthetic wallet metadata. Only the fields the receive helpers read need to
// match real shape; the rest are placeholders kept JSON-safe.
const wallet: ArkadeWalletMetadata = {
  id: "wallet-1",
  type: "arkade",
  label: "Test wallet",
  identityKind: "mnemonic",
  walletMode: "static",
  publicKeyHex: "00".repeat(33),
  arkServerUrl: "https://mutinynet.arkade.sh",
  network: "mutinynet",
  arkAddress: "tark1exampleaddressforreceivetests0000000000000000000000",
  boardingAddress: "tb1qexampleboardingaddressforreceivetests000000000000",
  balanceSats: 0,
  balanceTotalSats: 0,
  balanceBoardingSats: 0,
  assetBalances: [],
  activities: [],
  backup: { hasMnemonic: true, hasPrivateKey: false },
};

describe("makeReceivePayload", () => {
  it("returns an Arkade payload for type=arkade", () => {
    const p = makeReceivePayload(wallet, "arkade");
    expect(p.type).toBe("arkade");
    expect(p.payload).toBe(wallet.arkAddress);
  });

  it("returns a BIP-21 Bitcoin payload for type=bitcoin", () => {
    const p = makeReceivePayload(wallet, "bitcoin");
    expect(p.type).toBe("bitcoin");
    expect(p.payload).toBe(`bitcoin:${wallet.boardingAddress}`);
  });

  it("throws for type=lightning — invoices are minted by the Lightning flow", () => {
    expect(() => makeReceivePayload(wallet, "lightning")).toThrow(
      /Lightning receive is not available/,
    );
  });

  it("throws for type=lnurl — LNURL is served by the session hook, not a static payload", () => {
    expect(() => makeReceivePayload(wallet, "lnurl")).toThrow(
      /LNURL receive is not available/,
    );
  });
});

describe("makeAllPayloads", () => {
  it("returns Arkade + Bitcoin alternates only", () => {
    const list = makeAllPayloads(wallet, "arkade");
    expect(list.map((p) => p.type)).toEqual(["arkade", "bitcoin"]);
  });

  it("places the requested primary at the head of the list", () => {
    const list = makeAllPayloads(wallet, "bitcoin");
    expect(list.map((p) => p.type)).toEqual(["bitcoin", "arkade"]);
  });

  it("hides the Bitcoin alternate when receiving a specific asset", () => {
    const list = makeAllPayloads(wallet, "arkade", { assetId: "asset-id" });
    expect(list.map((p) => p.type)).toEqual(["arkade"]);
  });
});

describe("makeArkadePayload amount handling", () => {
  it("encodes amounts and asset ids as BIP-21-style query params", () => {
    const p = makeArkadePayload(wallet, {
      amountSats: 1_000,
      assetId: "asset-id",
      assetAmountBase: "1234",
    });
    expect(p.payload).toContain("amount=0.00001000");
    expect(p.payload).toContain("assetid=asset-id");
    expect(p.payload).toContain("assetamount=1234");
  });
});

describe("makeBitcoinPayload amount handling", () => {
  it("appends a BIP-21 amount when provided", () => {
    const p = makeBitcoinPayload(wallet, { amountSats: 50_000 });
    expect(p.payload).toBe(
      `bitcoin:${wallet.boardingAddress}?amount=0.00050000`,
    );
  });
});
