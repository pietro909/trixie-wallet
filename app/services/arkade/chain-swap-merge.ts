import type { BoltzChainSwap } from "@arkade-os/boltz-swap";

type ChainSwapDetails = BoltzChainSwap["response"]["lockupDetails"];
type ChainSwapResponseWithOptionalClaim = Omit<
  BoltzChainSwap["response"],
  "claimDetails"
> & {
  claimDetails?: ChainSwapDetails;
};
type ChainSwapWithLocalFields = Omit<BoltzChainSwap, "response"> & {
  ephemeralKey?: string;
  toAddress?: string;
  response: ChainSwapResponseWithOptionalClaim;
};

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.length > 0) return value;
  }
  return undefined;
}

function mergeChainSwapDetails(
  primary: ChainSwapDetails | undefined,
  incoming: ChainSwapDetails | undefined,
): ChainSwapDetails {
  const merged = {
    ...(incoming ?? {}),
    ...(primary ?? {}),
  } as ChainSwapDetails;

  if (incoming) {
    const mergedRecord = merged as Record<string, unknown>;
    const incomingRecord = incoming as Record<string, unknown>;
    for (const key of Object.keys(incomingRecord)) {
      if (mergedRecord[key] == null && incomingRecord[key] != null) {
        mergedRecord[key] = incomingRecord[key];
      }
    }
  }

  return merged;
}

export function mergeChainSwap(
  primary: BoltzChainSwap,
  incoming: BoltzChainSwap,
): BoltzChainSwap {
  const primaryLocal = primary as ChainSwapWithLocalFields;
  const incomingLocal = incoming as ChainSwapWithLocalFields;
  const primaryResponse = primaryLocal.response;
  const incomingResponse = incomingLocal.response;
  const merged: ChainSwapWithLocalFields = {
    ...primaryLocal,
    request: { ...primaryLocal.request },
    response: {
      ...primaryResponse,
      lockupDetails: mergeChainSwapDetails(
        primaryResponse.lockupDetails,
        incomingResponse.lockupDetails,
      ),
    },
  };

  if (primaryResponse.claimDetails || incomingResponse.claimDetails) {
    merged.response.claimDetails = mergeChainSwapDetails(
      primaryResponse.claimDetails,
      incomingResponse.claimDetails,
    );
  }

  merged.preimage =
    firstString(primaryLocal.preimage, incomingLocal.preimage) ?? "";
  merged.ephemeralKey =
    firstString(primaryLocal.ephemeralKey, incomingLocal.ephemeralKey) ?? "";
  const toAddress = firstString(
    primaryLocal.toAddress,
    incomingLocal.toAddress,
  );
  if (toAddress) merged.toAddress = toAddress;

  const preimageHash = firstString(
    primaryLocal.request.preimageHash,
    incomingLocal.request.preimageHash,
  );
  if (preimageHash) merged.request.preimageHash = preimageHash;
  merged.request.claimPublicKey =
    firstString(
      primaryLocal.request.claimPublicKey,
      incomingLocal.request.claimPublicKey,
    ) ?? "";
  merged.request.refundPublicKey =
    firstString(
      primaryLocal.request.refundPublicKey,
      incomingLocal.request.refundPublicKey,
    ) ?? "";
  return merged as BoltzChainSwap;
}
