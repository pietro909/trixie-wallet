type MockProviderConfig = { apiUrl?: string; network: string };
type MockProviderInstance = { apiUrl: string; network: string };
type MockMonitorUpdate = (type: string, data?: unknown) => void;

const mockProviderInstances: MockProviderInstance[] = [];
const mockGetSwapStatus = jest.fn();
const mockMonitorSwap = jest.fn();
const mockRefundSubmarineSwap = jest.fn();
const mockRefundChainSwap = jest.fn();
const mockGetFees = jest.fn();

function mockDefaultApiUrlForNetwork(network: string): string {
  if (network === "bitcoin") return "https://api.boltz.exchange";
  if (network === "mutinynet") return "https://api.boltz.mutinynet.arkade.sh";
  if (network === "signet") return "https://boltz.signet.arkade.sh";
  return "http://localhost:9069";
}

jest.mock("@arkade-os/boltz-swap", () => {
  class SwapNotFoundError extends Error {
    errorData?: unknown;
    swapId: string;
    constructor(mockSwapId: string, errorData?: unknown) {
      super(`could not find swap with id: ${mockSwapId}`);
      this.name = "SwapNotFoundError";
      this.swapId = mockSwapId;
      this.errorData = errorData;
    }
  }

  class BoltzSwapProvider {
    private readonly config: MockProviderInstance;

    constructor(config: MockProviderConfig) {
      this.config = {
        network: config.network,
        apiUrl: config.apiUrl ?? mockDefaultApiUrlForNetwork(config.network),
      };
      mockProviderInstances.push(this.config);
    }

    getApiUrl(): string {
      return this.config.apiUrl;
    }

    getNetwork(): string {
      return this.config.network;
    }

    getSwapStatus(id: string): Promise<unknown> {
      return mockGetSwapStatus(id, this.config);
    }

    monitorSwap(id: string, update: MockMonitorUpdate): Promise<unknown> {
      return mockMonitorSwap(id, update, this.config);
    }

    refundSubmarineSwap(
      id: string,
      transaction: unknown,
      checkpoint: unknown,
    ): Promise<unknown> {
      return mockRefundSubmarineSwap(id, transaction, checkpoint, this.config);
    }

    refundChainSwap(
      id: string,
      transaction: unknown,
      checkpoint: unknown,
    ): Promise<unknown> {
      return mockRefundChainSwap(id, transaction, checkpoint, this.config);
    }

    getFees(): Promise<unknown> {
      return mockGetFees(this.config);
    }
  }

  return {
    BoltzSwapProvider,
    SwapNotFoundError,
  };
});

import { SwapNotFoundError } from "@arkade-os/boltz-swap";
import {
  boltzLegacyApiUrlsForNetwork,
  boltzPrimaryApiUrlForNetwork,
  isSwapNotFoundError,
  resolveBoltzSwapEndpoint,
  TrixieBoltzSwapProvider,
} from "../boltz-endpoints";

function resetProviderMocks() {
  mockProviderInstances.length = 0;
  mockGetSwapStatus.mockReset();
  mockMonitorSwap.mockReset();
  mockRefundSubmarineSwap.mockReset();
  mockRefundChainSwap.mockReset();
  mockGetFees.mockReset();
}

describe("boltz endpoint registry", () => {
  beforeEach(() => {
    resetProviderMocks();
  });

  it("uses the public Boltz API as bitcoin primary", () => {
    expect(boltzPrimaryApiUrlForNetwork("bitcoin")).toBe(
      "https://api.boltz.exchange",
    );
    expect(boltzLegacyApiUrlsForNetwork("bitcoin")).toEqual([
      "https://api.ark.boltz.exchange",
    ]);
    expect(boltzLegacyApiUrlsForNetwork("mutinynet")).toEqual([]);
  });

  it("tries legacy only after primary reports swap not found and returns full response", async () => {
    mockGetSwapStatus
      .mockRejectedValueOnce(new SwapNotFoundError("s1"))
      .mockResolvedValueOnce({
        status: "swap.expired",
        txid: "t1",
        transaction: { id: "tx1" },
      });

    await expect(
      resolveBoltzSwapEndpoint({ network: "bitcoin", swapId: "s1" }),
    ).resolves.toEqual({
      apiUrl: "https://api.ark.boltz.exchange",
      source: "legacy",
      status: "swap.expired",
      response: {
        status: "swap.expired",
        txid: "t1",
        transaction: { id: "tx1" },
      },
    });
    expect(mockProviderInstances.map((p) => p.apiUrl)).toEqual([
      "https://api.boltz.exchange",
      "https://api.ark.boltz.exchange",
    ]);
  });

  it("does not try legacy after a generic primary error", async () => {
    mockGetSwapStatus.mockRejectedValueOnce(new Error("server down"));

    await expect(
      resolveBoltzSwapEndpoint({ network: "bitcoin", swapId: "s1" }),
    ).rejects.toThrow("server down");
    expect(mockProviderInstances.map((p) => p.apiUrl)).toEqual([
      "https://api.boltz.exchange",
    ]);
  });

  it("returns not_found after all configured endpoints miss", async () => {
    mockGetSwapStatus
      .mockRejectedValueOnce(new SwapNotFoundError("s1"))
      .mockRejectedValueOnce(new SwapNotFoundError("s1"));

    await expect(
      resolveBoltzSwapEndpoint({ network: "bitcoin", swapId: "s1" }),
    ).resolves.toEqual({
      kind: "not_found",
      swapId: "s1",
      checkedUrls: [
        "https://api.boltz.exchange",
        "https://api.ark.boltz.exchange",
      ],
    });
  });

  it("detects SDK and API-shaped swap not found errors", () => {
    expect(isSwapNotFoundError(new SwapNotFoundError("s1"))).toBe(true);
    expect(
      isSwapNotFoundError({
        errorData: { error: "could not find swap with id: s1" },
      }),
    ).toBe(true);
    expect(
      isSwapNotFoundError(new Error("could not find swap with id: s1")),
    ).toBe(true);
    expect(isSwapNotFoundError(new Error("rate limited"))).toBe(false);
  });
});

