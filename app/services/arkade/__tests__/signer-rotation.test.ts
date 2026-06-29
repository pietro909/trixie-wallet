// Faithful stand-in for the SDK helper: cooperative migration applies to
// MIGRATABLE and DUE_NOW only (matches the real `isCooperativelyMigratable`).
jest.mock("@arkade-os/sdk", () => ({
  isCooperativelyMigratable: (status: string) =>
    status === "MIGRATABLE" || status === "DUE_NOW",
}));

import type {
  DeprecatedSignerMigrationReport,
  DeprecatedSignerReport,
  MigrationLegReport,
  MigrationVtxoRef,
  SignerStatus,
} from "@arkade-os/sdk";
import {
  aggregateSignerRotationStatus,
  summarizeMigrationReport,
} from "../signer-rotation";

function makeReport(
  partial: Partial<DeprecatedSignerReport> & { status: SignerStatus },
): DeprecatedSignerReport {
  return {
    signerPubKey: partial.signerPubKey ?? "ab".repeat(32),
    status: partial.status,
    cutoffDate: partial.cutoffDate,
    secondsUntilCutoff: partial.secondsUntilCutoff,
    // Default to a fund-bearing report; the "nothing to rotate" case is
    // covered explicitly by passing all counts as 0.
    vtxoCount: partial.vtxoCount ?? 1,
    totalValue: partial.totalValue ?? 0,
    boardingCount: partial.boardingCount ?? 0,
    boardingValue: partial.boardingValue ?? 0,
    recoverableCount: partial.recoverableCount ?? 0,
    recoverableValue: partial.recoverableValue ?? 0,
    awaitingSweepCount: partial.awaitingSweepCount ?? 0,
    awaitingSweepValue: partial.awaitingSweepValue ?? 0,
    nextSweepEta: partial.nextSweepEta,
  };
}

function vtxoRef(partial: Partial<MigrationVtxoRef> = {}): MigrationVtxoRef {
  return {
    txid: partial.txid ?? "00".repeat(32),
    vout: partial.vout ?? 0,
    value: partial.value ?? 1000,
    signerPubKey: partial.signerPubKey ?? "cd".repeat(32),
    cutoffDate: partial.cutoffDate,
  };
}

