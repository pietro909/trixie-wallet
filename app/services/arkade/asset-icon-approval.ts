import AsyncStorage from "@react-native-async-storage/async-storage";

const STORAGE_KEY = "trixie:asset-icon-approval";

export type IconApprovals = Record<string, boolean>;

let memoryCache: IconApprovals | null = null;

async function read(): Promise<IconApprovals> {
  if (memoryCache) return memoryCache;
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) {
      memoryCache = {};
      return memoryCache;
    }
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      memoryCache = {};
      return memoryCache;
    }
    const out: IconApprovals = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === "boolean") out[k] = v;
    }
    memoryCache = out;
    return out;
  } catch {
    memoryCache = {};
    return memoryCache;
  }
}

async function write(value: IconApprovals): Promise<void> {
  memoryCache = value;
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(value));
}

export async function readIconApprovals(): Promise<IconApprovals> {
  return { ...(await read()) };
}

export async function isIconApproved(assetId: string): Promise<boolean> {
  const all = await read();
  return all[assetId] === true;
}

export async function setIconApproval(
  assetId: string,
  approved: boolean,
): Promise<void> {
  const all = await read();
  if (approved) all[assetId] = true;
  else delete all[assetId];
  await write({ ...all });
}

export async function markSelfIssued(assetId: string): Promise<void> {
  await setIconApproval(assetId, true);
}

export async function clearIconApprovals(): Promise<void> {
  memoryCache = {};
  await AsyncStorage.removeItem(STORAGE_KEY);
}
