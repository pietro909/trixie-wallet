import type { ArkTransaction, VirtualCoin } from "@arkade-os/sdk";
import type { Activity } from "../../../store/types";
import { buildActivityHistory } from "../activity-history";
import transactionHistoryRaw from "./fixtures/transaction_history.json";

// Trixie-specific coverage (spec §10 Phase F) — paths the SDK parity
// suite does not exercise: boarding lifecycle, mixed-commitment
// metadata, boarding-mixed-with-assets routing, empty inputs, network
// stamping, and cross-cutting invariants.

const baseDate = new Date("2026-05-12T12:00:00Z");

const vtxo = (over: Partial<VirtualCoin> = {}): VirtualCoin =>
  ({
    txid: "x",
    vout: 0,
    value: 0,
    status: { confirmed: false },
    virtualStatus: { state: "preconfirmed" },
    createdAt: baseDate,
    isUnrolled: false,
    isSpent: false,
    ...over,
  }) as VirtualCoin;

const leafVtxo = (
  commitmentTxid: string,
  over: Partial<VirtualCoin> = {},
): VirtualCoin =>
  vtxo({
    status: { confirmed: true, isLeaf: true },
    virtualStatus: { state: "settled", commitmentTxIds: [commitmentTxid] },
    ...over,
  });

const boardingTx = (over: Partial<ArkTransaction> = {}): ArkTransaction =>
  ({
    key: { boardingTxid: "B", commitmentTxid: "", arkTxid: "" },
    amount: 1000,
    settled: false,
    createdAt: baseDate.getTime(),
    type: "RECEIVED",
    ...over,
  }) as unknown as ArkTransaction;

