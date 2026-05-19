import type { Contract, ContractState, Wallet } from "@arkade-os/sdk";
import { toArkadeError } from "./errors";

/**
 * Public-fields-only projection of a wallet-owned contract for the Addresses
 * UI. Excludes `params` (may carry sensitive material such as VHTLC preimage
 * hashes once VHTLCs are first-class) and any internal repository fields.
 */
export type OwnedAddress = {
  type: string;
  state: ContractState;
  address: string;
  script: string;
  label?: string;
  createdAt: number;
};

function toOwnedAddress(contract: Contract): OwnedAddress {
  const row: OwnedAddress = {
    type: contract.type,
    state: contract.state,
    address: contract.address,
    script: contract.script,
    createdAt: contract.createdAt,
  };
  if (contract.label) row.label = contract.label;
  return row;
}

/**
 * Sort: the `default` contract is always first (it's the wallet's primary
 * receive address); remaining contracts are sorted by `createdAt` desc so
 * newer ones surface above older ones.
 */
function sortOwnedAddresses(rows: OwnedAddress[]): OwnedAddress[] {
  return [...rows].sort((a, b) => {
    if (a.type === "default" && b.type !== "default") return -1;
    if (b.type === "default" && a.type !== "default") return 1;
    return b.createdAt - a.createdAt;
  });
}

/**
 * Fetch every contract registered against the wallet via the SDK
 * `ContractManager` and project each one to a public-fields-only row. The
 * wallet auto-registers a `default` contract and, when delegated renewal is
 * on, a `delegate` contract; external contracts (e.g. future VHTLCs once
 * boltz-swap moves to ContractManager) will appear here too.
 */
export async function loadOwnedAddresses(
  wallet: Wallet,
): Promise<OwnedAddress[]> {
  let contracts: Contract[];
  try {
    const cm = await wallet.getContractManager();
    contracts = await cm.getContracts();
  } catch (e) {
    throw toArkadeError(
      "addresses_fetch_failed",
      "Failed to load addresses",
      e,
    );
  }
  return sortOwnedAddresses(contracts.map(toOwnedAddress));
}
