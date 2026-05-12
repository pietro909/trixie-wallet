import {
  type ExtendedVirtualCoin,
  isRecoverable,
  isSubdust,
  type Wallet,
} from "@arkade-os/sdk";
import { toArkadeError } from "./errors";

export type VtxoStatus =
  | "settled"
  | "preconfirmed"
  | "swept"
  | "subdust"
  | "spent";

/**
 * Extended VTXO with a classification overlay. `Omit<…, "status">` is
 * required: `ExtendedVirtualCoin` inherits a `status: Status` field from
 * `Coin` (onchain output status), and overlaying our own string-union
 * `status` without omitting the original produces `Status & VtxoStatus`,
 * which TS rightly refuses to use as a `Record<VtxoStatus, …>` key.
 */
export type ClassifiedVtxo = Omit<ExtendedVirtualCoin, "status"> & {
  status: VtxoStatus;
  amountSats: number;
  outpoint: string;
};

export type LoadVtxosOptions = {
  /** Pass through to the SDK filter — include swept-but-spendable entries. */
  includeRecoverable: boolean;
  /** Pass through to the SDK filter — include unrolled virtual outputs. */
  includeUnrolled?: boolean;
};

function formatOutpoint(vtxo: ExtendedVirtualCoin): string {
  return `${vtxo.txid}:${vtxo.vout}`;
}

/**
 * Classify a single VTXO into a stable display bucket. Precedence:
 *
 * 1. `subdust` — wins over everything (most user-relevant signal).
 * 2. `swept` — when the SDK marks the entry recoverable (sweep happened,
 *    but the value is still claimable in a future batch).
 * 3. `virtualStatus.state` mapped 1:1 for the remaining cases.
 */
export function classifyVtxo(
  vtxo: ExtendedVirtualCoin,
  dustSats: number,
): VtxoStatus {
  if (dustSats > 0 && isSubdust(vtxo, BigInt(dustSats))) return "subdust";
  if (isRecoverable(vtxo)) return "swept";
  return vtxo.virtualStatus.state;
}

/**
 * Fetch every VTXO at the wallet's Arkade address, classify each entry, and
 * return them sorted by amount desc, then by createdAt desc. The SDK does not
 * paginate `getVtxos`; the caller is expected to virtualize the rendered list
 * (FlatList) rather than slice the array.
 */
export async function loadVtxos(
  wallet: Wallet,
  opts: LoadVtxosOptions,
  dustSats: number,
): Promise<ClassifiedVtxo[]> {
  let raw: ExtendedVirtualCoin[];
  try {
    raw = await wallet.getVtxos({
      withRecoverable: opts.includeRecoverable,
      withUnrolled: opts.includeUnrolled ?? false,
    });
  } catch (e) {
    throw toArkadeError("vtxos_fetch_failed", "Failed to load VTXOs", e);
  }
  const classified: ClassifiedVtxo[] = raw.map((v) =>
    Object.assign({}, v, {
      status: classifyVtxo(v, dustSats),
      amountSats: v.value,
      outpoint: formatOutpoint(v),
    }),
  );
  classified.sort((a, b) => {
    if (a.value !== b.value) return b.value - a.value;
    return b.createdAt.getTime() - a.createdAt.getTime();
  });
  return classified;
}