describe("Phase F — Trixie-specific cases", () => {
  // F-1 — Unsettled boarding deposit → status: "pending".
  it("F-1: unsettled boarding deposit emits a pending row", async () => {
    const tx = boardingTx({
      key: { boardingTxid: "B-pending", commitmentTxid: "", arkTxid: "" },
      amount: 5000,
      settled: false,
    });

    const activities = await buildActivityHistory([], [tx], new Set());

    expect(activities).toHaveLength(1);
    expect(activities[0]).toMatchObject({
      id: "arkade:boarding:B-pending",
      title: "Boarding deposit",
      direction: "in",
      status: "pending",
      amountSats: 5000,
    });
  });

  // F-2 — Settled boarding + matching commitment → exactly one boarding
  // row and one boarding_settled row (no `batch` duplicate).
  it("F-2: settled boarding + cti commitment → boarding + boarding_settled only", async () => {
    const C = "commit-F2";
    const B = "B-F2";
    const tx = boardingTx({
      key: { boardingTxid: B, commitmentTxid: "", arkTxid: "" },
      amount: 1000,
      settled: true,
    });
    const leaf = leafVtxo(C, { txid: "leaf-F2", value: 1000 });

    const activities = await buildActivityHistory([leaf], [tx], new Set([C]));

    const ids = activities.map((a) => a.id).sort();
    expect(ids).toContain(`arkade:boarding:${B}`);
    expect(ids).toContain(`arkade:boarding_settled:${C}`);
    expect(
      activities.find((a) => a.id === `arkade:batch:${C}`),
    ).toBeUndefined();

    const settled = activities.find(
      (a) => a.id === `arkade:boarding_settled:${C}`,
    );
    expect(settled?.metadata).toMatchObject({
      commitmentTxid: C,
      settledAmountSats: 1000,
      boardingTxid: B,
    });
  });

  // F-3 — Two boarding txs of equal amount + two commitments. Each
  // boarding tx is claimed at most once across the two settlements.
  it("F-3: multi-deposit determinism claims each boarding tx at most once", async () => {
    const txA = boardingTx({
      key: { boardingTxid: "B-A", commitmentTxid: "", arkTxid: "" },
      amount: 1000,
      settled: true,
    });
    const txB = boardingTx({
      key: { boardingTxid: "B-B", commitmentTxid: "", arkTxid: "" },
      amount: 1000,
      settled: true,
    });
    const C1 = "cmt-F3-1";
    const C2 = "cmt-F3-2";
    const leaf1 = leafVtxo(C1, { txid: "leaf-F3-1", value: 1000 });
    const leaf2 = leafVtxo(C2, {
      txid: "leaf-F3-2",
      value: 1000,
      createdAt: new Date(baseDate.getTime() + 1000),
    });

    const activities = await buildActivityHistory(
      [leaf1, leaf2],
      [txA, txB],
      new Set([C1, C2]),
    );

    const settledRows = activities.filter((a) =>
      a.id.startsWith("arkade:boarding_settled:"),
    );
    expect(settledRows).toHaveLength(2);
    const claimed = new Set(
      settledRows.map((r) => r.metadata?.boardingTxid as string),
    );
    expect(claimed).toStrictEqual(new Set(["B-A", "B-B"]));
  });

  // F-4 — Pure renewal (equal spent and created, no asset delta, not
  // boarding-mixed) → renewal row with no amountSats.
  it("F-4: pure renewal emits a wallet_event with no amountSats", async () => {
    const C = "cmt-F4";
    const prev = vtxo({
      txid: "prev-F4",
      value: 500,
      settledBy: C,
      isSpent: true,
    });
    const leaf = leafVtxo(C, {
      txid: "leaf-F4",
      value: 500,
      createdAt: new Date(baseDate.getTime() + 1000),
    });

    const activities = await buildActivityHistory([prev, leaf], [], new Set());
    const renewal = activities.find((a) => a.id === `arkade:renewal:${C}`);

    expect(renewal).toBeDefined();
    expect(renewal?.kind).toBe("wallet_event");
    expect(renewal?.direction).toBe("self");
    expect(renewal?.title).toBe("VTXO renewed");
    expect(renewal?.amountSats).toBeUndefined();
    expect(renewal?.metadata).toMatchObject({
      commitmentTxid: C,
      inputCount: 1,
      outputCount: 1,
      renewedAmountSats: 500,
    });
    expect(renewal?.metadata).not.toHaveProperty("netDeltaSats");
  });

  // F-5 — renewal_plus_receive: two rows, batch carries mixedWithRenewal.
  it("F-5: renewal_plus_receive emits renewal + batch with mixed metadata", async () => {
    const C = "cmt-F5";
    const prev = vtxo({
      txid: "prev-F5",
      value: 500,
      settledBy: C,
      isSpent: true,
    });
    const leaf = leafVtxo(C, {
      txid: "leaf-F5",
      value: 800,
      createdAt: new Date(baseDate.getTime() + 1000),
    });

    const activities = await buildActivityHistory([prev, leaf], [], new Set());
    const renewal = activities.find((a) => a.id === `arkade:renewal:${C}`);
    const batch = activities.find((a) => a.id === `arkade:batch:${C}`);

    expect(renewal?.metadata).toMatchObject({
      renewedAmountSats: 500,
      netDeltaSats: 300,
    });
    expect(batch).toBeDefined();
    expect(batch?.amountSats).toBe(300);
    expect(batch?.title).toBe("Arkade received");
    expect(batch?.direction).toBe("in");
    expect(batch?.metadata).toMatchObject({
      mixedWithRenewal: true,
      netDeltaSats: 300,
    });
  });

  // F-6 — renewal_plus_exit: two rows, exit carries mixedWithRenewal +
  // negative netDeltaSats.
  it("F-6: renewal_plus_exit emits renewal + exit with mixed metadata", async () => {
    const C = "cmt-F6";
    const prev = vtxo({
      txid: "prev-F6",
      value: 1000,
      settledBy: C,
      isSpent: true,
    });
    const leaf = leafVtxo(C, {
      txid: "leaf-F6",
      value: 300,
      createdAt: new Date(baseDate.getTime() + 1000),
    });

    const activities = await buildActivityHistory([prev, leaf], [], new Set());
    const renewal = activities.find((a) => a.id === `arkade:renewal:${C}`);
    const exitRow = activities.find((a) => a.id === `arkade:exit:${C}`);

    expect(renewal?.metadata).toMatchObject({
      renewedAmountSats: 300,
      netDeltaSats: -700,
    });
    expect(exitRow).toBeDefined();
    expect(exitRow?.amountSats).toBe(700);
    expect(exitRow?.title).toBe("Collaborative exit");
    expect(exitRow?.direction).toBe("out");
    expect(exitRow?.metadata).toMatchObject({
      mixedWithRenewal: true,
      netDeltaSats: -700,
    });
  });

  // F-7 — Boarding-mixed renewal: cti contains commitment, created ≥
  // spent, no asset delta → renewal row only (leftover attributed to
  // boarding; no separate batch row).
  it("F-7: boarding-mixed renewal emits renewal but no batch row", async () => {
    const C = "cmt-F7";
    const prev = vtxo({
      txid: "prev-F7",
      value: 500,
      settledBy: C,
      isSpent: true,
    });
    const leaf = leafVtxo(C, {
      txid: "leaf-F7",
      value: 800, // 300 boarding-attributable
      createdAt: new Date(baseDate.getTime() + 1000),
    });

    const activities = await buildActivityHistory(
      [prev, leaf],
      [],
      new Set([C]),
    );

    expect(
      activities.find((a) => a.id === `arkade:renewal:${C}`),
    ).toBeDefined();
    expect(
      activities.find((a) => a.id === `arkade:batch:${C}`),
    ).toBeUndefined();
  });

  // F-8 — Boarding-mixed with asset delta: routes to settlement (info)
  // because branch 3 of decomposeCommitmentGroup never returns renewal
  // when there's an asset delta. Pin current behavior; asset info
  // currently lives only on the spent vtxo, not on the settlement row.
  it("F-8: boarding-mixed with asset delta → settlement info row", async () => {
    const C = "cmt-F8";
    const prev = vtxo({
      txid: "prev-F8",
      value: 1000,
      settledBy: C,
      isSpent: true,
      assets: [{ assetId: "A", amount: 50n }],
    });
    const leaf = leafVtxo(C, {
      txid: "leaf-F8",
      value: 1000,
      createdAt: new Date(baseDate.getTime() + 1000),
    });

    const activities = await buildActivityHistory(
      [prev, leaf],
      [],
      new Set([C]),
    );

    const settlement = activities.find(
      (a) => a.id === `arkade:settlement:${C}`,
    );
    expect(settlement).toBeDefined();
    expect(settlement?.kind).toBe("wallet_event");
    expect(settlement?.status).toBe("info");
    expect(settlement?.metadata).toMatchObject({
      settlementReason: "boarding_mixed_unresolved",
      spentAmount: 1000,
      createdAmount: 1000,
    });
    // No renewal, no batch.
    expect(
      activities.find((a) => a.id === `arkade:renewal:${C}`),
    ).toBeUndefined();
    expect(
      activities.find((a) => a.id === `arkade:batch:${C}`),
    ).toBeUndefined();
  });

  // F-9 — Empty inputs → no rows.
  it("F-9: empty inputs return an empty array", async () => {
    const activities = await buildActivityHistory([], [], new Set());
    expect(activities).toStrictEqual([]);
  });

  // F-10 — options.network propagation: stamped onto every row's
  // metadata when set, absent when null.
  it("F-10a: options.network is stamped onto row metadata", async () => {
    const received = vtxo({ txid: "recv-F10", value: 1000 });
    const activities = await buildActivityHistory(
      [received],
      [],
      new Set(),
      undefined,
      { network: "regtest" },
    );
    expect(activities[0].metadata?.network).toBe("regtest");
  });

  it("F-10b: options.network=null leaves metadata without a network key", async () => {
    const received = vtxo({ txid: "recv-F10b", value: 1000 });
    const activities = await buildActivityHistory(
      [received],
      [],
      new Set(),
      undefined,
      { network: null },
    );
    expect(activities[0].metadata).not.toHaveProperty("network");
  });

  // F-11 — Cross-cutting invariants on the largest real-world fixture
  // (case 0): unique ids, no amountSats on wallet_event rows, source
  // symmetry for wallet events.
  describe("F-11: invariants on case 0 fixture output", () => {
    let activities: Activity[];

    beforeAll(async () => {
      const fixtures = transactionHistoryRaw as unknown as Array<{
        vtxos: Array<Record<string, unknown>>;
        allBoardingTxs: Array<Record<string, unknown>>;
        commitmentsToIgnore: string[];
      }>;
      const c = fixtures[0];
      const vtxos = c.vtxos.map((v) => ({
        ...v,
        createdAt: new Date(v.createdAt as string),
      })) as unknown as VirtualCoin[];
      activities = await buildActivityHistory(
        vtxos,
        c.allBoardingTxs as unknown as ArkTransaction[],
        new Set(c.commitmentsToIgnore),
      );
    });

    it("I-3: no duplicate Activity ids", () => {
      const ids = activities.map((a) => a.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it("I-6: wallet_event rows never carry amountSats", () => {
      const offenders = activities
        .filter((a) => a.kind === "wallet_event")
        .filter((a) => typeof a.amountSats === "number")
        .map((a) => a.id);
      expect(offenders).toStrictEqual([]);
    });

    it("I-9: wallet_event rows satisfy source.eventId === id", () => {
      const offenders = activities
        .filter((a) => a.kind === "wallet_event")
        .filter(
          (a) => a.source.type !== "wallet_event" || a.source.eventId !== a.id,
        )
        .map((a) => a.id);
      expect(offenders).toStrictEqual([]);
    });
  });
});
