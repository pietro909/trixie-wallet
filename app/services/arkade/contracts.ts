import type { Contract, ContractState, Wallet } from "@arkade-os/sdk";
import { ArkadeError, toArkadeError } from "./errors";

/**
 * Public-fields-only projection of a wallet-owned contract. Excludes `params`
 * so sensitive material (pubkeys, CSV timelocks) cannot leak into screens
 * unless an `AuthGate`-wrapped {@link loadContractParams} call is made.
 *
 * Structurally close to `OwnedAddress` in `./addresses.ts` plus `metadata`;
 * the two surfaces are intentionally not coupled — `loadWalletAddresses`
 * still backs the VTXO cross-referencing on `VtxoListScreen`.
 */
export type ContractSummary = {
  type: string;
  state: ContractState;
  address: string;
  script: string;
  label?: string;
  createdAt: number;
  metadata?: Record<string, unknown>;
};

/** Cross-boundary shape consumed by the backup serializer. */
export type ContractLabelBackup = { script: string; label: string };

function toSummary(contract: Contract): ContractSummary {
  const row: ContractSummary = {
    type: contract.type,
    state: contract.state,
    address: contract.address,
    script: contract.script,
    createdAt: contract.createdAt,
  };
  if (contract.label) row.label = contract.label;
  if (contract.metadata && Object.keys(contract.metadata).length > 0) {
    row.metadata = contract.metadata;
  }
  return row;
}

/**
 * Sort: `default` first (the wallet's primary contract); remaining sorted by
 * `createdAt` descending so newer contracts surface above older ones.
 */
function sortSummaries(rows: ContractSummary[]): ContractSummary[] {
  return [...rows].sort((a, b) => {
    if (a.type === "default" && b.type !== "default") return -1;
    if (b.type === "default" && a.type !== "default") return 1;
    return b.createdAt - a.createdAt;
  });
}

/**
 * Fetch every wallet-owned contract from the SDK `ContractManager`, project to
 * the public-fields-only {@link ContractSummary}, and drop VHTLCs (they have
 * no first-class entry point yet — boltz-swap manages them internally).
 *
 * @throws ArkadeError with kind `contracts_fetch_failed` on SDK errors.
 */
export async function loadContractSummaries(
  wallet: Wallet,
): Promise<ContractSummary[]> {
  let contracts: Contract[];
  try {
    const cm = await wallet.getContractManager();
    contracts = await cm.getContracts();
  } catch (e) {
    throw toArkadeError(
      "contracts_fetch_failed",
      "Failed to load contracts",
      e,
    );
  }
  const visible = contracts.filter((c) => c.type !== "vhtlc");
  return sortSummaries(visible.map(toSummary));
}

/**
 * Fetch the `params` map for a single contract identified by `script`.
 *
 * **Sensitive.** The returned object can include `pubKey`, `serverPubKey`,
 * `delegatePubKey`, `csvTimelock`, etc. Callers MUST wrap this in an
 * `AuthGate.onSuccess` handler and clear the result on screen blur — never
 * cache or memoize it.
 *
 * @throws ArkadeError with kind `contracts_params_not_found` when no contract
 *   matches the given script.
 * @throws ArkadeError with kind `contracts_fetch_failed` on SDK errors.
 */
export async function loadContractParams(
  wallet: Wallet,
  script: string,
): Promise<Record<string, string>> {
  let matches: Contract[];
  try {
    const cm = await wallet.getContractManager();
    matches = await cm.getContracts({ script });
  } catch (e) {
    throw toArkadeError(
      "contracts_fetch_failed",
      "Failed to load contract params",
      e,
    );
  }
  const contract = matches[0];
  if (!contract) {
    throw new ArkadeError(
      "contracts_params_not_found",
      "Contract not found for the given script",
    );
  }
  return contract.params;
}

/**
 * Set or clear a contract's user label. An empty (or whitespace-only) label
 * collapses to `undefined`, which removes the label from the contract.
 *
 * @throws ArkadeError with kind `contracts_update_failed` on SDK errors.
 */
export async function updateContractLabel(
  wallet: Wallet,
  script: string,
  label: string,
): Promise<void> {
  const trimmed = label.trim();
  try {
    const cm = await wallet.getContractManager();
    await cm.updateContract(script, { label: trimmed || undefined });
  } catch (e) {
    throw toArkadeError(
      "contracts_update_failed",
      "Failed to update contract label",
      e,
    );
  }
}

/**
 * Snapshot every labeled, non-VHTLC contract for the encrypted backup
 * envelope. Returns `{ script, label }` pairs only; params and metadata stay
 * with the SDK.
 *
 * @throws ArkadeError with kind `contracts_fetch_failed` on SDK errors.
 *   The export path relies on this to fail loud rather than ship a backup
 *   with `contractLabels: []` and a misleadingly-clean dirty flag.
 */
export async function loadContractLabelsForBackup(
  wallet: Wallet,
): Promise<ContractLabelBackup[]> {
  let contracts: Contract[];
  try {
    const cm = await wallet.getContractManager();
    contracts = await cm.getContracts();
  } catch (e) {
    throw toArkadeError(
      "contracts_fetch_failed",
      "Failed to load contract labels",
      e,
    );
  }
  const out: ContractLabelBackup[] = [];
  for (const c of contracts) {
    if (c.type === "vhtlc") continue;
    const label = typeof c.label === "string" ? c.label.trim() : "";
    if (!label) continue;
    out.push({ script: c.script, label });
  }
  return out;
}
