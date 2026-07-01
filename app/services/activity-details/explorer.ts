/**
 * Pure explorer-URL helper. Given a network, an id, and the kind of id, return
 * a human-facing explorer URL or null. Callers must render the id as plain
 * text when null is returned rather than synthesising a guess.
 */

export type ExplorerIdKind =
  | "ark_tx"
  | "commitment_tx"
  | "boarding_tx"
  | "bitcoin_tx"
  | "arkade_address"
  | "bitcoin_address";

const ARKADE_EXPLORERS: Record<string, string> = {
  bitcoin: "https://arkade.space",
  mutinynet: "https://explorer.mutinynet.arkade.sh",
};

const BITCOIN_EXPLORERS: Record<string, string> = {
  bitcoin: "https://mempool.space",
  signet: "https://mempool.space/signet",
  testnet: "https://mempool.space/testnet",
  mutinynet: "https://mutinynet.com",
};

export function explorerUrl(
  kind: ExplorerIdKind,
  id: string,
  network: string | null | undefined,
): string | null {
  if (!network || !id) return null;

  if (kind === "ark_tx" || kind === "commitment_tx") {
    const base = ARKADE_EXPLORERS[network];
    if (!base) return null;
    return `${base}/tx/${id}`;
  }

  if (kind === "arkade_address") {
    const base = ARKADE_EXPLORERS[network];
    if (!base) return null;
    return `${base}/address/${id}`;
  }

  if (kind === "boarding_tx" || kind === "bitcoin_tx") {
    const base = BITCOIN_EXPLORERS[network];
    if (!base) return null;
    return `${base}/tx/${id}`;
  }

  if (kind === "bitcoin_address") {
    const base = BITCOIN_EXPLORERS[network];
    if (!base) return null;
    return `${base}/address/${id}`;
  }

  return null;
}
