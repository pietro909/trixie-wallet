import {
  type DeprecatedSignerMigrationReport,
  type DeprecatedSignerReport,
  isCooperativelyMigratable,
  type MigrationGlobalSkipReason,
  type MigrationLegReport,
  type MigrationLegSkipReason,
} from "@arkade-os/sdk";
import type {
  SignerRotationReport,
  SignerRotationSeverity,
  SignerRotationStatus,
} from "../../store/types";

/**
 * Product severity ordering for deprecated-signer status. Higher wins when
 * aggregating multiple reports into a single banner. `DUE_NOW` intentionally
 * outranks `EXPIRED`: `DUE_NOW` has a cooperative migration action the user can
 * take right now, while `EXPIRED` is serious but resolves through the
 * server's sweep + recovery lifecycle (wait/recovery guidance, not migration).
 */
const SEVERITY_ORDER: Record<SignerRotationSeverity, number> = {
  CURRENT: 0,
  UNKNOWN_SIGNER: 1,
  MIGRATABLE: 2,
  EXPIRED: 3,
  DUE_NOW: 4,
};

function toRotationReport(r: DeprecatedSignerReport): SignerRotationReport {
  return {
    signerPubKey: r.signerPubKey,
    status: r.status,
    canMigrate: isCooperativelyMigratable(r.status),
    cutoffDateSeconds:
      r.cutoffDate != null ? r.cutoffDate.toString() : undefined,
    secondsUntilCutoff: r.secondsUntilCutoff,
    vtxoCount: r.vtxoCount,
    totalValue: r.totalValue,
    boardingCount: r.boardingCount,
    boardingValue: r.boardingValue,
    recoverableCount: r.recoverableCount,
    recoverableValue: r.recoverableValue,
    awaitingSweepCount: r.awaitingSweepCount,
    awaitingSweepValue: r.awaitingSweepValue,
    nextSweepEta: r.nextSweepEta,
  };
}

/**
 * Whether a report carries any funds the user could act on. A signer can be
 * deprecated while the wallet holds nothing tied to it (every count `0`) — the
 * SDK still emits a report, but there is nothing to migrate, recover, or wait
 * on, so it must not raise a banner.
 */
function reportHasFunds(r: SignerRotationReport): boolean {
  return (
    r.vtxoCount > 0 ||
    r.boardingCount > 0 ||
    r.recoverableCount > 0 ||
    r.awaitingSweepCount > 0
  );
}

/**
 * Aggregate the SDK's per-signer reports into the transient
 * {@link SignerRotationStatus} the UI consumes. Stringifies `bigint` cutoffs,
 * derives `canMigrate`/`hasMigratableFunds` from the SDK's
 * {@link isCooperativelyMigratable} (not a hardcoded status check), and returns
 * `null` when there is nothing actionable (no reports, every report is
 * `CURRENT`, or no remaining report holds any funds to act on).
 */
export function aggregateSignerRotationStatus(
  reports: DeprecatedSignerReport[] | null | undefined,
): SignerRotationStatus | null {
  if (!reports || reports.length === 0) return null;
  const mapped = reports.map(toRotationReport).filter(reportHasFunds);
  if (mapped.length === 0) return null;
  let worstStatus: SignerRotationSeverity = "CURRENT";
  for (const r of mapped) {
    if (SEVERITY_ORDER[r.status] > SEVERITY_ORDER[worstStatus]) {
      worstStatus = r.status;
    }
  }
  if (worstStatus === "CURRENT") return null;
  return {
    worstStatus,
    hasMigratableFunds: mapped.some((r) => r.canMigrate),
    reports: mapped,
  };
}

/**
 * Flat, simultaneous-condition summary of a
 * {@link DeprecatedSignerMigrationReport}. A single report can carry several
 * conditions at once (one leg migrated, the other errored, plus expired
 * inputs), so this is a struct of independent counts/flags — never a
 * single-kind discriminated union. The UI picks a headline from these by
 * priority but the full picture is preserved.
 */
export type SignerMigrationSummary = {
  /** Inputs successfully migrated across both legs. */
  migratedCount: number;
  /** Inputs a leg's caps left behind; re-running migration may move them. */
  deferredCount: number;
  /** Inputs too large to migrate cooperatively; need unilateral exit. */
  oversizedCount: number;
  /** Cutoff-expired inputs (a classification outcome, not a leg failure). */
  expiredCount: number;
  /** Every leg transaction id (VTXO send txid and/or boarding settle txid). */
  txids: string[];
  /** Per-leg "submitted nothing" reasons. */
  legSkips: Array<{
    leg: "vtxos" | "boarding";
    reason: MigrationLegSkipReason;
  }>;
  /** Whole-pass skip, set when neither leg ran. */
  globalSkip?: MigrationGlobalSkipReason;
  /** Per-leg / top-level hard errors; the other leg may still have migrated. */
  errors: Array<{ leg: "vtxos" | "boarding" | "top_level"; message: string }>;
  /** Some funds moved AND something (error/deferred/oversized) remains. */
  hasPartialProgress: boolean;
  /** Caps deferred migratable funds; tapping migrate again can finish them. */
  hasRetryableRemainder: boolean;
  /** Oversized funds exist; cooperative migration cannot move them. */
  needsUnilateralExit: boolean;
  /** Any leg or top-level error present. */
  hasErrors: boolean;
};

const LEGS: Array<"vtxos" | "boarding"> = ["vtxos", "boarding"];

/**
 * Reduce a two-leg {@link DeprecatedSignerMigrationReport} to a flat
 * {@link SignerMigrationSummary}. Inspects both `vtxos` and `boarding` legs,
 * aggregates their counts, keeps every leg `txid`, preserves each leg's
 * `skipped` reason (an enum, not a count) plus the top-level `skipped` and
 * `expired[]`, and never collapses a leg error when the other leg migrated
 * funds.
 */
export function summarizeMigrationReport(
  report: DeprecatedSignerMigrationReport,
): SignerMigrationSummary {
  let migratedCount = 0;
  let deferredCount = 0;
  let oversizedCount = 0;
  const txids: string[] = [];
  const legSkips: SignerMigrationSummary["legSkips"] = [];
  const errors: SignerMigrationSummary["errors"] = [];

  for (const leg of LEGS) {
    const legReport: MigrationLegReport | undefined = report[leg];
    if (!legReport) continue;
    migratedCount += legReport.migrated?.length ?? 0;
    if (legReport.txid) txids.push(legReport.txid);
    deferredCount += legReport.deferred ?? 0;
    oversizedCount += legReport.oversized?.length ?? 0;
    if (legReport.skipped) {
      legSkips.push({ leg, reason: legReport.skipped });
    }
    if (legReport.error) {
      errors.push({ leg, message: legReport.error });
    }
  }

  const expiredCount = report.expired?.length ?? 0;
  const hasErrors = errors.length > 0;
  const needsUnilateralExit = oversizedCount > 0;
  const hasRetryableRemainder = deferredCount > 0;
  const hasPartialProgress =
    migratedCount > 0 && (hasErrors || deferredCount > 0 || oversizedCount > 0);

  return {
    migratedCount,
    deferredCount,
    oversizedCount,
    expiredCount,
    txids,
    legSkips,
    globalSkip: report.skipped,
    errors,
    hasPartialProgress,
    hasRetryableRemainder,
    needsUnilateralExit,
    hasErrors,
  };
}
