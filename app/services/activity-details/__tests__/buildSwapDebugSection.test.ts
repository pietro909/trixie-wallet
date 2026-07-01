// Unit tests for the "Swap debug" section builder. Pure function — no I/O —
// so fixtures stand in for the live `BoltzSwap` object the screen fetches via
// `getBoltzSwapById`. Mirrors the fixture style used by
// `swapMetadataExport.test.ts`.

import type {
  BoltzChainSwap,
  BoltzReverseSwap,
  BoltzSubmarineSwap,
} from "@arkade-os/boltz-swap";
import type { Activity } from "../../../store/types";
import { buildSwapDebugSection } from "../buildSwapDebugSection";

const TIMEOUTS = {
  refund: 800100,
  unilateralClaim: 800050,
  unilateralRefund: 800150,
  unilateralRefundWithoutReceiver: 800200,
};

function activityFor(
  swapType: "reverse" | "submarine" | "chain",
  swapId: string,
): Activity {
  return {
    id: `swap:${swapId}`,
    kind: "lightning_swap",
    direction: "in",
    amountSats: 9500,
    timestamp: 1_700_000_000_000,
    title: "Lightning received",
    status: "confirmed",
    rail: "lightning",
    source: { type: "boltz_swap", provider: "boltz", swapId, swapType },
    metadata: { swapId, provider: "boltz" },
  };
}

function reverseSwap(
  overrides: Partial<BoltzReverseSwap> = {},
): BoltzReverseSwap {
  return {
    id: "rev-1",
    type: "reverse",
    createdAt: 1_700_000_000,
    preimage: "deadbeefcafef00d",
    status: "transaction.mempool",
    request: {
      claimPublicKey: "02aa",
      invoiceAmount: 10000,
      preimageHash: "ab",
    },
    response: {
      id: "rev-1",
      invoice: "lnbc1...",
      onchainAmount: 9500,
      lockupAddress: "ark1lockupreverse",
      refundPublicKey: "03bb",
      timeoutBlockHeight: 800000,
      timeoutBlockHeights: TIMEOUTS,
    },
    ...overrides,
  } as BoltzReverseSwap;
}

function submarineSwap(
  overrides: Partial<BoltzSubmarineSwap> = {},
): BoltzSubmarineSwap {
  return {
    id: "sub-1",
    type: "submarine",
    createdAt: 1_700_000_000,
    status: "swap.expired",
    refunded: false,
    request: { invoice: "lnbc1...", refundPublicKey: "03cc" },
    response: {
      id: "sub-1",
      expectedAmount: 10000,
      address: "ark1lockupsubmarine",
      claimPublicKey: "02dd",
      timeoutBlockHeight: 800000,
      timeoutBlockHeights: TIMEOUTS,
    },
    ...overrides,
  } as BoltzSubmarineSwap;
}

function chainSwap(overrides: Partial<BoltzChainSwap> = {}): BoltzChainSwap {
  return {
    id: "chain-1",
    type: "chain",
    createdAt: 1_700_000_000,
    preimage: "cafef00ddeadbeef",
    ephemeralKey: "priv-hex-ephemeral",
    feeSatsPerByte: 5,
    status: "swap.expired",
    request: {
      to: "BTC",
      from: "ARK",
      preimageHash: "ab",
      claimPublicKey: "02aa",
      refundPublicKey: "03bb",
      feeSatsPerByte: 5,
    },
    response: {
      id: "chain-1",
      claimDetails: {
        amount: 9000,
        lockupAddress: "bc1qclaimaddress",
        timeoutBlockHeight: 800000,
        serverPublicKey: "02ee",
        timeouts: TIMEOUTS,
      },
      lockupDetails: {
        amount: 10000,
        lockupAddress: "ark1lockupchain",
        timeoutBlockHeight: 800000,
        serverPublicKey: "02ff",
        timeouts: TIMEOUTS,
      },
    },
    toAddress: "bc1qdestination",
    amount: 10000,
    ...overrides,
  } as BoltzChainSwap;
}

