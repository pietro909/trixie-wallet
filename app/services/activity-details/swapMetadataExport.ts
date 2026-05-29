import type { BoltzSwap } from "@arkade-os/boltz-swap";
import type { Activity } from "../../store/types";
import { getBoltzSwapById } from "../arkade/lightning";
import {
  getSwapMetadata,
  type LocalSwapMetadata,
} from "../arkade/swap-storage";

/**
 * Everything the wallet knows about a single Boltz swap, assembled for the
 * "Copy metadata" support action on the Activity detail screen.
 *
 * - `activity` — the user-facing row as merged into the store (its own
 *   `metadata` never carries secrets).
 * - `swap` — the full SDK swap object from the local Boltz repository. Carries
 *   secret material: the proof-of-payment `preimage` and the raw Boltz
 *   request/response. Null when no swap row is found (e.g. the row was cleared
 *   but the Activity still references it).
 * - `localMetadata` — the wallet's own linkage row (`trixie_swap_meta`). Null
 *   when no row exists.
 *
 * The whole object is plain JSON: the SDK persists swaps as JSON, and Activity
 * / local metadata are AsyncStorage-safe, so `JSON.stringify` needs no
 * replacer.
 */
export type SwapMetadataExport = {
  exportedAt: string;
  activity: Activity;
  swap: BoltzSwap | null;
  localMetadata: LocalSwapMetadata | null;
};

/**
 * Pure assembler — composes the export object from already-fetched parts.
 * Kept free of I/O so it can be unit-tested; `collectSwapMetadataExport` wraps
 * it with the repository / metadata reads. `now` is injectable for tests.
 */
export function buildSwapMetadataExport(input: {
  activity: Activity;
  swap: BoltzSwap | null;
  localMetadata: LocalSwapMetadata | null;
  now?: number;
}): SwapMetadataExport {
  return {
    exportedAt: new Date(input.now ?? Date.now()).toISOString(),
    activity: input.activity,
    swap: input.swap,
    localMetadata: input.localMetadata,
  };
}

/**
 * Gathers the full record for a Boltz-swap Activity: the SDK swap object (with
 * secrets) plus the local linkage metadata, assembled via
 * `buildSwapMetadataExport`. Returns null for non-Boltz activities — the
 * screen only offers the action on Boltz rows.
 *
 * The result intentionally includes secrets (preimage, raw request/response)
 * and is meant for manual copy-to-clipboard support/debugging only. Never
 * persist it.
 */
export async function collectSwapMetadataExport(
  activity: Activity,
): Promise<SwapMetadataExport | null> {
  if (activity.source.type !== "boltz_swap") return null;
  const { swapId } = activity.source;
  const [swap, localMetadata] = await Promise.all([
    getBoltzSwapById(swapId),
    getSwapMetadata(swapId),
  ]);
  return buildSwapMetadataExport({ activity, swap, localMetadata });
}
