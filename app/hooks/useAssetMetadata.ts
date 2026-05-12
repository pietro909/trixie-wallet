import * as React from "react";
import { readIconApprovals } from "../services/arkade/asset-icon-approval";
import {
  type CachedAssetDetails,
  fetchAssetDetailsCached,
  readAssetMetadataMap,
} from "../services/arkade/asset-metadata";

export type UseAssetMetadataOptions = {
  /**
   * When true, also load the per-asset icon-approval map. Skip when the
   * caller doesn't render avatars (e.g. activity-details, which renders
   * the icon block in its own dedicated header).
   */
  withIconApprovals?: boolean;
  /**
   * When true, call the SDK for any asset id missing from cache (or whose
   * cache entry expired). When false, the hook returns whatever is in the
   * cache and never touches the network.
   */
  hydrateMissing?: boolean;
};

export type AssetMetadataState = {
  assetMetadata: Map<string, CachedAssetDetails>;
  iconApprovals: Record<string, boolean>;
};

const EMPTY_APPROVALS: Record<string, boolean> = {};

/**
 * Shared loader for asset metadata (+ optional icon approvals). Consolidates
 * the three near-identical `useEffect` blocks that previously lived in
 * WalletScreen, ActivityScreen, and ActivityDetailsScreen.
 *
 * The internal effect deps key off a sorted-join of `assetIds`, so callers
 * may pass a fresh array reference each render without triggering redundant
 * refetches — but it's still cheaper to memoize upstream.
 */
export function useAssetMetadata(
  network: string | null,
  assetIds: string[],
  opts: UseAssetMetadataOptions = {},
): AssetMetadataState {
  const { withIconApprovals = false, hydrateMissing = false } = opts;
  const [assetMetadata, setAssetMetadata] = React.useState<
    Map<string, CachedAssetDetails>
  >(() => new Map());
  const [iconApprovals, setIconApprovals] =
    React.useState<Record<string, boolean>>(EMPTY_APPROVALS);

  // Stable cache key: ids → sorted join. A fresh-but-equal array doesn't
  // re-fire the effect, while a real change to the id set does.
  const cacheKey = React.useMemo(
    () => assetIds.slice().sort().join(","),
    [assetIds],
  );

  React.useEffect(() => {
    if (!network || cacheKey.length === 0) {
      setAssetMetadata(new Map());
      setIconApprovals(EMPTY_APPROVALS);
      return;
    }
    const ids = cacheKey.split(",");
    let cancelled = false;
    void (async () => {
      const [initial, approvals] = await Promise.all([
        readAssetMetadataMap(network, ids),
        withIconApprovals
          ? readIconApprovals()
          : Promise.resolve(EMPTY_APPROVALS),
      ]);
      if (cancelled) return;
      setAssetMetadata(new Map(initial));
      if (withIconApprovals) setIconApprovals(approvals);
      if (!hydrateMissing) return;
      const next = new Map(initial);
      for (const id of ids) {
        // Re-check on every iteration: a failed fetch falls into catch and
        // would otherwise keep firing async work for the rest of the id list
        // after the component unmounts.
        if (cancelled) return;
        if (next.has(id)) continue;
        try {
          const fetched = await fetchAssetDetailsCached(network, id, "cache");
          if (cancelled) return;
          next.set(id, fetched);
        } catch {
          // best-effort; renderers fall back to bare ids on miss
        }
      }
      if (!cancelled) setAssetMetadata(new Map(next));
    })();
    return () => {
      cancelled = true;
    };
  }, [network, cacheKey, withIconApprovals, hydrateMissing]);

  return { assetMetadata, iconApprovals };
}