function rowByLabel(
  section: ReturnType<typeof buildSwapDebugSection>,
  label: string,
) {
  return section?.rows.find((r) => r.label === label);
}

describe("buildSwapDebugSection", () => {
  it("returns null for non-Boltz activities", () => {
    const activity: Activity = {
      ...activityFor("reverse", "rev-1"),
      source: { type: "arkade_tx", walletTxId: "txid-1" },
    };
    expect(buildSwapDebugSection(activity, reverseSwap())).toBeNull();
  });

  it("returns null while the live swap hasn't loaded", () => {
    expect(
      buildSwapDebugSection(activityFor("reverse", "rev-1"), null),
    ).toBeNull();
  });

  describe("reverse swaps", () => {
    it("surfaces the lockup address as a copyable Arkade-explorer row", () => {
      const section = buildSwapDebugSection(
        activityFor("reverse", "rev-1"),
        reverseSwap(),
      );
      expect(section?.title).toBe("Swap debug");
      expect(section?.tone).toBe("warning");
      const row = rowByLabel(section, "Lockup address (Arkade)");
      expect(row?.kind).toBe("copy");
      expect(row).toMatchObject({
        value: "ark1lockupreverse",
        mono: true,
        explorerKind: "arkade_address",
      });
    });

    it("surfaces refund/claim public keys and timeout breakdown", () => {
      const section = buildSwapDebugSection(
        activityFor("reverse", "rev-1"),
        reverseSwap(),
      );
      expect(rowByLabel(section, "Boltz refund public key")?.value).toBe(
        "03bb",
      );
      expect(rowByLabel(section, "Our claim public key")?.value).toBe("02aa");
      expect(rowByLabel(section, "Lockup timeout height")?.value).toBe(
        "800000",
      );
      expect(rowByLabel(section, "Lockup refund height")?.value).toBe("800100");
      expect(rowByLabel(section, "Lockup unilateral claim height")?.value).toBe(
        "800050",
      );
    });

    it("reports Claimable: Yes for a claimable status, No otherwise", () => {
      const claimable = buildSwapDebugSection(
        activityFor("reverse", "rev-1"),
        reverseSwap({ status: "transaction.mempool" }),
      );
      expect(rowByLabel(claimable, "Claimable")?.value).toBe("Yes");

      const notClaimable = buildSwapDebugSection(
        activityFor("reverse", "rev-1"),
        reverseSwap({ status: "invoice.settled" }),
      );
      expect(rowByLabel(notClaimable, "Claimable")?.value).toBe("No");
    });

    it("carries the preimage as a masked secret row", () => {
      const section = buildSwapDebugSection(
        activityFor("reverse", "rev-1"),
        reverseSwap(),
      );
      const row = rowByLabel(section, "Preimage");
      expect(row?.kind).toBe("secret");
      expect(row).toMatchObject({
        value: "deadbeefcafef00d",
        warning: expect.stringContaining("do not share"),
      });
    });
  });

  describe("submarine swaps", () => {
    it("surfaces the lockup address, claim/refund public keys", () => {
      const section = buildSwapDebugSection(
        activityFor("submarine", "sub-1"),
        submarineSwap(),
      );
      expect(rowByLabel(section, "Lockup address (Arkade)")).toMatchObject({
        kind: "copy",
        value: "ark1lockupsubmarine",
        explorerKind: "arkade_address",
      });
      expect(rowByLabel(section, "Boltz claim public key")?.value).toBe("02dd");
      expect(rowByLabel(section, "Our refund public key")?.value).toBe("03cc");
    });

    it("computes Refundable from status/refundable/refunded flags", () => {
      const refundable = buildSwapDebugSection(
        activityFor("submarine", "sub-1"),
        submarineSwap({ status: "swap.expired", refunded: false }),
      );
      expect(rowByLabel(refundable, "Refundable")?.value).toBe("Yes");
      expect(rowByLabel(refundable, "Refunded")?.value).toBe("No");

      const alreadyRefunded = buildSwapDebugSection(
        activityFor("submarine", "sub-1"),
        submarineSwap({ status: "swap.expired", refunded: true }),
      );
      expect(rowByLabel(alreadyRefunded, "Refundable")?.value).toBe("No");
      expect(rowByLabel(alreadyRefunded, "Refunded")?.value).toBe("Yes");

      const notRefundable = buildSwapDebugSection(
        activityFor("submarine", "sub-1"),
        submarineSwap({ status: "invoice.paid" }),
      );
      expect(rowByLabel(notRefundable, "Refundable")?.value).toBe("No");
    });

    it("omits the preimage row until it is known", () => {
      const pending = buildSwapDebugSection(
        activityFor("submarine", "sub-1"),
        submarineSwap({ preimage: undefined }),
      );
      expect(rowByLabel(pending, "Preimage")).toBeUndefined();

      const settled = buildSwapDebugSection(
        activityFor("submarine", "sub-1"),
        submarineSwap({ preimage: "settledpreimagehex" }),
      );
      expect(rowByLabel(settled, "Preimage")).toMatchObject({
        kind: "secret",
        value: "settledpreimagehex",
      });
    });
  });

  describe("chain swaps", () => {
    it("surfaces distinct lockup (Arkade) and claim (Bitcoin) addresses", () => {
      const section = buildSwapDebugSection(
        activityFor("chain", "chain-1"),
        chainSwap(),
      );
      expect(rowByLabel(section, "Lockup address (Arkade)")).toMatchObject({
        kind: "copy",
        value: "ark1lockupchain",
        explorerKind: "arkade_address",
      });
      expect(rowByLabel(section, "Claim address (Bitcoin)")).toMatchObject({
        kind: "copy",
        value: "bc1qclaimaddress",
        explorerKind: "bitcoin_address",
      });
      expect(rowByLabel(section, "Destination address")).toMatchObject({
        value: "bc1qdestination",
        explorerKind: "bitcoin_address",
      });
    });

    it("surfaces per-leg timeout breakdowns and fee rate", () => {
      const section = buildSwapDebugSection(
        activityFor("chain", "chain-1"),
        chainSwap(),
      );
      expect(rowByLabel(section, "Lockup timeout height")?.value).toBe(
        "800000",
      );
      expect(rowByLabel(section, "Claim timeout height")?.value).toBe("800000");
      expect(rowByLabel(section, "Claim refund height")?.value).toBe("800100");
      expect(rowByLabel(section, "Fee rate")?.value).toBe("5 sat/vB");
    });

    it("computes Refundable/Claimable from status + direction", () => {
      const refundable = buildSwapDebugSection(
        activityFor("chain", "chain-1"),
        chainSwap({ status: "swap.expired" }),
      );
      expect(rowByLabel(refundable, "Refundable")?.value).toBe("Yes");
      expect(rowByLabel(refundable, "Claimable")?.value).toBe("No");

      const claimable = buildSwapDebugSection(
        activityFor("chain", "chain-1"),
        chainSwap({ status: "transaction.server.mempool" }),
      );
      expect(rowByLabel(claimable, "Claimable")?.value).toBe("Yes");
      expect(rowByLabel(claimable, "Refundable")?.value).toBe("No");
    });

    it("carries both the preimage and the ephemeral signing key as secrets", () => {
      const section = buildSwapDebugSection(
        activityFor("chain", "chain-1"),
        chainSwap(),
      );
      expect(rowByLabel(section, "Preimage")).toMatchObject({
        kind: "secret",
        value: "cafef00ddeadbeef",
      });
      const keyRow = rowByLabel(section, "Ephemeral signing key");
      expect(keyRow).toMatchObject({
        kind: "secret",
        value: "priv-hex-ephemeral",
        warning: expect.stringContaining("never share"),
      });
    });
  });
});
