import type { VirtualCoin } from "@arkade-os/sdk";
import type { Activity } from "../../../store/types";
import { buildActivityHistory } from "../activity-history";

// Tests for the `previousActivities` reuse path added in Milestone 13
// (commit 954dc84). Confirmed Arkade rows are terminal — the builder
// should reuse them verbatim and (for no-change BTC sends) short-circuit
// the `getTxCreatedAt` indexer call.

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

describe("buildActivityHistory — previousActivities reuse path", () => {
  // C-1 — The marquee perf claim of Milestone 13: a no-change BTC send
  // is the hottest cache target because its timestamp requires a network
  // call to the indexer. Reuse must short-circuit BEFORE that call.
  it("C-1: no-change BTC send is reused and getTxCreatedAt is not called on reuse", async () => {
    const arkTxId = "no-change-send-tx";
    const spent = vtxo({
      txid: "spent-vtxo-1",
      value: 1000,
      arkTxId,
      isSpent: true,
      createdAt: baseDate,
    });

    const firstSpy = jest.fn(
      async (_txid: string): Promise<number | undefined> =>
        baseDate.getTime() + 5000,
    );
    const firstRun = await buildActivityHistory(
      [spent],
      [],
      new Set(),
      firstSpy,
    );
    expect(firstSpy).toHaveBeenCalledTimes(1);
    expect(firstSpy).toHaveBeenCalledWith(arkTxId);

    const sendId = `arkade:offchain:${arkTxId}`;
    const sendRow = firstRun.find((a) => a.id === sendId);
    expect(sendRow).toBeDefined();
    expect(sendRow?.status).toBe("confirmed");

    const secondSpy = jest.fn(async (): Promise<number | undefined> => {
      throw new Error("getTxCreatedAt should not be called for reused rows");
    });
    const secondRun = await buildActivityHistory(
      [spent],
      [],
      new Set(),
      secondSpy,
      { network: null, previousActivities: firstRun },
    );
    expect(secondSpy).not.toHaveBeenCalled();
    // Reused row is the same reference — the builder pushes the prior
    // row as-is rather than rebuilding a structurally equal copy.
    expect(secondRun.find((a) => a.id === sendId)).toBe(sendRow);
  });

  // C-2 — Vanilla offchain receive. Tamper the prior row's title to
  // distinguish "reused" from "structurally equal recomputed".
  it("C-2: confirmed offchain receive is reused verbatim", async () => {
    const txid = "recv-only-tx";
    const received = vtxo({ txid, value: 1000, createdAt: baseDate });

    const firstRun = await buildActivityHistory([received], [], new Set());
    expect(firstRun).toHaveLength(1);
    expect(firstRun[0].id).toBe(`arkade:offchain:${txid}`);
    expect(firstRun[0].status).toBe("confirmed");

    const tampered: Activity = { ...firstRun[0], title: "REUSED-MARKER" };
    const secondRun = await buildActivityHistory(
      [received],
      [],
      new Set(),
      undefined,
      { network: null, previousActivities: [tampered] },
    );
    expect(secondRun).toHaveLength(1);
    expect(secondRun[0]).toBe(tampered);
    expect(secondRun[0].title).toBe("REUSED-MARKER");
  });

  // C-3 — The `arkade:asset:<arkTxId>` reuse branch on the send side
  // (line 866: `hasAssets ? "asset" : "offchain"`). Asset sends never
  // touch the indexer in the second run.
  it("C-3: confirmed asset send is reused with the arkade:asset:<txid> id", async () => {
    const arkTxId = "asset-send-tx";
    const spent = vtxo({
      txid: "spent-vtxo-asset",
      value: 1000,
      arkTxId,
      isSpent: true,
      createdAt: baseDate,
      assets: [{ assetId: "A", amount: 40n }],
    });

    const firstRun = await buildActivityHistory([spent], [], new Set());
    const sendId = `arkade:asset:${arkTxId}`;
    const sendRow = firstRun.find((a) => a.id === sendId);
    expect(sendRow).toBeDefined();
    expect(sendRow?.status).toBe("confirmed");

    const tamperedSend: Activity = {
      ...(sendRow as Activity),
      title: "REUSED-ASSET-SEND",
    };
    const previousActivities = firstRun.map((a) =>
      a.id === sendId ? tamperedSend : a,
    );

    const indexerSpy = jest.fn(async () => baseDate.getTime() + 99);
    const secondRun = await buildActivityHistory(
      [spent],
      [],
      new Set(),
      indexerSpy,
      { network: null, previousActivities },
    );
    expect(secondRun.find((a) => a.id === sendId)?.title).toBe(
      "REUSED-ASSET-SEND",
    );
    expect(indexerSpy).not.toHaveBeenCalled();
  });

  // C-4 — The reuse gate is `a.status === "confirmed"`. Every other
  // status must be recomputed so pending rows can transition and info /
  // failed / refunded rows can't shadow a current-state row.
  it.each([
    "pending",
    "info",
    "failed",
    "refunded",
  ] as const)("C-4: prior rows with status=%s are not reused", async (status) => {
    const txid = "recv-c4-tx";
    const received = vtxo({ txid, value: 1000, createdAt: baseDate });
    const ghostId = `arkade:offchain:${txid}`;
    const tampered: Activity = {
      id: ghostId,
      kind: "payment",
      direction: "in",
      amountSats: 999_999_999,
      timestamp: 0,
      title: "TAMPERED",
      status,
      rail: "arkade",
      source: { type: "arkade_tx", walletTxId: txid },
    };

    const result = await buildActivityHistory(
      [received],
      [],
      new Set(),
      undefined,
      { network: null, previousActivities: [tampered] },
    );
    const row = result.find((a) => a.id === ghostId);
    expect(row).toBeDefined();
    expect(row?.title).not.toBe("TAMPERED");
    expect(row?.amountSats).toBe(1000);
    expect(row?.status).toBe("confirmed");
  });

  // C-6 — `previousActivities` is a lookup keyed on ids the current vtxo
  // set would emit; it must not be an emission source. Otherwise stale
  // rows would resurrect after the underlying state moves on.
  it("C-6: stale prior rows with no matching vtxo are not emitted", async () => {
    const ghost: Activity = {
      id: "arkade:offchain:ghost-txid",
      kind: "payment",
      direction: "in",
      amountSats: 12345,
      timestamp: 1,
      title: "GHOST",
      status: "confirmed",
      rail: "arkade",
      source: { type: "arkade_tx", walletTxId: "ghost-txid" },
    };
    const result = await buildActivityHistory([], [], new Set(), undefined, {
      network: null,
      previousActivities: [ghost],
    });
    expect(result).toEqual([]);
  });

  // C-7 — Defensive: passing `undefined` or `[]` for previousActivities
  // is equivalent to the no-cache build path. (No reuse, no throw.)
  it("C-7: undefined and empty previousActivities behave identically", async () => {
    const received = vtxo({
      txid: "tx-c7",
      value: 1000,
      createdAt: baseDate,
    });
    const undef = await buildActivityHistory(
      [received],
      [],
      new Set(),
      undefined,
      { network: null },
    );
    const empty = await buildActivityHistory(
      [received],
      [],
      new Set(),
      undefined,
      { network: null, previousActivities: [] },
    );
    expect(undef).toHaveLength(1);
    expect(empty).toHaveLength(1);
    expect(undef[0].id).toBe(empty[0].id);
    expect(undef[0].title).toBe(empty[0].title);
  });

  // C-8 — Asset receive reuse: when `collectAssets` finds an asset
  // delta, the builder must short-circuit before constructing the
  // asset row.
  it("C-8: confirmed asset receive is reused verbatim", async () => {
    const txid = "asset-recv-tx";
    // `settled = v.status.isLeaf || v.isSpent === true` inside the
    // offchain-receive branch; set `isSpent` so the asset row is
    // emitted as confirmed without taking the leaf path (which would
    // route through the per-commitment loop).
    const received = vtxo({
      txid,
      value: 1000,
      createdAt: baseDate,
      isSpent: true,
      assets: [{ assetId: "A", amount: 50n }],
    });
    const firstRun = await buildActivityHistory([received], [], new Set());
    const assetRow = firstRun.find(
      (a) => a.id === `arkade:asset:${txid}`,
    ) as Activity;
    expect(assetRow.status).toBe("confirmed");

    const tampered: Activity = { ...assetRow, title: "REUSED-ASSET-RECV" };
    const secondRun = await buildActivityHistory(
      [received],
      [],
      new Set(),
      undefined,
      { network: null, previousActivities: [tampered] },
    );
    const after = secondRun.find((a) => a.id === `arkade:asset:${txid}`);
    expect(after).toBe(tampered);
    expect(after?.title).toBe("REUSED-ASSET-RECV");
  });

  // C-9 — Representative all-confirmed history: when every emitted row
  // is `confirmed` and `previousActivities` carries them, the resolver
  // is never invoked AND each reused row is the same object reference
  // (not just a structurally equal recomputation).
  //
  // Builder rule for the offchain branches: BTC receive is always
  // confirmed (DIV-3a), but asset receive carries
  // `settled = v.status.isLeaf || v.isSpent === true`. So every fixture
  // here must take one of those paths to qualify for reuse.
  it("C-9: all-confirmed reuse never invokes getTxCreatedAt across mixed branches", async () => {
    const arkTxId = "send-c9-tx";
    const send = vtxo({
      txid: "spent-c9",
      value: 1500,
      arkTxId,
      isSpent: true,
    });
    const recv = vtxo({
      txid: "recv-c9",
      value: 700,
      createdAt: new Date(baseDate.getTime() + 200),
    });
    // `isSpent: true` flips the asset receive's `settled` flag without
    // routing the vtxo into the per-commitment loop (which would need
    // `isLeaf + commitmentTxIds`).
    const assetRecv = vtxo({
      txid: "asset-recv-c9",
      value: 800,
      createdAt: new Date(baseDate.getTime() + 400),
      isSpent: true,
      assets: [{ assetId: "A", amount: 25n }],
    });

    const seed = jest.fn(async () => baseDate.getTime() + 12);
    const firstRun = await buildActivityHistory(
      [send, recv, assetRecv],
      [],
      new Set(),
      seed,
    );
    // Sanity: seed was used for the no-change send, and every emitted
    // row is `confirmed` so the reuse path actually applies.
    expect(seed).toHaveBeenCalled();
    expect(firstRun.every((a) => a.status === "confirmed")).toBe(true);
    // A spent vtxo that also has a `txid` not registered as anyone's
    // `arkTxId` still surfaces as an offchain receive of its original
    // incoming value — that's the "split vtxo" behavior pinned by D-1.
    const expectedIds = new Set([
      `arkade:offchain:${send.txid}`,
      `arkade:offchain:${arkTxId}`,
      `arkade:offchain:${recv.txid}`,
      `arkade:asset:${assetRecv.txid}`,
    ]);
    expect(new Set(firstRun.map((a) => a.id))).toStrictEqual(expectedIds);

    const reusedAll = jest.fn(async () => {
      throw new Error("reuse should bypass timestamp resolution");
    });
    const secondRun = await buildActivityHistory(
      [send, recv, assetRecv],
      [],
      new Set(),
      reusedAll,
      { network: null, previousActivities: firstRun },
    );
    expect(reusedAll).not.toHaveBeenCalled();
    // Strong reuse check: every emitted row is the SAME reference as
    // its match in firstRun, not a structurally-equal rebuild.
    const firstById = new Map(firstRun.map((a) => [a.id, a]));
    for (const a of secondRun) expect(a).toBe(firstById.get(a.id));
    expect(new Set(secondRun.map((a) => a.id))).toStrictEqual(expectedIds);
  });

  // C-10 — Source-type mismatch documentation. The current builder
  // looks up reuse rows by `id` only; it does not validate that the
  // prior row's `source.type` matches what the current branch would
  // emit. If the prior row's id collides with what the current branch
  // computes, it WILL be reused even if the prior source disagrees.
  // Pin that behavior here so a future tightening surfaces in this
  // test. See ISSUE_ACTIVITY_HISTORY_CLEANUP.md test D-8.
  it("C-10: same id reused regardless of prior source.type (pinned current behavior)", async () => {
    const txid = "tx-c10";
    const received = vtxo({ txid, value: 1000, createdAt: baseDate });

    // Prior row claims the same id but with a wallet_event source — the
    // current builder would emit a payment / arkade_tx source for this
    // input set.
    const ghost: Activity = {
      id: `arkade:offchain:${txid}`,
      kind: "wallet_event",
      direction: "self",
      timestamp: 0,
      title: "GHOST-WALLET-EVENT",
      status: "confirmed",
      rail: "arkade",
      source: {
        type: "wallet_event",
        eventId: `arkade:offchain:${txid}`,
      },
    };

    const result = await buildActivityHistory(
      [received],
      [],
      new Set(),
      undefined,
      { network: null, previousActivities: [ghost] },
    );
    const row = result.find((a) => a.id === `arkade:offchain:${txid}`);
    // Pinned current behavior: ghost is reused as-is.
    expect(row).toBe(ghost);
  });
});
