import * as DocumentPicker from "expo-document-picker";
import { Directory, File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { type EncryptedEnvelope, isEncryptedEnvelope } from "./crypto";

const FILE_EXTENSION = "trixiebackup";
const MIME_TYPE = "application/json";

export type WriteBackupOptions = {
  envelope: EncryptedEnvelope;
  /** Suggested filename without extension; sanitized to ASCII safe chars. */
  basename: string;
};

/**
 * Serialises the envelope to a UTF-8 JSON file in the cache directory and
 * returns its file URI. Caller is responsible for sharing it and deleting
 * it afterwards.
 */
export function writeBackupToTemp(options: WriteBackupOptions): string {
  const safe = sanitizeBasename(options.basename);
  const filename = `${safe}.${FILE_EXTENSION}`;
  const file = new File(Paths.cache, filename);
  if (file.exists) {
    file.delete();
  }
  file.create();
  file.write(JSON.stringify(options.envelope, null, 2));
  return file.uri;
}

/**
 * Opens the share-sheet for an existing file URI. Resolves once the sheet is
 * dismissed. Throws if the platform does not expose a sharing API.
 */
export async function shareBackupFile(uri: string): Promise<void> {
  if (!(await Sharing.isAvailableAsync())) {
    throw new Error(
      "Sharing is unavailable on this device. Save the file to the device storage manually.",
    );
  }
  await Sharing.shareAsync(uri, {
    mimeType: MIME_TYPE,
    UTI: "public.json",
    dialogTitle: "Save Trixie backup",
  });
}

export type SaveBackupResult =
  | { kind: "saved"; uri: string }
  | { kind: "cancelled" };

/**
 * Opens the system directory picker and writes the temp backup file into the
 * directory the user picks.
 *
 * Android backs this with the Storage Access Framework, so the user can save
 * into Downloads, Documents, Drive, or any DocumentProvider — including on a
 * fresh emulator that has no Drive sign-in. iOS opens the Files app and
 * grants session-scoped read/write to the chosen folder.
 *
 * Implementation note: on SAF, `new File(directory, name)` plus `copy()` does
 * not work — `copy()` reaches into `javaFile`, which throws on content URIs.
 * The SAF-correct path is `directory.createFile(name, mime)` followed by
 * `write(bytes)`, which routes through DocumentsContract (and through
 * `JavaFile.createFile` on real-fs paths).
 *
 * Returns `{ kind: "cancelled" }` if the user backs out of the picker.
 */
export async function saveBackupFile(input: {
  sourceUri: string;
  filename: string;
}): Promise<SaveBackupResult> {
  let target: Directory;
  try {
    target = await Directory.pickDirectoryAsync();
  } catch {
    // The picker rejects on user cancel; treat any error as cancellation
    // since we have no other recourse from JS.
    return { kind: "cancelled" };
  }
  const sourceFile = new File(input.sourceUri);
  const bytes = await sourceFile.bytes();
  // application/octet-stream keeps SAF from rewriting the `.trixiebackup`
  // extension to match a known MIME (it would otherwise append `.json` etc).
  const destFile = target.createFile(
    input.filename,
    "application/octet-stream",
  );
  destFile.write(bytes);
  return { kind: "saved", uri: destFile.uri };
}

/**
 * Removes a temp backup file at the given URI. Best-effort: missing files do
 * not throw.
 */
export function deleteBackupTempFile(uri: string): void {
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch {
    // best-effort cleanup
  }
}

/**
 * Opens the document picker, reads the chosen file, and parses its contents
 * as a Trixie backup envelope. Returns null if the user cancelled.
 *
 * The user's original file is never moved or deleted —
 * `copyToCacheDirectory: true` makes the picker copy it into our cache, and
 * we delete that cache copy as soon as we've parsed the envelope into memory.
 *
 * Throws if the picked file is not a valid envelope (wrong magic, malformed
 * JSON, missing fields). The caller surfaces a user-facing error.
 */
export async function pickBackupFile(): Promise<EncryptedEnvelope | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: ["application/json", "application/octet-stream", "*/*"],
    copyToCacheDirectory: true,
    multiple: false,
  });
  if (result.canceled) return null;
  const asset = result.assets[0];
  if (!asset) return null;
  const file = new File(asset.uri);
  let text: string;
  try {
    text = await file.text();
  } finally {
    // The original file the user picked is untouched — what we have here is
    // the picker's cache copy, no longer needed once parsing succeeds.
    try {
      if (file.exists) file.delete();
    } catch {
      // best-effort cleanup; the OS evicts the cache dir on its own
    }
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw new BackupFileError(
      "invalid_file",
      "This file is not a valid Trixie backup",
      e,
    );
  }
  if (!isEncryptedEnvelope(parsed)) {
    throw new BackupFileError(
      "invalid_file",
      "This file is not a valid Trixie backup",
    );
  }
  return parsed;
}

export type BackupFileErrorKind = "invalid_file";

export class BackupFileError extends Error {
  readonly kind: BackupFileErrorKind;
  readonly cause?: unknown;
  constructor(kind: BackupFileErrorKind, message: string, cause?: unknown) {
    super(message);
    this.name = "BackupFileError";
    this.kind = kind;
    this.cause = cause;
  }
}

function sanitizeBasename(name: string): string {
  const cleaned = name.trim().replace(/[^a-zA-Z0-9._-]/g, "-");
  return cleaned.length > 0 ? cleaned : "trixie-backup";
}
