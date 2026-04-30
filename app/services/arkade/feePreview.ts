import {
  Estimator,
  type ExtendedVirtualCoin,
  type FeeInfo,
  type NetworkName,
  networks,
} from "@arkade-os/sdk";
import { hex } from "@scure/base";
import { Address, OutScript } from "@scure/btc-signer";
import { recordError } from "../diagnostics/recorder";

export type OffboardFeeEstimate = {
  /** Total fee in satoshis (input fees + output fee). */
  feeSats: number;
  /** Eligible vtxos summed up after deducting per-input fees. */
  totalAvailableSats: number;
  /** Number of vtxos kept (input fee < value). */
  selectedVtxoCount: number;
};

export type OffboardFeeError =
  | "no_eligible_vtxos"
  | "amount_exceeds_balance"
  | "address_decode_failed"
  | "output_fee_exceeds_amount";

export class OffboardFeeEstimateError extends Error {
  readonly kind: OffboardFeeError;
  constructor(kind: OffboardFeeError, message: string) {
    super(message);
    this.kind = kind;
    this.name = "OffboardFeeEstimateError";
    recordError("send", `offboard_fee: ${kind}: ${message}`);
  }
}

const NETWORK_NAMES_TO_TRY: NetworkName[] = [
  "bitcoin",
  "regtest",
  "testnet",
  "signet",
  "mutinynet",
];

function decodeDestinationScript(
  destinationAddress: string,
  network: NetworkName | null,
): string {
  const ordered: NetworkName[] = network
    ? [network, ...NETWORK_NAMES_TO_TRY.filter((n) => n !== network)]
    : NETWORK_NAMES_TO_TRY;
  for (const name of ordered) {
    try {
      const addr = Address(networks[name]).decode(destinationAddress);
      return hex.encode(OutScript.encode(addr));
    } catch {
      // try next
    }
  }
  throw new OffboardFeeEstimateError(
    "address_decode_failed",
    `Failed to decode destination address: ${destinationAddress}`,
  );
}

/**
 * Mirrors {@link Ramps.offboard}'s fee logic without performing the settlement.
 * Inputs use ALL eligible vtxos (those whose own input fee < value); the SDK
 * does not coin-select for offboards, so neither do we. The estimate is
 * "finalised at settlement"; this is a preview only.
 */
export function estimateOffboardFee(input: {
  vtxos: ExtendedVirtualCoin[];
  amountSats: number;
  destinationAddress: string;
  feeInfo: { intentFee: FeeInfo["intentFee"] };
  network: NetworkName | null;
}): OffboardFeeEstimate {
  const { vtxos, amountSats, destinationAddress, feeInfo, network } = input;
  const estimator = new Estimator(feeInfo.intentFee ?? {});

  let inputFeesSats = 0;
  let totalAvailable = 0n;
  let selected = 0;
  for (const vtxo of vtxos) {
    const inputFee = estimator.evalOffchainInput({
      amount: BigInt(vtxo.value),
      type: vtxo.virtualStatus.state === "swept" ? "recoverable" : "vtxo",
      weight: 0,
      birth: vtxo.createdAt,
      expiry: vtxo.virtualStatus.batchExpiry
        ? new Date(vtxo.virtualStatus.batchExpiry)
        : undefined,
    });
    if (inputFee.satoshis >= vtxo.value) continue;
    inputFeesSats += inputFee.satoshis;
    totalAvailable += BigInt(vtxo.value) - BigInt(inputFee.satoshis);
    selected += 1;
  }

  if (selected === 0) {
    throw new OffboardFeeEstimateError(
      "no_eligible_vtxos",
      "No vtxos available to cover input fees",
    );
  }

  const amount = BigInt(amountSats);
  if (amount > totalAvailable) {
    throw new OffboardFeeEstimateError(
      "amount_exceeds_balance",
      "Amount is greater than available offchain balance after input fees",
    );
  }

  const destinationScript = decodeDestinationScript(
    destinationAddress,
    network,
  );
  const outputFee = estimator.evalOnchainOutput({
    amount,
    script: destinationScript,
  });
  if (BigInt(outputFee.satoshis) > amount) {
    throw new OffboardFeeEstimateError(
      "output_fee_exceeds_amount",
      "Output fee is greater than the requested amount",
    );
  }

  return {
    feeSats: inputFeesSats + outputFee.satoshis,
    totalAvailableSats: Number(totalAvailable),
    selectedVtxoCount: selected,
  };
}
