jest.mock("@arkade-os/boltz-swap", () => ({
  isChainFinalStatus: jest.fn((status: string) =>
    ["transaction.claimed", "transaction.refunded"].includes(status),
  ),
  isChainSwapRefundable: jest.fn(
    (swap: { status: string; request?: { from?: string; to?: string } }) =>
      swap.status === "swap.expired" &&
      swap.request?.from === "ARK" &&
      swap.request?.to === "BTC",
  ),
  isReverseFinalStatus: jest.fn(() => true),
  isSubmarineFinalStatus: jest.fn(() => true),
}));

jest.mock("../lightning", () => ({
  canAttemptArkChainRefund: jest.fn(),
  getLightning: jest.fn(),
  getLightningActivitySources: jest.fn(),
  inspectArkChainRefundVhtlc: jest.fn(),
  isLightningSupportedForNetwork: jest.fn(() => true),
  refreshSwapsStatus: jest.fn(),
  resolveChainSwapRecoveryEndpoint: jest.fn(),
}));

import type { BoltzChainSwap } from "@arkade-os/boltz-swap";
import {
  canAttemptArkChainRefund,
  inspectArkChainRefundVhtlc,
  resolveChainSwapRecoveryEndpoint,
} from "../lightning";
import { classifyRecovery, enrichChainRecoveryItems } from "../recovery";

const mockedCanAttempt = canAttemptArkChainRefund as jest.Mock;
const mockedEndpoint = resolveChainSwapRecoveryEndpoint as jest.Mock;
const mockedVhtlc = inspectArkChainRefundVhtlc as jest.Mock;

function chainSwap(overrides: Record<string, unknown> = {}): BoltzChainSwap {
  return {
    id: "chain-1",
    type: "chain",
    status: "swap.expired",
    createdAt: 1_700_000_000,
    amount: 1000,
    request: {
      from: "ARK",
      to: "BTC",
      preimageHash: "00".repeat(32),
      userLockAmount: 1000,
    },
    response: {
      lockupDetails: {
        lockupAddress: "ark1qvhtlc",
        serverPublicKey: `02${"11".repeat(32)}`,
        timeouts: {
          refund: 1,
          unilateralClaim: 2,
          unilateralRefund: 3,
          unilateralRefundWithoutReceiver: 4,
        },
      },
    },
    ...overrides,
  } as BoltzChainSwap;
}

function baseScan(swaps = [chainSwap()]) {
  return classifyRecovery({
    walletId: "w1",
    swaps,
    metadata: [],
    submarineRecovery: [],
    pendingTxs: [],
    activities: [],
  });
}

describe("chain swap recovery classification", () => {
  beforeEach(() => {
    mockedCanAttempt.mockReset();
    mockedEndpoint.mockReset();
    mockedVhtlc.mockReset();
  });

  it("keeps the pure classifier status-based and actionable", () => {
    const scan = baseScan();
    expect(scan.items).toHaveLength(1);
    expect(scan.items[0]).toMatchObject({
      type: "chain",
      severity: "actionable",
      actions: ["refund_chain_ark", "support_bundle"],
    });
  });

  it("removes the refund action when local material is incomplete", async () => {
    mockedCanAttempt.mockReturnValue(false);

    const scan = await enrichChainRecoveryItems(baseScan(), [chainSwap()]);

    expect(scan.items[0]).toMatchObject({
      severity: "attention",
      actions: ["support_bundle"],
      materialState: "incomplete",
      detail: "Swap chain-1 expired, but local refund details are incomplete",
    });
    expect(mockedEndpoint).not.toHaveBeenCalled();
  });

  it("removes the refund action when no configured endpoint knows the swap", async () => {
    mockedCanAttempt.mockReturnValue(true);
    mockedEndpoint.mockResolvedValue({ kind: "not_found" });

    const scan = await enrichChainRecoveryItems(baseScan(), [chainSwap()]);

    expect(scan.items[0]).toMatchObject({
      severity: "attention",
      actions: ["support_bundle"],
      endpointState: "not_found",
      materialState: "complete",
      detail: "Swap chain-1 is not known by the configured Boltz endpoints",
    });
    expect(mockedVhtlc).not.toHaveBeenCalled();
  });

  it("removes the refund action when the local Arkade VHTLC is missing", async () => {
    mockedCanAttempt.mockReturnValue(true);
    mockedEndpoint.mockResolvedValue({
      kind: "resolved",
      source: "legacy",
      apiUrl: "https://api.ark.boltz.exchange",
    });
    mockedVhtlc.mockResolvedValue({ kind: "not_found" });

    const scan = await enrichChainRecoveryItems(baseScan(), [chainSwap()]);

    expect(scan.items[0]).toMatchObject({
      severity: "attention",
      actions: ["support_bundle"],
      endpointSource: "legacy",
      endpointState: "resolved",
      materialState: "complete",
      vhtlcState: "not_found",
      detail: "Swap chain-1 expired, but no refundable Arkade VHTLC was found",
    });
  });

  it("keeps the refund action when legacy resolves and local VHTLC is unspent", async () => {
    mockedCanAttempt.mockReturnValue(true);
    mockedEndpoint.mockResolvedValue({
      kind: "resolved",
      source: "legacy",
      apiUrl: "https://api.ark.boltz.exchange",
    });
    mockedVhtlc.mockResolvedValue({
      kind: "unspent",
      totalCount: 1,
      unspentCount: 1,
    });

    const scan = await enrichChainRecoveryItems(baseScan(), [chainSwap()]);

    expect(scan.items[0]).toMatchObject({
      severity: "actionable",
      actions: ["refund_chain_ark", "support_bundle"],
      endpointSource: "legacy",
      endpointState: "resolved",
      materialState: "complete",
      vhtlcState: "unspent",
      detail: "Swap chain-1 - legacy endpoint",
    });
  });
});
