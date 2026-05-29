// Unit tests for the Boltz-swap "Copy metadata" export assembler. The two
// data-source modules are mocked so the test stays isolated from the SDK /
// SQLite layer — we only pin the composition behaviour and the secret
// pass-through that the feature promises.

import type { BoltzSwap } from "@arkade-os/boltz-swap";
import type { Activity } from "../../../store/types";
import type { LocalSwapMetadata } from "../../arkade/swap-storage";

jest.mock("../../arkade/lightning", () => ({
  getBoltzSwapById: jest.fn(),
}));
jest.mock("../../arkade/swap-storage", () => ({
  getSwapMetadata: jest.fn(),
}));

import { getBoltzSwapById } from "../../arkade/lightning";
import { getSwapMetadata } from "../../arkade/swap-storage";
import {
  buildSwapMetadataExport,
  collectSwapMetadataExport,
} from "../swapMetadataExport";

const getBoltzSwapByIdMock = getBoltzSwapById as jest.MockedFunction<
  typeof getBoltzSwapById
>;
const getSwapMetadataMock = getSwapMetadata as jest.MockedFunction<
  typeof getSwapMetadata
>;

function reverseActivity(): Activity {
  return {
    id: "swap:rev-1",
    kind: "lightning_swap",
    direction: "in",
    amountSats: 9500,
    timestamp: 1_700_000_000_000,
    title: "Lightning received",
    status: "confirmed",
    rail: "lightning",
    source: {
      type: "boltz_swap",
      provider: "boltz",
      swapId: "rev-1",
      swapType: "reverse",
    },
    metadata: { swapId: "rev-1", provider: "boltz" },
  };
}

function reverseSwap(): BoltzSwap {
  // Minimal shape; only the fields the export cares about matter here. The
  // `preimage` is the secret we must prove is carried through.
  return {
    id: "rev-1",
    type: "reverse",
    createdAt: 1_700_000_000,
    preimage: "deadbeefcafef00d",
    status: "invoice.settled",
    request: {
      claimPublicKey: "02aa",
      invoiceAmount: 10000,
      preimageHash: "ab",
    },
    response: { id: "rev-1", invoice: "lnbc1...", onchainAmount: 9500 },
  } as unknown as BoltzSwap;
}

function localMeta(): LocalSwapMetadata {
  return {
    swapId: "rev-1",
    walletId: "wallet-1",
    direction: "in",
    createdForFlow: "receive",
    invoiceAmountSats: 10000,
    arkadeAmountSats: 9500,
    walletTxId: "txid-1",
    paymentHash: "ab",
    linkSource: "receive_claim",
    backgroundNotified: true,
    restoredAt: null,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_500_000,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("buildSwapMetadataExport", () => {
  it("composes activity, swap, and local metadata with an ISO timestamp", () => {
    const activity = reverseActivity();
    const swap = reverseSwap();
    const meta = localMeta();

    const out = buildSwapMetadataExport({
      activity,
      swap,
      localMetadata: meta,
      now: 1_700_000_600_000,
    });

    expect(out.exportedAt).toBe(new Date(1_700_000_600_000).toISOString());
    expect(out.activity).toBe(activity);
    expect(out.swap).toBe(swap);
    expect(out.localMetadata).toBe(meta);
  });

  it("tolerates a missing swap / metadata (passes null through)", () => {
    const out = buildSwapMetadataExport({
      activity: reverseActivity(),
      swap: null,
      localMetadata: null,
      now: 0,
    });
    expect(out.swap).toBeNull();
    expect(out.localMetadata).toBeNull();
  });
});

describe("collectSwapMetadataExport", () => {
  it("returns null and skips the lookups for non-Boltz activities", async () => {
    const activity: Activity = {
      ...reverseActivity(),
      source: { type: "arkade_tx", walletTxId: "txid-1" },
    };

    const out = await collectSwapMetadataExport(activity);

    expect(out).toBeNull();
    expect(getBoltzSwapByIdMock).not.toHaveBeenCalled();
    expect(getSwapMetadataMock).not.toHaveBeenCalled();
  });

  it("fetches by swapId and bundles the full swap plus local metadata", async () => {
    const activity = reverseActivity();
    const swap = reverseSwap();
    const meta = localMeta();
    getBoltzSwapByIdMock.mockResolvedValue(swap);
    getSwapMetadataMock.mockResolvedValue(meta);

    const out = await collectSwapMetadataExport(activity);

    expect(getBoltzSwapByIdMock).toHaveBeenCalledWith("rev-1");
    expect(getSwapMetadataMock).toHaveBeenCalledWith("rev-1");
    expect(out).not.toBeNull();
    expect(out?.activity).toBe(activity);
    expect(out?.swap).toBe(swap);
    expect(out?.localMetadata).toBe(meta);
  });

  it("carries the preimage secret into the serialized JSON", async () => {
    getBoltzSwapByIdMock.mockResolvedValue(reverseSwap());
    getSwapMetadataMock.mockResolvedValue(localMeta());

    const out = await collectSwapMetadataExport(reverseActivity());
    const json = JSON.stringify(out);

    expect(json).toContain("deadbeefcafef00d");
    expect(JSON.parse(json).swap.preimage).toBe("deadbeefcafef00d");
  });

  it("still returns an object when the swap row is gone (secret absent)", async () => {
    getBoltzSwapByIdMock.mockResolvedValue(null);
    getSwapMetadataMock.mockResolvedValue(localMeta());

    const out = await collectSwapMetadataExport(reverseActivity());

    expect(out).not.toBeNull();
    expect(out?.swap).toBeNull();
    expect(out?.localMetadata).not.toBeNull();
  });
});