describe("aggregateSignerRotationStatus", () => {
  it("returns null for no reports", () => {
    expect(aggregateSignerRotationStatus([])).toBeNull();
    expect(aggregateSignerRotationStatus(null)).toBeNull();
    expect(aggregateSignerRotationStatus(undefined)).toBeNull();
  });

  it("returns null when every report is CURRENT", () => {
    expect(
      aggregateSignerRotationStatus([
        makeReport({ status: "CURRENT" as SignerStatus }),
      ]),
    ).toBeNull();
  });

  it("returns null when a deprecated signer holds no funds to act on", () => {
    // A signer can be deprecated while the wallet holds nothing tied to it —
    // no banner should be raised since there is nothing to rotate.
    expect(
      aggregateSignerRotationStatus([
        makeReport({
          status: "MIGRATABLE",
          vtxoCount: 0,
          boardingCount: 0,
          recoverableCount: 0,
          awaitingSweepCount: 0,
        }),
      ]),
    ).toBeNull();
  });

  it("ignores fund-less reports when ranking severity", () => {
    // The MIGRATABLE signer has funds; the EXPIRED one is empty and must not
    // win the worst-status ranking.
    const status = aggregateSignerRotationStatus([
      makeReport({
        status: "EXPIRED",
        signerPubKey: "empty",
        vtxoCount: 0,
        boardingCount: 0,
        recoverableCount: 0,
        awaitingSweepCount: 0,
      }),
      makeReport({
        status: "MIGRATABLE",
        signerPubKey: "funded",
        vtxoCount: 1,
      }),
    ]);
    expect(status?.worstStatus).toBe("MIGRATABLE");
    expect(status?.reports).toHaveLength(1);
    expect(status?.reports[0].signerPubKey).toBe("funded");
  });

  it("prioritizes DUE_NOW over EXPIRED for actionability", () => {
    const status = aggregateSignerRotationStatus([
      makeReport({ status: "EXPIRED", signerPubKey: "expired" }),
      makeReport({ status: "DUE_NOW", signerPubKey: "duenow" }),
    ]);
    expect(status?.worstStatus).toBe("DUE_NOW");
  });

  it("ranks EXPIRED above MIGRATABLE above UNKNOWN_SIGNER", () => {
    expect(
      aggregateSignerRotationStatus([
        makeReport({ status: "UNKNOWN_SIGNER" }),
        makeReport({ status: "MIGRATABLE" }),
        makeReport({ status: "EXPIRED" }),
      ])?.worstStatus,
    ).toBe("EXPIRED");

    expect(
      aggregateSignerRotationStatus([
        makeReport({ status: "UNKNOWN_SIGNER" }),
        makeReport({ status: "MIGRATABLE" }),
      ])?.worstStatus,
    ).toBe("MIGRATABLE");

    expect(
      aggregateSignerRotationStatus([makeReport({ status: "UNKNOWN_SIGNER" })])
        ?.worstStatus,
    ).toBe("UNKNOWN_SIGNER");
  });

  it("derives canMigrate/hasMigratableFunds from isCooperativelyMigratable", () => {
    const migratable = aggregateSignerRotationStatus([
      makeReport({ status: "MIGRATABLE" }),
    ]);
    expect(migratable?.hasMigratableFunds).toBe(true);
    expect(migratable?.reports[0].canMigrate).toBe(true);

    const expired = aggregateSignerRotationStatus([
      makeReport({ status: "EXPIRED" }),
    ]);
    expect(expired?.hasMigratableFunds).toBe(false);
    expect(expired?.reports[0].canMigrate).toBe(false);

    const unknown = aggregateSignerRotationStatus([
      makeReport({ status: "UNKNOWN_SIGNER" }),
    ]);
    expect(unknown?.hasMigratableFunds).toBe(false);
    expect(unknown?.reports[0].canMigrate).toBe(false);
  });

  it("serializes bigint cutoff fields to decimal strings", () => {
    const status = aggregateSignerRotationStatus([
      makeReport({
        status: "MIGRATABLE",
        cutoffDate: 1_900_000_000n,
        secondsUntilCutoff: 12345,
      }),
    ]);
    expect(status?.reports[0].cutoffDateSeconds).toBe("1900000000");
    expect(typeof status?.reports[0].cutoffDateSeconds).toBe("string");
    expect(status?.reports[0].secondsUntilCutoff).toBe(12345);
  });

  it("omits cutoffDateSeconds when the SDK report has no cutoff", () => {
    const status = aggregateSignerRotationStatus([
      makeReport({ status: "DUE_NOW" }),
    ]);
    expect(status?.reports[0].cutoffDateSeconds).toBeUndefined();
  });

  it("carries per-signer count/value fields through unchanged", () => {
    const status = aggregateSignerRotationStatus([
      makeReport({
        status: "EXPIRED",
        vtxoCount: 2,
        totalValue: 5000,
        boardingCount: 1,
        boardingValue: 9000,
        recoverableCount: 1,
        recoverableValue: 3000,
        awaitingSweepCount: 1,
        awaitingSweepValue: 2000,
        nextSweepEta: 1_800_000_000_000,
      }),
    ]);
    const r = status?.reports[0];
    expect(r).toMatchObject({
      vtxoCount: 2,
      totalValue: 5000,
      boardingCount: 1,
      boardingValue: 9000,
      recoverableCount: 1,
      recoverableValue: 3000,
      awaitingSweepCount: 1,
      awaitingSweepValue: 2000,
      nextSweepEta: 1_800_000_000_000,
    });
  });
});

