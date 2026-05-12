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
 * 3. explicit map from `virtualStatus.state` for the remaining cases.
 *
 * The explicit switch is intentional: assigning `state` directly is
 * type-safe today (SDK union is a subset of {@link VtxoStatus}) but a future
 * SDK that adds a new state would either fail compile or — worse, after a
 * stale-types mismatch — slip through as an unknown string at runtime.
 * Falling back to `"preconfirmed"` is the safe choice: it never claims an
 * unknown output is finalized.
 */
export function classifyVtxo(
  vtxo: ExtendedVirtualCoin,
  dustSats: number,
): VtxoStatus {
  if (dustSats > 0 && isSubdust(vtxo, BigInt(dustSats))) return "subdust";
  if (isRecoverable(vtxo)) return "swept";
  switch (vtxo.virtualStatus.state) {
    case "settled":
      return "settled";
    case "preconfirmed":
      return "preconfirmed";
    case "swept":
      return "swept";
    case "spent":
      return "spent";
    default:
      return "preconfirmed";
  }
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
    if (a.amountSats !== b.amountSats) return b.amountSats - a.amountSats;
    return b.createdAt.getTime() - a.createdAt.getTime();
  });
  return classified;
}
