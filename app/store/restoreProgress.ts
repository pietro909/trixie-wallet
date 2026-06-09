import type { RestoreProgress } from "./types";

/**
 * Maps the transient {@link RestoreProgress} signal to the LoadingOverlay
 * message shown on the restore/import screens. Keyed on both the stage and the
 * `walletMode` so a static restore never borrows HD-recovery wording (there is
 * no blockchain scan and nothing is "recovered" — it just syncs). Returns
 * `fallback` whenever no restore is in flight.
 */
export function restoreLoadingMessage<T extends string | undefined>(
  progress: RestoreProgress,
  fallback: T,
): string | T {
  if (progress.status !== "restoring") return fallback;
  switch (progress.stage) {
    case "scanning":
      return "Scanning blockchain for rotated addresses. This can take a minute…";
    case "syncing":
      return progress.walletMode === "hd"
        ? "Syncing recovered balance…"
        : "Syncing balance…";
    default:
      return "Restoring wallet…";
  }
}
