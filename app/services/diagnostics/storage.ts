import { Directory, File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import type { SupportBundle } from "./bundle";

const FILE_EXTENSION = "trixielogs";
const MIME_TYPE = "application/json";

export type WriteBundleOptions = {
  bundle: SupportBundle;
  /** Suggested filename without extension; sanitised to ASCII safe chars. */
  basename: string;
};

/**
 * Serialises the bundle to a UTF-8 JSON file in the cache directory and
 * returns its file URI. Caller is responsible for sharing/saving it and
 * deleting the temp file afterwards.
 */
export function writeBundleToTemp(options: WriteBundleOptions): {
  uri: string;
  filename: string;
} {
  const safe = sanitizeBasename(options.basename);
  const filename = `${safe}.${FILE_EXTENSION}`;
  const file = new File(Paths.cache, filename);
  if (file.exists) file.delete();
  file.create();
  file.write(JSON.stringify(options.bundle, null, 2));
  return { uri: file.uri, filename };
}

/**
 * Opens the share-sheet for an existing bundle file. Resolves once the sheet
 * is dismissed. Throws if the platform does not expose a sharing API.
 */
export async function shareBundleFile(uri: string): Promise<void> {
  if (!(await Sharing.isAvailableAsync())) {
    throw new Error(
      "Sharing is unavailable on this device. Save the file to device storage manually.",
    );
  }
  await Sharing.shareAsync(uri, {
    mimeType: MIME_TYPE,
    UTI: "public.json",
    dialogTitle: "Share Trixie support bundle",
  });
}

export type SaveBundleResult =
  | { kind: "saved"; uri: string }
  | { kind: "cancelled" };

/**
 * Opens the system directory picker and writes the temp bundle file into the
 * directory the user picks.
 *
 * Mirrors `app/services/backup/storage.ts:saveBackupFile` — same SAF-safe
 * createFile + write(bytes) sequence so the `.trixielogs` extension survives
 * the Storage Access Framework on Android.
 */
export async function saveBundleFile(input: {
  sourceUri: string;
  filename: string;
}): Promise<SaveBundleResult> {
  let target: Directory;
  try {
    target = await Directory.pickDirectoryAsync();
  } catch {
    return { kind: "cancelled" };
  }
  const sourceFile = new File(input.sourceUri);
  const bytes = await sourceFile.bytes();
  const destFile = target.createFile(
    input.filename,
    "application/octet-stream",
  );
  destFile.write(bytes);
  return { kind: "saved", uri: destFile.uri };
}

/**
 * Removes a temp bundle file at the given URI. Best-effort: missing files do
 * not throw.
 */
export function deleteBundleTempFile(uri: string): void {
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch {
    // best-effort cleanup
  }
}

function sanitizeBasename(name: string): string {
  const cleaned = name.trim().replace(/[^a-zA-Z0-9._-]/g, "-");
  return cleaned.length > 0 ? cleaned : "trixie-support";
}
