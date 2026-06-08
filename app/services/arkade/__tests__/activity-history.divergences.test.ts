import type { VirtualCoin } from "@arkade-os/sdk";
import { buildActivityHistory } from "../activity-history";

// Phase H — divergences from the SDK we have intentionally left in
// place. Each test pins current behavior so future refactors trigger a
// red signal if the divergence is removed silently. See
// docs/ACTIVITY_HISTORY.specs.md §9.3 for context.

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

describe("Phase H — pinned divergences", () => {
  // DIV-2 — Multi-leaf per commitment.
  //
  // SDK behavior: one `(RECEIVED, batch)` row per leaf, each row keyed
  // by its own leaf's commitmentTxIds[0] (so duplicates collide; SDK
  // emits them anyway).
  //
  // Our behavior: per-commitment grouping collapses N leaves into ONE
  // `arkade:batch:<commitmentTxid>` row with `amountSats = sum(values)`.
  // The collapsed form is arguably better UX (fewer redundant rows for
  // one batch event), and total value is preserved. Listed as a known
  // divergence for visibility.
  //
  // TODO(DIV-2): revisit if SDK semantics evolve or if the user-facing
  // detail view needs per-leaf granularity. See spec §9.3 DIV-2.
  it("DIV-2: multi-leaf per commitment collapses to one batch row", async () => {
    const C = "cmt-DIV2";
    const leaf1 = leafVtxo(C, { txid: "leaf-A", value: 500 });
    const leaf2 = leafVtxo(C, {
      txid: "leaf-B",
      value: 300,
      createdAt: new Date(baseDate.getTime() + 1000),
    });

    const activities = await buildActivityHistory(
      [leaf1, leaf2],
      [],
      new Set(),
    );

    const batchRows = activities.filter((a) => a.id === `arkade:batch:${C}`);
    expect(batchRows).toHaveLength(1);
    expect(batchRows[0].amountSats).toBe(800);
  });

  // DIV-3 — Status of BTC offchain receives.
  //
  // SDK behavior: `settled = v.status.isLeaf || v.isSpent` for vtxo-
  // derived received rows, so a preconfirmed leafless un-spent receive
  // would carry `settled: false`.
  //
  // Our behavior: BTC offchain receives are emitted as `status:
  // "confirmed"` unconditionally. This is *intentional* — per commit
  // 94b4a34, Arkade's preconfirmed state is the wallet's fast-finality
  // promise and the user considers funds spendable.
  //
  // Asset-bearing Arkade receives follow the same app policy and are pinned in
  // builder case D-3.
  //
  // Pinning here so a future "make everything reflect SDK settled" refactor
  // surfaces the conflict.
  it("DIV-3a: preconfirmed BTC offchain receive is 'confirmed' (not 'pending')", async () => {
    const received = vtxo({ txid: "preconf-recv", value: 1000 });

    const activities = await buildActivityHistory([received], [], new Set());

    expect(activities).toHaveLength(1);
    expect(activities[0].kind).toBe("payment");
    expect(activities[0].status).toBe("confirmed");
  });

  it("DIV-3b: leaf BTC offchain receive is 'confirmed' too (no divergence on that path)", async () => {
    // Leaf vtxos with a commitment go through the per-commitment loop,
    // not the offchain branch. Their status is 'confirmed' for a
    // different reason (commitments are final), so this test pins the
    // same outcome for a different code path.
    const received = leafVtxo("cmt-leaf", {
      txid: "leaf-recv",
      value: 1000,
    });

    const activities = await buildActivityHistory([received], [], new Set());

    const batch = activities.find((a) => a.id === "arkade:batch:cmt-leaf");
    expect(batch?.status).toBe("confirmed");
  });
});
