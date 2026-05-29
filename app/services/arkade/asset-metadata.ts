import type { AssetDetails } from "@arkade-os/sdk";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getWallet } from "./runtime";

export const ASSET_METADATA_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Cap on persisted `metadata.icon` size. Large data: URLs would otherwise
 * dominate AsyncStorage usage. Overrun icons are dropped (rendered as letter
 * fallback) rather than truncated mid-payload.
 */
export const ASSET_ICON_MAX_BYTES = 32 * 1024;

export type CachedAssetDetails = {
  assetId: string;
  supply: string;
  metadata?: {
    name?: string;
    ticker?: string;
    decimals?: number;
    icon?: string;
  } & Record<string, unknown>;
  controlAssetId?: string;
  cachedAt: number;
};

function key(network: string): string {
  return `trixie:asset-metadata:${network}`;
}

type RawCache = Record<string, CachedAssetDetails>;

async function readAll(network: string): Promise<RawCache> {
  try {
    const raw = await AsyncStorage.getItem(key(network));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as RawCache;
    if (!parsed || typeof parsed !== "object") return {};
    return parsed;
  } catch {
    return {};
  }
}

async function writeAll(network: string, cache: RawCache): Promise<void> {
  const now = Date.now();
  const pruned: RawCache = {};
  for (const [k, v] of Object.entries(cache)) {
    if (typeof v?.cachedAt !== "number") continue;
    if (now - v.cachedAt >= ASSET_METADATA_TTL_MS) continue;
    pruned[k] = v;
  }
  await AsyncStorage.setItem(key(network), JSON.stringify(pruned));
}

function isFresh(entry: CachedAssetDetails): boolean {
  return Date.now() - entry.cachedAt < ASSET_METADATA_TTL_MS;
}

function sizeInBytes(value: string): number {
  let size = 0;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 0x80) size += 1;
    else if (code < 0x800) size += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      size += 4;
      i++;
    } else {
      size += 3;
    }
  }
  return size;
}

function normalizeForPersist(details: AssetDetails): CachedAssetDetails {
  const metadata = details.metadata
    ? { ...(details.metadata as Record<string, unknown>) }
    : undefined;
  if (metadata && typeof metadata.icon === "string") {
    if (sizeInBytes(metadata.icon) > ASSET_ICON_MAX_BYTES) {
      delete metadata.icon;
    }
  }
  return {
    assetId: details.assetId,
    supply: details.supply.toString(),
    metadata: metadata as CachedAssetDetails["metadata"],
    controlAssetId: details.controlAssetId,
    cachedAt: Date.now(),
  };
}

export async function readAssetMetadata(
  network: string,
  assetId: string,
): Promise<CachedAssetDetails | null> {
  const all = await readAll(network);
  const entry = all[assetId];
  if (!entry) return null;
  if (!isFresh(entry)) return null;
  return entry;
}

export async function readAssetMetadataMap(
  network: string,
  assetIds: string[],
): Promise<Map<string, CachedAssetDetails>> {
  const all = await readAll(network);
  const out = new Map<string, CachedAssetDetails>();
  for (const id of assetIds) {
    const entry = all[id];
    if (entry && isFresh(entry)) out.set(id, entry);
  }
  return out;
}

export async function writeAssetMetadata(
  network: string,
  details: AssetDetails,
): Promise<CachedAssetDetails> {
  const all = await readAll(network);
  const entry = normalizeForPersist(details);
  all[details.assetId] = entry;
  await writeAll(network, all);
  return entry;
}

export async function dropAssetMetadata(
  network: string,
  assetId: string,
): Promise<void> {
  const all = await readAll(network);
  if (!all[assetId]) return;
  delete all[assetId];
  await writeAll(network, all);
}

export async function clearAssetMetadata(network?: string): Promise<void> {
  if (network) {
    await AsyncStorage.removeItem(key(network));
    return;
  }
  const keys = await AsyncStorage.getAllKeys();
  const matches = keys.filter((k) => k.startsWith("trixie:asset-metadata:"));
  if (matches.length > 0) await AsyncStorage.removeMany(matches);
}

/**
 * Resolve metadata, hitting the cache first and the SDK on miss/expiry.
 * - 'cache' — read cache; fall through to SDK only on miss/expiry.
 * - 'fresh' — always call SDK, overwrite cache.
 */
export async function fetchAssetDetailsCached(
  network: string,
  assetId: string,
  mode: "cache" | "fresh" = "cache",
): Promise<CachedAssetDetails> {
  if (mode === "cache") {
    const cached = await readAssetMetadata(network, assetId);
    if (cached) return cached;
  }
  const wallet = await getWallet();
  const details = await wallet.assetManager.getAssetDetails(assetId);
  return writeAssetMetadata(network, details);
}
