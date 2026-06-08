import type { BoltzChainSwap } from "@arkade-os/boltz-swap";
import { mergeChainSwap } from "../chain-swap-merge";

type ChainSwapDetails = BoltzChainSwap["response"]["lockupDetails"];
type ChainSwapResponseWithOptionalClaim = Omit<
  BoltzChainSwap["response"],
  "claimDetails"
> & {
  claimDetails?: ChainSwapDetails;
};
type ChainSwapWithOptionalClaim = Omit<BoltzChainSwap, "response"> & {
  response: ChainSwapResponseWithOptionalClaim;
};

const primaryTimeouts = {
  refund: 10,
  unilateralClaim: 20,
  unilateralRefund: 30,
  unilateralRefundWithoutReceiver: 40,
};

const incomingTimeouts = {
  refund: 11,
  unilateralClaim: 21,
  unilateralRefund: 31,
  unilateralRefundWithoutReceiver: 41,
};

function details(label: string, timeouts = primaryTimeouts): ChainSwapDetails {
  return {
    amount: 1000,
    lockupAddress: `${label}-address`,
    timeoutBlockHeight: 144,
    serverPublicKey: `${label}-server-public-key`,
    timeouts,
    bip21: `${label}-bip21`,
  } as ChainSwapDetails;
}

function chainSwap(
  args: {
    response?: ChainSwapResponseWithOptionalClaim;
    preimage?: string;
    ephemeralKey?: string;
    toAddress?: string;
    request?: Partial<BoltzChainSwap["request"]>;
  } = {},
): BoltzChainSwap {
  return {
    id: "chain-1",
    type: "chain",
    preimage: args.preimage ?? "primary-preimage",
    createdAt: 1_700_000_000,
    ephemeralKey: args.ephemeralKey ?? "primary-ephemeral-key",
    feeSatsPerByte: 1,
    status: "swap.expired",
    request: {
      from: "ARK",
      to: "BTC",
      preimageHash: "primary-preimage-hash",
      claimPublicKey: "primary-claim-public-key",
      refundPublicKey: "primary-refund-public-key",
      feeSatsPerByte: 1,
      userLockAmount: 1000,
      ...args.request,
    },
    response: args.response ?? {
      id: "chain-1",
      claimDetails: details("primary-claim"),
      lockupDetails: details("primary-lockup"),
    },
    amount: 1000,
    toAddress: args.toAddress,
  } as BoltzChainSwap;
}

describe("mergeChainSwap", () => {
  it("keeps incoming lockup detail fields that primary lacks", () => {
    const primary = chainSwap({
      response: {
        id: "chain-1",
        lockupDetails: { amount: 1000 } as ChainSwapDetails,
      },
    });
    const incoming = chainSwap({
      response: {
        id: "chain-1",
        lockupDetails: details("incoming-lockup", incomingTimeouts),
      },
    });

    const merged = mergeChainSwap(
      primary,
      incoming,
    ) as ChainSwapWithOptionalClaim;

    expect(merged.response.lockupDetails).toMatchObject({
      amount: 1000,
      lockupAddress: "incoming-lockup-address",
      timeoutBlockHeight: 144,
      serverPublicKey: "incoming-lockup-server-public-key",
      timeouts: incomingTimeouts,
      bip21: "incoming-lockup-bip21",
    });
  });

  it("keeps incoming claim details when primary has none", () => {
    const primary = chainSwap({
      response: {
        id: "chain-1",
        lockupDetails: details("primary-lockup"),
      },
    });
    const incoming = chainSwap({
      response: {
        id: "chain-1",
        lockupDetails: details("incoming-lockup"),
        claimDetails: details("incoming-claim", incomingTimeouts),
      },
    });

    const merged = mergeChainSwap(
      primary,
      incoming,
    ) as ChainSwapWithOptionalClaim;

    expect(merged.response.claimDetails).toMatchObject({
      amount: 1000,
      lockupAddress: "incoming-claim-address",
      timeoutBlockHeight: 144,
      serverPublicKey: "incoming-claim-server-public-key",
      timeouts: incomingTimeouts,
      bip21: "incoming-claim-bip21",
    });
  });

  it("fills nullish primary detail fields from incoming details", () => {
    const primary = chainSwap({
      response: {
        id: "chain-1",
        lockupDetails: details("primary-lockup"),
        claimDetails: {
          amount: 1000,
          lockupAddress: undefined,
          serverPublicKey: "primary-claim-server-public-key",
          timeouts: undefined,
        } as unknown as ChainSwapDetails,
      },
    });
    const incoming = chainSwap({
      response: {
        id: "chain-1",
        lockupDetails: details("incoming-lockup"),
        claimDetails: details("incoming-claim", incomingTimeouts),
      },
    });

    const merged = mergeChainSwap(
      primary,
      incoming,
    ) as ChainSwapWithOptionalClaim;

    expect(merged.response.claimDetails).toMatchObject({
      amount: 1000,
      lockupAddress: "incoming-claim-address",
      serverPublicKey: "primary-claim-server-public-key",
      timeouts: incomingTimeouts,
    });
  });

  it("keeps primary detail fields when both endpoints provide them", () => {
    const primary = chainSwap({
      response: {
        id: "chain-1",
        lockupDetails: details("primary-lockup", primaryTimeouts),
        claimDetails: details("primary-claim", primaryTimeouts),
      },
    });
    const incoming = chainSwap({
      response: {
        id: "chain-1",
        lockupDetails: details("incoming-lockup", incomingTimeouts),
        claimDetails: details("incoming-claim", incomingTimeouts),
      },
    });

    const merged = mergeChainSwap(
      primary,
      incoming,
    ) as ChainSwapWithOptionalClaim;

    expect(merged.response.lockupDetails).toMatchObject({
      lockupAddress: "primary-lockup-address",
      serverPublicKey: "primary-lockup-server-public-key",
      timeouts: primaryTimeouts,
    });
    expect(merged.response.claimDetails).toMatchObject({
      lockupAddress: "primary-claim-address",
      serverPublicKey: "primary-claim-server-public-key",
      timeouts: primaryTimeouts,
    });
  });
});