describe("TrixieBoltzSwapProvider", () => {
  let provider: TrixieBoltzSwapProvider;

  beforeEach(() => {
    resetProviderMocks();
    provider = new TrixieBoltzSwapProvider({ network: "bitcoin" });
    mockProviderInstances.length = 0;
  });

  it("returns the full primary status response without a second provider call", async () => {
    const response = {
      status: "swap.created",
      transaction: { id: "tx1", hex: "00" },
      zeroConfRejected: false,
    };
    mockGetSwapStatus.mockResolvedValueOnce(response);

    await expect(provider.getSwapStatus("s1")).resolves.toBe(response);
    expect(mockGetSwapStatus).toHaveBeenCalledTimes(1);
    expect(mockGetSwapStatus.mock.calls[0][1]).toMatchObject({
      apiUrl: "https://api.boltz.exchange",
    });
  });

  it("returns the full legacy status response after primary not found", async () => {
    const response = {
      status: "transaction.confirmed",
      transaction: { id: "tx-legacy", hex: "01" },
    };
    mockGetSwapStatus
      .mockRejectedValueOnce(new SwapNotFoundError("s1"))
      .mockResolvedValueOnce(response);

    await expect(provider.getSwapStatus("s1")).resolves.toBe(response);
    expect(mockGetSwapStatus).toHaveBeenCalledTimes(2);
    expect(mockGetSwapStatus.mock.calls[1][1]).toMatchObject({
      apiUrl: "https://api.ark.boltz.exchange",
    });
  });

  it("does not try legacy after a generic primary status error", async () => {
    mockGetSwapStatus.mockRejectedValueOnce(new Error("rate limited"));

    await expect(provider.getSwapStatus("s1")).rejects.toThrow("rate limited");
    expect(mockGetSwapStatus).toHaveBeenCalledTimes(1);
  });

  it("delegates monitorSwap to the primary super method without recursion", async () => {
    const update = jest.fn();
    mockGetSwapStatus.mockResolvedValueOnce({ status: "swap.created" });
    mockMonitorSwap.mockResolvedValueOnce(undefined);

    await provider.monitorSwap("s1", update);

    expect(mockGetSwapStatus).toHaveBeenCalledTimes(1);
    expect(mockMonitorSwap).toHaveBeenCalledTimes(1);
    expect(mockMonitorSwap.mock.calls[0][2]).toMatchObject({
      apiUrl: "https://api.boltz.exchange",
    });
  });

  it("delegates refundChainSwap to a legacy-bound raw provider", async () => {
    const transaction = {} as Parameters<
      TrixieBoltzSwapProvider["refundChainSwap"]
    >[1];
    const checkpoint = {} as Parameters<
      TrixieBoltzSwapProvider["refundChainSwap"]
    >[2];
    const result = { transaction, checkpoint };
    mockGetSwapStatus
      .mockRejectedValueOnce(new SwapNotFoundError("s1"))
      .mockResolvedValueOnce({ status: "swap.expired" });
    mockRefundChainSwap.mockResolvedValueOnce(result);

    await expect(
      provider.refundChainSwap("s1", transaction, checkpoint),
    ).resolves.toBe(result);

    expect(mockRefundChainSwap).toHaveBeenCalledWith(
      "s1",
      transaction,
      checkpoint,
      expect.objectContaining({ apiUrl: "https://api.ark.boltz.exchange" }),
    );
  });

  it("delegates refundSubmarineSwap to a legacy-bound raw provider", async () => {
    const transaction = {} as Parameters<
      TrixieBoltzSwapProvider["refundSubmarineSwap"]
    >[1];
    const checkpoint = {} as Parameters<
      TrixieBoltzSwapProvider["refundSubmarineSwap"]
    >[2];
    const result = { transaction, checkpoint };
    mockGetSwapStatus
      .mockRejectedValueOnce(new SwapNotFoundError("s1"))
      .mockResolvedValueOnce({ status: "swap.expired" });
    mockRefundSubmarineSwap.mockResolvedValueOnce(result);

    await expect(
      provider.refundSubmarineSwap("s1", transaction, checkpoint),
    ).resolves.toBe(result);

    expect(mockRefundSubmarineSwap).toHaveBeenCalledWith(
      "s1",
      transaction,
      checkpoint,
      expect.objectContaining({ apiUrl: "https://api.ark.boltz.exchange" }),
    );
  });

  it("keeps inherited fee methods primary-only", async () => {
    const fees = { submarine: {}, reverse: {} };
    mockGetFees.mockResolvedValueOnce(fees);

    await expect(provider.getFees()).resolves.toBe(fees);

    expect(mockGetFees).toHaveBeenCalledWith(
      expect.objectContaining({ apiUrl: "https://api.boltz.exchange" }),
    );
    expect(mockGetSwapStatus).not.toHaveBeenCalled();
  });
});
