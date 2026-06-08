jest.mock("@arkade-os/boltz-swap", () => ({
  isChainFailedStatus: jest.fn(
    (status: string) => status === "transaction.failed",
  ),
  isChainRefundableStatus: jest.fn(
    (status: string) => status === "swap.expired",
  ),
  isChainSuccessStatus: jest.fn(
    (status: string) => status === "transaction.claimed",
  ),
  isReverseClaimableStatus: jest.fn((status: string) =>
    ["transaction.mempool", "transaction.confirmed"].includes(status),
  ),
  isReverseFailedStatus: jest.fn((status: string) =>
    ["invoice.expired", "transaction.failed", "transaction.refunded"].includes(
      status,
    ),
  ),
  isReverseSuccessStatus: jest.fn(
    (status: string) => status === "invoice.settled",
  ),
  isSubmarineFailedStatus: jest.fn((status: string) =>
    ["invoice.expired", "invoice.failedToPay", "transaction.failed"].includes(
      status,
    ),
  ),
  isSubmarineSuccessStatus: jest.fn(
    (status: string) => status === "transaction.claimed",
  ),
}));

jest.mock("../lightning", () => ({
  boltzApiUrlForNetwork: jest.fn(() => "https://boltz.example"),
}));

import type { BoltzReverseSwap } from "@arkade-os/boltz-swap";
import type { Activity } from "../../../store/types";
import { mergeActivities } from "../swap-mappers";
import type { LocalSwapMetadata } from "../swap-storage";

const T0_SECONDS = 1_700_000_000;
const T0_MS = T0_SECONDS * 1000;

function reverseSwap(
  overrides: Partial<BoltzReverseSwap> = {},
): BoltzReverseSwap {
  return {
    id: "lnurl-swap-1",
    type: "reverse",
    status: "transaction.mempool",
    createdAt: T0_SECONDS,
    request: {
      invoiceAmount: 1197,
      preimageHash: "00".repeat(32),
    },
    response: {
      invoice: "lnbc1197n1...",
      onchainAmount: 1190,
    },
    ...overrides,
  } as BoltzReverseSwap;
}

function swapMeta(
  overrides: Partial<LocalSwapMetadata> = {},
): LocalSwapMetadata {
  return {
    swapId: "lnurl-swap-1",
    walletId: "wallet-1",
    direction: "in",
    createdForFlow: "lnurl_receive",
    invoiceAmountSats: 1197,
    arkadeAmountSats: 1190,
    walletTxId: null,
    paymentHash: "00".repeat(32),
    linkSource: null,
    backgroundNotified: false,
    restoredAt: null,
    createdAt: T0_MS,
    updatedAt: T0_MS,
    ...overrides,
  };
}

function arkadeReceive(overrides: Partial<Activity> = {}): Activity {
  return {
    id: "arkade:batch:commit-1",
    kind: "payment",
    direction: "in",
    amountSats: 1190,
    timestamp: T0_MS + 1000,
    title: "Arkade received",
    status: "confirmed",
    rail: "arkade",
    source: { type: "arkade_tx", walletTxId: "commit-1" },
    metadata: { commitmentTxid: "commit-1" },
    ...overrides,
  };
}

describe("mergeActivities", () => {
  it("suppresses an unlinked LNURL receive counterpart using the credited Arkade amount", () => {
    const activities = mergeActivities({
      arkadeActivities: [arkadeReceive()],
      swaps: [reverseSwap()],
      metadata: [swapMeta()],
      network: "bitcoin",
    });

    expect(activities).toHaveLength(1);
    expect(activities[0]).toMatchObject({
      id: "swap:lnurl-swap-1",
      title: "LNURL received",
      direction: "in",
      amountSats: 1190,
      status: "pending",
    });
    expect(activities[0].metadata).toMatchObject({
      createdForFlow: "lnurl_receive",
      invoiceAmountSats: 1197,
      arkadeAmountSats: 1190,
      lightningFeeSats: 7,
    });
  });

  it("keeps ambiguous unlinked Arkade matches visible", () => {
    const activities = mergeActivities({
      arkadeActivities: [
        arkadeReceive({ id: "arkade:batch:commit-1" }),
        arkadeReceive({
          id: "arkade:batch:commit-2",
          source: { type: "arkade_tx", walletTxId: "commit-2" },
          metadata: { commitmentTxid: "commit-2" },
        }),
      ],
      swaps: [reverseSwap()],
      metadata: [swapMeta()],
      network: "bitcoin",
    });

    expect(activities.map((a) => a.id).sort()).toStrictEqual([
      "arkade:batch:commit-1",
      "arkade:batch:commit-2",
      "swap:lnurl-swap-1",
    ]);
  });
});
