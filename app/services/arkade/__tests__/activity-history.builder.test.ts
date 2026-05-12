import type { VirtualCoin } from "@arkade-os/sdk";
import type { Activity } from "../../../store/types";
import { buildActivityHistory } from "../activity-history";

// Mirrors ts-sdk/test/transactionHistory.test.ts: synthetic inputs to the
// pure builder, asserting our renamed Activity rows per spec §9.1.

const vtxo = (over: Partial<VirtualCoin> = {}): VirtualCoin =>
  ({
    txid: "x",
    vout: 0,
    value: 0,
    status: { confirmed: false },
    virtualStatus: { state: "preconfirmed" },
    createdAt: new Date(0),
    isUnrolled: false,
    isSpent: false,
    ...over,
  }) as VirtualCoin;

const sortById = (xs: Activity[]): Activity[] =>
  [...xs].sort((a, b) => a.id.localeCompare(b.id));

const baseDate = new Date("2026-05-12T12:00:00Z");

describe("buildActivityHistory — synthetic builder cases (mirrors SDK)", () => {
  // D-1 — Split-vtxo bug: 1000-sat spent into 2x 500, only one returned
  // as change. Expect 1 send (500) + 1 receive (1000, the prior receive
  // of the original vtxo).
  it("D-1: split vtxo produces one send and one receive", async () => {
    const arkTxId = "split-ark-tx";
    const spentVtxo = vtxo({
      txid: "original-vtxo",
      value: 1000,
      arkTxId,
      isSpent: true,
      createdAt: baseDate,
    });
    const resultVtxo0 = vtxo({
      txid: arkTxId,
      value: 500,
      createdAt: new Date(baseDate.getTime() + 1000),
    });

    const activities = await buildActivityHistory(
      [resultVtxo0, spentVtxo],
      [],
      new Set(),
    );

    const sends = activities.filter((a) => a.direction === "out");
    const receives = activities.filter((a) => a.direction === "in");

    expect(sends).toHaveLength(1);
    expect(receives).toHaveLength(1);
    expect(sends[0]).toMatchObject({
      id: `arkade:offchain:${arkTxId}`,
      amountSats: 500,
      title: "Arkade sent",
    });
    expect(receives[0]).toMatchObject({
      id: "arkade:offchain:original-vtxo",
      amountSats: 1000,
      title: "Arkade received",
    });
  });

  // D-2 — Simple receive: a single preconfirmed vtxo, no spent inputs.
  it("D-2: single new vtxo produces one offchain receive", async () => {
    const arkTxId = "recv-ark-tx";
    const received = vtxo({ txid: arkTxId, value: 1000, createdAt: baseDate });

    const activities = await buildActivityHistory([received], [], new Set());

    expect(activities).toHaveLength(1);
    expect(activities[0]).toMatchObject({
      id: `arkade:offchain:${arkTxId}`,
      kind: "payment",
      direction: "in",
      amountSats: 1000,
      title: "Arkade received",
      status: "confirmed",
    });
    expect(activities[0].assets).toBeUndefined();
  });

  // D-3 — Offchain receive with assets routes to an asset row, not a
  // plain offchain row.
  it("D-3: offchain receive with assets emits an asset row", async () => {
    const arkTxId = "asset-recv-ark-tx";
    const received = vtxo({
      txid: arkTxId,
      value: 1000,
      createdAt: baseDate,
      assets: [{ assetId: "A", amount: 50n }],
    });

    const activities = await buildActivityHistory([received], [], new Set());

    expect(activities).toHaveLength(1);
    const row = activities[0];
    expect(row.id).toBe(`arkade:asset:${arkTxId}`);
    expect(row.kind).toBe("wallet_event");
    expect(row.direction).toBe("in");
    expect(row.title).toBe("Asset received");
    // Post B.5 D-2 fix: preconfirmed asset receives are pending.
    expect(row.status).toBe("pending");
    expect(row.amountSats).toBeUndefined();
    expect(row.assets).toStrictEqual([{ assetId: "A", amount: "50" }]);
    expect(row.metadata).toMatchObject({
      arkTxid: arkTxId,
      classification: "asset_received",
      anchorAmountSats: 1000,
    });
  });

  // D-4 — Plain receive (no assets) omits the assets property entirely.
  it("D-4: plain receive does not set the assets property", async () => {
    const received = vtxo({
      txid: "no-asset-tx",
      value: 500,
      createdAt: baseDate,
    });

    const activities = await buildActivityHistory([received], [], new Set());

    expect(activities).toHaveLength(1);
    expect("assets" in activities[0]).toBe(false);
  });

  // D-5 — Offchain send with change + assets: emit one asset row (no
  // plain offchain send), anchor = spent − change.
  it("D-5: offchain send with change carries negative asset delta", async () => {
    const arkTxId = "asset-send-ark-tx";
    const spent = vtxo({
      txid: "spent-vtxo-1",
      value: 1000,
      arkTxId,
      isSpent: true,
      createdAt: baseDate,
      assets: [{ assetId: "A", amount: 100n }],
    });
    const change = vtxo({
      txid: arkTxId,
      value: 400,
      createdAt: new Date(baseDate.getTime() + 1000),
      assets: [{ assetId: "A", amount: 30n }],
    });

    const activities = await buildActivityHistory(
      [spent, change],
      [],
      new Set(),
    );
    const sends = activities.filter((a) => a.id === `arkade:asset:${arkTxId}`);

    expect(sends).toHaveLength(1);
    expect(sends[0].assets).toStrictEqual([{ assetId: "A", amount: "-70" }]);
    expect(sends[0].metadata?.anchorAmountSats).toBe(600);
    expect(sends[0].metadata?.classification).toBe("asset_sent");
    expect(sends[0].status).toBe("confirmed");
    expect(sends[0].direction).toBe("out");
  });

  // D-6 — When asset delta cancels to zero, emit a plain BTC offchain
  // send and no asset row.
  it("D-6: zero net asset delta falls through to BTC-only send", async () => {
    const arkTxId = "no-asset-delta-tx";
    const spent = vtxo({
      txid: "spent-vtxo-2",
      value: 1000,
      arkTxId,
      isSpent: true,
      createdAt: baseDate,
      assets: [{ assetId: "A", amount: 50n }],
    });
    const change = vtxo({
      txid: arkTxId,
      value: 400,
      createdAt: new Date(baseDate.getTime() + 1000),
      assets: [{ assetId: "A", amount: 50n }],
    });

    const activities = await buildActivityHistory(
      [spent, change],
      [],
      new Set(),
    );
    const sends = activities.filter((a) => a.direction === "out");

    expect(sends).toHaveLength(1);
    expect(sends[0].id).toBe(`arkade:offchain:${arkTxId}`);
    expect(sends[0].amountSats).toBe(600);
    expect(sends[0].title).toBe("Arkade sent");
    expect("assets" in sends[0]).toBe(false);
  });

  // D-7 — Send without change carries the full asset delta and anchor =
  // total spent.
  it("D-7: send without change collects spent assets as negative delta", async () => {
    const arkTxId = "no-change-asset-tx";
    const spent = vtxo({
      txid: "spent-vtxo-3",
      value: 1000,
      arkTxId,
      isSpent: true,
      createdAt: baseDate,
      assets: [
        { assetId: "A", amount: 40n },
        { assetId: "B", amount: 60n },
      ],
    });

    const activities = await buildActivityHistory([spent], [], new Set());
    const sends = activities.filter((a) => a.id === `arkade:asset:${arkTxId}`);

    expect(sends).toHaveLength(1);
    expect(sends[0].assets).toStrictEqual([
      { assetId: "A", amount: "-40" },
      { assetId: "B", amount: "-60" },
    ]);
    expect(sends[0].metadata?.anchorAmountSats).toBe(1000);
    expect(sends[0].metadata?.classification).toBe("asset_sent");
  });

  // D-8 — DIV-8: exit with change + assets should emit `exit` plus an
  // asset row. Currently routes to the `settlement` fallback. Marked
  // .failing — flips green when Phase G lands.
  it("D-8: exit with change + assets produces exit + asset rows", async () => {
    const commitmentTxId = "exit-cmt-with-change";
    const forfeit = vtxo({
      txid: "forfeit-1",
      value: 2000,
      settledBy: commitmentTxId,
      isSpent: true,
      createdAt: baseDate,
      assets: [{ assetId: "A", amount: 80n }],
    });
    const change = vtxo({
      txid: "change-leaf",
      value: 500,
      status: { confirmed: true, isLeaf: true },
      virtualStatus: { state: "settled", commitmentTxIds: [commitmentTxId] },
      createdAt: new Date(baseDate.getTime() + 1000),
      assets: [{ assetId: "A", amount: 20n }],
    });

    const activities = await buildActivityHistory(
      [forfeit, change],
      [],
      new Set(),
    );
    const exitRow = activities.find(
      (a) => a.id === `arkade:exit:${commitmentTxId}`,
    );
    expect(exitRow).toBeDefined();
    expect(exitRow?.amountSats).toBe(1500);
    // After Phase G: asset row sits alongside the exit row.
    const assetRow = activities.find(
      (a) => a.id === `arkade:asset:${commitmentTxId}`,
    );
    expect(assetRow?.assets).toStrictEqual([{ assetId: "A", amount: "-60" }]);
  });

  // D-9 — DIV-8: exit without change + assets. Same routing bug as D-8.
  it("D-9: exit without change + assets produces exit + asset rows", async () => {
    const commitmentTxId = "exit-cmt-no-change";
    const forfeit = vtxo({
      txid: "forfeit-2",
      value: 1000,
      settledBy: commitmentTxId,
      isSpent: true,
      createdAt: baseDate,
      assets: [{ assetId: "B", amount: 75n }],
    });

    const activities = await buildActivityHistory([forfeit], [], new Set());
    const exitRow = activities.find(
      (a) => a.id === `arkade:exit:${commitmentTxId}`,
    );
    expect(exitRow).toBeDefined();
    expect(exitRow?.amountSats).toBe(1000);
    const assetRow = activities.find(
      (a) => a.id === `arkade:asset:${commitmentTxId}`,
    );
    expect(assetRow?.assets).toStrictEqual([{ assetId: "B", amount: "-75" }]);
  });

  // D-10 — Issuance: self-send (spent → change-of-self), zero anchor,
  // positive asset delta on change → asset_issued, direction "self".
  it("D-10: issuance produces an asset_issued wallet event", async () => {
    const arkTxId = "issuance-ark-tx";
    const spent = vtxo({
      txid: "spent-issuance",
      value: 1000,
      arkTxId,
      isSpent: true,
      createdAt: baseDate,
    });
    const change = vtxo({
      txid: arkTxId,
      value: 1000,
      createdAt: new Date(baseDate.getTime() + 1000),
      assets: [{ assetId: "A", amount: 100n }],
    });

    const activities = await buildActivityHistory(
      [spent, change],
      [],
      new Set(),
    );
    const issued = activities.find((a) => a.id === `arkade:asset:${arkTxId}`);

    expect(issued).toBeDefined();
    expect(issued?.title).toBe("Asset issued");
    expect(issued?.direction).toBe("self");
    expect(issued?.amountSats).toBeUndefined();
    expect(issued?.assets).toStrictEqual([{ assetId: "A", amount: "100" }]);
    expect(issued?.metadata?.classification).toBe("asset_issued");
    expect(issued?.metadata?.anchorAmountSats).toBe(0);
  });

  // D-11 — Reissuance: existing asset balance increases (50 → 150), so
  // net delta is +100 against zero BTC anchor.
  it("D-11: reissuance (+100 net on existing asset) is asset_issued", async () => {
    const arkTxId = "reissuance-ark-tx";
    const spent = vtxo({
      txid: "spent-reissuance",
      value: 1000,
      arkTxId,
      isSpent: true,
      createdAt: baseDate,
      assets: [{ assetId: "A", amount: 50n }],
    });
    const change = vtxo({
      txid: arkTxId,
      value: 1000,
      createdAt: new Date(baseDate.getTime() + 1000),
      assets: [{ assetId: "A", amount: 150n }],
    });

    const activities = await buildActivityHistory(
      [spent, change],
      [],
      new Set(),
    );
    const row = activities.find((a) => a.id === `arkade:asset:${arkTxId}`);

    expect(row?.title).toBe("Asset issued");
    expect(row?.assets).toStrictEqual([{ assetId: "A", amount: "100" }]);
  });

  // D-12 — Burn: spent has assets, change has none (fully burned), zero
  // BTC delta → asset_burned.
  it("D-12: burn produces an asset_burned wallet event", async () => {
    const arkTxId = "burn-ark-tx";
    const spent = vtxo({
      txid: "spent-burn",
      value: 1000,
      arkTxId,
      isSpent: true,
      createdAt: baseDate,
      assets: [{ assetId: "A", amount: 100n }],
    });
    const change = vtxo({
      txid: arkTxId,
      value: 1000,
      createdAt: new Date(baseDate.getTime() + 1000),
    });

    const activities = await buildActivityHistory(
      [spent, change],
      [],
      new Set(),
    );
    const burned = activities.find((a) => a.id === `arkade:asset:${arkTxId}`);

    expect(burned?.title).toBe("Asset burned");
    expect(burned?.direction).toBe("self");
    expect(burned?.assets).toStrictEqual([{ assetId: "A", amount: "-100" }]);
    expect(burned?.metadata?.classification).toBe("asset_burned");
  });

  // D-13 — Mixed burn + issuance + transfer in one tx → mixed-sign
  // delta, anchor > 0 → asset_activity fallback.
  it("D-13: mixed-sign asset delta with anchor>0 → asset_activity", async () => {
    const arkTxId = "mixed-ark-tx";
    const spent = vtxo({
      txid: "spent-mixed",
      value: 1000,
      arkTxId,
      isSpent: true,
      createdAt: baseDate,
      assets: [
        { assetId: "A", amount: 50n }, // burned
        { assetId: "B", amount: 80n }, // partially transferred
      ],
    });
    const change = vtxo({
      txid: arkTxId,
      value: 500,
      createdAt: new Date(baseDate.getTime() + 1000),
      assets: [
        { assetId: "B", amount: 50n }, // kept 50/80
        { assetId: "C", amount: 200n }, // newly issued
      ],
    });

    const activities = await buildActivityHistory(
      [spent, change],
      [],
      new Set(),
    );
    const row = activities.find((a) => a.id === `arkade:asset:${arkTxId}`);

    expect(row?.title).toBe("Asset activity");
    expect(row?.metadata?.classification).toBe("asset_activity");
    expect(row?.metadata?.anchorAmountSats).toBe(500);
    // Iteration order: received side first (B:50, C:200), then spent side
    // mutates B (-30) and adds A (-50).
    expect(row?.assets).toStrictEqual([
      { assetId: "B", amount: "-30" },
      { assetId: "C", amount: "200" },
      { assetId: "A", amount: "-50" },
    ]);
  });

  // D-14 — Two spent vtxos sharing the same arkTxId aggregate into one
  // sent row.
  it("D-14: multiple spent vtxos with the same arkTxId aggregate", async () => {
    const arkTxId = "multi-spent-ark-tx";
    const v1 = vtxo({
      txid: "multi-spent-1",
      value: 500,
      arkTxId,
      isSpent: true,
      createdAt: baseDate,
      assets: [{ assetId: "A", amount: 30n }],
    });
    const v2 = vtxo({
      txid: "multi-spent-2",
      value: 500,
      arkTxId,
      isSpent: true,
      createdAt: new Date(baseDate.getTime() + 100),
      assets: [
        { assetId: "A", amount: 20n },
        { assetId: "B", amount: 10n },
      ],
    });

    const activities = await buildActivityHistory([v1, v2], [], new Set());
    const sends = activities.filter((a) => a.id === `arkade:asset:${arkTxId}`);

    expect(sends).toHaveLength(1);
    expect(sends[0].title).toBe("Asset sent");
    expect(sends[0].metadata?.anchorAmountSats).toBe(1000);
    expect(sortById([sends[0]])[0].assets).toStrictEqual([
      { assetId: "A", amount: "-50" },
      { assetId: "B", amount: "-10" },
    ]);
  });
});
