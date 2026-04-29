/**
 * Pure explorer-URL helper. Given a network, an id, and the kind of id, return
 * a human-facing explorer URL or null. Callers must render the id as plain
 * text when null is returned rather than synthesising a guess.
 */

export type ExplorerIdKind =
  | "ark_tx"
  | "commitment_tx"
  | "boarding_tx"
  | "bitcoin_tx";

const ARKADE_EXPLORERS: Record<string, string> = {
  bitcoin: "https://arkade.space",
  mainnet: "https://arkade.space",
  mutinynet: "https://explorer.mutinynet.arkade.sh",
};

const BITCOIN_EXPLORERS: Record<string, string> = {
  bitcoin: "https://mempool.space",
  mainnet: "https://mempool.space",
  signet: "https://mempool.space/signet",
  testnet: "https://mempool.space/testnet",
  mutinynet: "https://mutinynet.com",
};

function normalizeNetwork(network: string | null | undefined): string | null {
  if (!network) return null;
  return network.toLowerCase();
}

export function explorerUrl(
  kind: ExplorerIdKind,
  id: string,
  network: string | null | undefined,
): string | null {
  const n = normalizeNetwork(network);
  if (!n || !id) return null;

  if (kind === "ark_tx" || kind === "commitment_tx") {
    const base = ARKADE_EXPLORERS[n];
    if (!base) return null;
    return `${base}/tx/${id}`;
  }

  if (kind === "boarding_tx" || kind === "bitcoin_tx") {
    const base = BITCOIN_EXPLORERS[n];
    if (!base) return null;
    return `${base}/tx/${id}`;
  }

  return null;
}
