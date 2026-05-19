import { type ArkTransaction, TxType } from "@arkade-os/sdk";

/**
 * Window of slack around `swap.createdAt` used by the history-match heuristic.
 * Mirrors the original reverse-only matcher: a swap row may be timestamped
 * slightly *before* the corresponding Arkade tx (the lockup hasn't observed
 * yet), and the Arkade tx can land slightly after the swap completes.
 */
export const LINKAGE_LOOKBACK_MS = 30_000;
export const LINKAGE_LOOKAHEAD_MS = 5_000;

export type LinkageDirection = "in" | "out";

export type FindUnambiguousHistoryMatchInput = {
  history: ArkTransaction[];
  /** "in" matches `TxReceived`, "out" matches `TxSent`. */
  direction: LinkageDirection;
  /** Magnitude in sats. Compared against `Math.abs(tx.amount)`. */
  amountSats: number;
  /** Inclusive lower bound on `tx.createdAt` (ms since epoch). */
  lowerBoundMs: number;
  /** Inclusive upper bound on `tx.createdAt` (ms since epoch). */
  upperBoundMs: number;
};

/**
 * Resolves a swap's counterpart wallet-tx id from a transaction history slice.
 *
 * Returns the txid only when exactly one history entry matches direction +
 * amount + time window. Two or more matches collapse to `null` so an ambiguous
 * linkage is never persisted; callers should leave the swap unlinked and let
 * the next signal disambiguate.
 *
 * The same heuristic is applied at three callsites:
 * - Live reverse-swap completion (originally the only path).
 * - Post-restore linkage for both reverse and submarine swaps, which is how
 *   seed-only restores recover the Lightning ↔ Arkade-tx link without any
 *   backup material.
 */
export function findUnambiguousHistoryMatch(
  input: FindUnambiguousHistoryMatchInput,
): string | null {
  const wantedType =
    input.direction === "in" ? TxType.TxReceived : TxType.TxSent;
  const matches: ArkTransaction[] = [];
  for (const tx of input.history) {
    if (tx.type !== wantedType) continue;
    if (Math.abs(tx.amount) !== input.amountSats) continue;
    if (tx.createdAt < input.lowerBoundMs) continue;
    if (tx.createdAt > input.upperBoundMs) continue;
    matches.push(tx);
    if (matches.length > 1) return null;
  }
  if (matches.length !== 1) return null;
  const key = matches[0].key;
  return key.arkTxid || key.commitmentTxid || key.boardingTxid || null;
}