describe("summarizeMigrationReport", () => {
  function leg(partial: Partial<MigrationLegReport> = {}): MigrationLegReport {
    return {
      txid: partial.txid,
      migrated: partial.migrated ?? [],
      skipped: partial.skipped,
      deferred: partial.deferred,
      oversized: partial.oversized,
      error: partial.error,
    };
  }

  function report(
    partial: Partial<DeprecatedSignerMigrationReport> = {},
  ): DeprecatedSignerMigrationReport {
    return {
      rotated: partial.rotated ?? false,
      skipped: partial.skipped,
      vtxos: partial.vtxos,
      boarding: partial.boarding,
      expired: partial.expired ?? [],
      signers: partial.signers ?? [],
    };
  }

  it("aggregates a full both-leg migration with txids", () => {
    const s = summarizeMigrationReport(
      report({
        vtxos: leg({ txid: "vtxo-tx", migrated: [vtxoRef(), vtxoRef()] }),
        boarding: leg({ txid: "boarding-tx", migrated: [vtxoRef()] }),
      }),
    );
    expect(s.migratedCount).toBe(3);
    expect(s.txids).toEqual(["vtxo-tx", "boarding-tx"]);
    expect(s.hasErrors).toBe(false);
    expect(s.needsUnilateralExit).toBe(false);
    expect(s.hasRetryableRemainder).toBe(false);
    expect(s.hasPartialProgress).toBe(false);
  });

  it("keeps a leg error AND the other leg's migrated funds (partial progress)", () => {
    const s = summarizeMigrationReport(
      report({
        vtxos: leg({ txid: "vtxo-tx", migrated: [vtxoRef()] }),
        boarding: leg({ error: "boarding settle failed" }),
      }),
    );
    expect(s.migratedCount).toBe(1);
    expect(s.txids).toEqual(["vtxo-tx"]);
    expect(s.hasErrors).toBe(true);
    expect(s.errors).toEqual([
      { leg: "boarding", message: "boarding settle failed" },
    ]);
    expect(s.hasPartialProgress).toBe(true);
  });

  it("surfaces deferred leftovers as a retryable remainder", () => {
    const s = summarizeMigrationReport(
      report({ vtxos: leg({ txid: "t", migrated: [vtxoRef()], deferred: 4 }) }),
    );
    expect(s.deferredCount).toBe(4);
    expect(s.hasRetryableRemainder).toBe(true);
    expect(s.hasPartialProgress).toBe(true);
  });

  it("flags oversized inputs as needing unilateral exit", () => {
    const s = summarizeMigrationReport(
      report({ vtxos: leg({ oversized: [vtxoRef(), vtxoRef()] }) }),
    );
    expect(s.oversizedCount).toBe(2);
    expect(s.needsUnilateralExit).toBe(true);
    expect(s.migratedCount).toBe(0);
  });

  it("preserves per-leg skip reasons (enum, not a count)", () => {
    const s = summarizeMigrationReport(
      report({
        vtxos: leg({ skipped: "below-dust" }),
        boarding: leg({ skipped: "oversized-only" }),
      }),
    );
    expect(s.legSkips).toEqual([
      { leg: "vtxos", reason: "below-dust" },
      { leg: "boarding", reason: "oversized-only" },
    ]);
    expect(s.migratedCount).toBe(0);
  });

  it("preserves global skip reasons with neither leg present", () => {
    expect(
      summarizeMigrationReport(report({ skipped: "no-deprecated-vtxos" }))
        .globalSkip,
    ).toBe("no-deprecated-vtxos");
    expect(
      summarizeMigrationReport(report({ skipped: "unknown-wallet-signer" }))
        .globalSkip,
    ).toBe("unknown-wallet-signer");
  });

  it("counts expired inputs without treating them as migrated", () => {
    const s = summarizeMigrationReport(
      report({ expired: [vtxoRef(), vtxoRef(), vtxoRef()] }),
    );
    expect(s.expiredCount).toBe(3);
    expect(s.migratedCount).toBe(0);
    expect(s.hasErrors).toBe(false);
  });

  it("preserves every co-occurring condition at once", () => {
    const s = summarizeMigrationReport(
      report({
        skipped: "unknown-wallet-signer",
        vtxos: leg({
          txid: "vtxo-tx",
          migrated: [vtxoRef()],
          deferred: 2,
          oversized: [vtxoRef()],
        }),
        boarding: leg({ skipped: "below-dust", error: "boarding boom" }),
        expired: [vtxoRef(), vtxoRef()],
      }),
    );
    expect(s.migratedCount).toBe(1);
    expect(s.deferredCount).toBe(2);
    expect(s.oversizedCount).toBe(1);
    expect(s.expiredCount).toBe(2);
    expect(s.txids).toEqual(["vtxo-tx"]);
    expect(s.legSkips).toEqual([{ leg: "boarding", reason: "below-dust" }]);
    expect(s.globalSkip).toBe("unknown-wallet-signer");
    expect(s.errors).toEqual([{ leg: "boarding", message: "boarding boom" }]);
    expect(s.hasErrors).toBe(true);
    expect(s.needsUnilateralExit).toBe(true);
    expect(s.hasRetryableRemainder).toBe(true);
    expect(s.hasPartialProgress).toBe(true);
  });

  it("produces a clean no-move summary for an empty report", () => {
    const s = summarizeMigrationReport(report());
    expect(s.migratedCount).toBe(0);
    expect(s.txids).toEqual([]);
    expect(s.legSkips).toEqual([]);
    expect(s.errors).toEqual([]);
    expect(s.globalSkip).toBeUndefined();
    expect(s.hasErrors).toBe(false);
    expect(s.hasPartialProgress).toBe(false);
  });
});
