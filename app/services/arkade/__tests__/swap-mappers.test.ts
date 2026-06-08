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

import type {
  BoltzReverseSwap,
  BoltzSubmarineSwap,
} from "@arkade-os/boltz-swap";
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

function submarineSwap(
  overrides: Partial<BoltzSubmarineSwap> = {},
): BoltzSubmarineSwap {
  return {
    id: "lnurl-send-swap-1",
    type: "submarine",
    status: "invoice.pending",
    createdAt: T0_SECONDS,
    refunded: false,
    request: {
      invoice: "lnbc1000n1...",
    },
    response: {
      expectedAmount: 1190,
    },
    ...overrides,
  } as BoltzSubmarineSwap;
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

function submarineMeta(
  overrides: Partial<LocalSwapMetadata> = {},
): LocalSwapMetadata {
  return {
    swapId: "lnurl-send-swap-1",
    walletId: "wallet-1",
    direction: "out",
    createdForFlow: "lnurl_send",
    invoiceAmountSats: 1000,
    arkadeAmountSats: 1190,
    walletTxId: null,
    paymentHash: "11".repeat(32),
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

function arkadeSend(overrides: Partial<Activity> = {}): Activity {
  return {
    id: "arkade:exit:commit-1",
    kind: "payment",
    direction: "out",
    amountSats: 1190,
    timestamp: T0_MS + 1000,
    title: "Arkade sent",
    status: "confirmed",
    rail: "arkade",
    source: { type: "arkade_tx", walletTxId: "commit-1" },
    metadata: { commitmentTxid: "commit-1" },
    ...overrides,
  };
}

describe("mergeActivities", () => {
  it("confirms an unlinked LNURL receive when its Arkade counterpart is confirmed", () => {
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
      status: "confirmed",
    });
    expect(activities[0].metadata).toMatchObject({
      createdForFlow: "lnurl_receive",
      invoiceAmountSats: 1197,
      arkadeAmountSats: 1190,
      lightningFeeSats: 7,
      walletTxId: "commit-1",
    });
  });

  it("confirms a linked LNURL receive even when Boltz status is still pending", () => {
    const activities = mergeActivities({
      arkadeActivities: [arkadeReceive()],
      swaps: [reverseSwap()],
      metadata: [swapMeta({ walletTxId: "commit-1" })],
      network: "bitcoin",
    });

    expect(activities).toHaveLength(1);
    expect(activities[0]).toMatchObject({
      id: "commit-1",
      title: "LNURL received",
      direction: "in",
      amountSats: 1190,
      status: "confirmed",
    });
    expect(activities[0].metadata).toMatchObject({
      walletTxId: "commit-1",
    });
  });

  it("keeps a submarine LNURL send pending after only the Arkade lockup matches", () => {
    const activities = mergeActivities({
      arkadeActivities: [arkadeSend()],
      swaps: [submarineSwap()],
      metadata: [submarineMeta()],
      network: "bitcoin",
    });

    expect(activities).toHaveLength(1);
    expect(activities[0]).toMatchObject({
      id: "swap:lnurl-send-swap-1",
      title: "LNURL payment",
      direction: "out",
      amountSats: 1190,
      status: "pending",
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
