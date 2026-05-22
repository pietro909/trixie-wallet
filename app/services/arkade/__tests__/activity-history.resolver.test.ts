import type { VirtualCoin } from "@arkade-os/sdk";
import {
  buildActivityHistory,
  makeTimestampResolver,
} from "../activity-history";

// Direct tests for the timestamp resolver factory. We pass fake cache and
// indexer-loader dependencies so the behavior can be pinned without
// touching the Expo adapter or jest's dynamic-import path (which is
// brittle under jest-expo).

const indexerVtxo = (ts: number): { createdAt: Date } => ({
  createdAt: new Date(ts),
});

describe("makeTimestampResolver", () => {
  // E-2 — cached hit: loadIndexer must NOT be invoked.
  it("E-2: cache hit returns cached timestamp without loading the indexer", async () => {
    const loadIndexer = jest.fn(async () => {
      throw new Error("loadIndexer should not be called on a cache hit");
    });
    const resolver = makeTimestampResolver({
      getTimestamp: async () => 12345,
      saveTimestamp: jest.fn(),
      loadIndexer,
    });
    await expect(resolver("tx-A")).resolves.toBe(12345);
    expect(loadIndexer).not.toHaveBeenCalled();
  });

  // E-3 — one cache miss: loadIndexer invoked exactly once, returned
  // timestamp persisted.
  it("E-3: cache miss constructs the indexer once and persists the result", async () => {
    const loadIndexer = jest.fn(async () => ({
      getVtxos: jest.fn(async () => ({ vtxos: [indexerVtxo(7000)] })),
    }));
    const saveTimestamp = jest.fn(async () => undefined);
    const resolver = makeTimestampResolver({
      getTimestamp: async () => undefined,
      saveTimestamp,
      loadIndexer,
    });
    await expect(resolver("tx-A")).resolves.toBe(7000);
    expect(loadIndexer).toHaveBeenCalledTimes(1);
    expect(saveTimestamp).toHaveBeenCalledWith("tx-A", 7000);
  });

  // E-4 — multiple misses share the same indexer instance.
  it("E-4: multiple cache misses share one indexer instance", async () => {
    const getVtxos = jest
      .fn()
      .mockResolvedValueOnce({ vtxos: [indexerVtxo(100)] })
      .mockResolvedValueOnce({ vtxos: [indexerVtxo(200)] })
      .mockResolvedValueOnce({ vtxos: [indexerVtxo(300)] });
    const loadIndexer = jest.fn(async () => ({ getVtxos }));
    const resolver = makeTimestampResolver({
      getTimestamp: async () => undefined,
      saveTimestamp: jest.fn(),
      loadIndexer,
    });
    await expect(resolver("a")).resolves.toBe(100);
    await expect(resolver("b")).resolves.toBe(200);
    await expect(resolver("c")).resolves.toBe(300);
    expect(loadIndexer).toHaveBeenCalledTimes(1);
    expect(getVtxos).toHaveBeenCalledTimes(3);
  });

  // E-5 — indexer.getVtxos throws → resolver returns undefined and does
  // not persist.
  it("E-5: indexer failure resolves to undefined and does not save", async () => {
    const saveTimestamp = jest.fn(async () => undefined);
    const resolver = makeTimestampResolver({
      getTimestamp: async () => undefined,
      saveTimestamp,
      loadIndexer: async () => ({
        getVtxos: async () => {
          throw new Error("network down");
        },
      }),
    });
    await expect(resolver("tx-A")).resolves.toBeUndefined();
    expect(saveTimestamp).not.toHaveBeenCalled();
  });

  // E-6 — saveTimestamp is only invoked when the indexer returned a
  // value. An empty vtxos array → no save.
  it("E-6: no save when indexer returns an empty vtxos array", async () => {
    const saveTimestamp = jest.fn(async () => undefined);
    const resolver = makeTimestampResolver({
      getTimestamp: async () => undefined,
      saveTimestamp,
      loadIndexer: async () => ({
        getVtxos: async () => ({ vtxos: [] }),
      }),
    });
    await expect(resolver("tx-A")).resolves.toBeUndefined();
    expect(saveTimestamp).not.toHaveBeenCalled();
  });

  // E-7 — cache lookup throws → treated as miss, resolver still hits
  // the indexer and returns its value.
  it("E-7: a getTimestamp throw is treated as a miss and the indexer is consulted", async () => {
    const loadIndexer = jest.fn(async () => ({
      getVtxos: async () => ({ vtxos: [indexerVtxo(42)] }),
    }));
    const saveTimestamp = jest.fn(async () => undefined);
    const resolver = makeTimestampResolver({
      getTimestamp: async () => {
        throw new Error("cache boom");
      },
      saveTimestamp,
      loadIndexer,
    });
    await expect(resolver("tx-A")).resolves.toBe(42);
    expect(loadIndexer).toHaveBeenCalledTimes(1);
    expect(saveTimestamp).toHaveBeenCalledWith("tx-A", 42);
  });

  // E-8 — indexer construction (loadIndexer) failure: every subsequent
  // call sees the same null cache, never retrying.
  it("E-8: a loadIndexer failure is cached and not retried", async () => {
    const loadIndexer = jest.fn(async () => {
      throw new Error("can't construct");
    });
    const resolver = makeTimestampResolver({
      getTimestamp: async () => undefined,
      saveTimestamp: jest.fn(),
      loadIndexer,
    });
    await expect(resolver("a")).resolves.toBeUndefined();
    await expect(resolver("b")).resolves.toBeUndefined();
    expect(loadIndexer).toHaveBeenCalledTimes(1);
  });

  // E-9 — resolver passes the requested txid with `vout: 0` to the
  // indexer; this currently matches the recipient-VTXO convention used by
  // off-chain send timestamp recovery.
  it("E-9: resolver requests outpoint { txid, vout: 0 }", async () => {
    const getVtxos = jest.fn(async () => ({ vtxos: [indexerVtxo(1)] }));
    const resolver = makeTimestampResolver({
      getTimestamp: async () => undefined,
      saveTimestamp: jest.fn(),
      loadIndexer: async () => ({ getVtxos }),
    });
    await resolver("tx-Z");
    expect(getVtxos).toHaveBeenCalledWith({
      outpoints: [{ txid: "tx-Z", vout: 0 }],
    });
  });
});

// ===== Integration-shaped tests for the lazy load contract =====
//
// The factory is pure; these go through `buildActivityHistory` to pin
// the only contract that matters at the boundary: when the wallet has
// no no-change sends, the indexer must never be constructed.

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

describe("makeTimestampResolver — integration with buildActivityHistory", () => {
  // E-1a — wallet history with zero no-change sends: the resolver is
  // never invoked, so loadIndexer never fires either.
  it("E-1a: zero no-change sends ⇒ resolver and loadIndexer untouched", async () => {
    const received = vtxo({ txid: "recv-1", value: 1000 });
    const loadIndexer = jest.fn(async () => {
      throw new Error("indexer should not load");
    });
    const getTimestamp = jest.fn(async () => undefined);
    const saveTimestamp = jest.fn(async () => undefined);
    const resolver = makeTimestampResolver({
      getTimestamp,
      saveTimestamp,
      loadIndexer,
    });
    const out = await buildActivityHistory([received], [], new Set(), resolver);
    expect(out).toHaveLength(1);
    expect(loadIndexer).not.toHaveBeenCalled();
    expect(getTimestamp).not.toHaveBeenCalled();
  });

  // E-1b — no-change sends, but each timestamp is cached: indexer never
  // constructed.
  it("E-1b: cached timestamps for every no-change send ⇒ loadIndexer untouched", async () => {
    const arkTxId = "send-cached-tx";
    const spent = vtxo({
      txid: "spent-1",
      value: 1000,
      arkTxId,
      isSpent: true,
    });
    const loadIndexer = jest.fn(async () => {
      throw new Error("indexer should not load");
    });
    const resolver = makeTimestampResolver({
      getTimestamp: async (txid) =>
        txid === arkTxId ? baseDate.getTime() + 500 : undefined,
      saveTimestamp: jest.fn(),
      loadIndexer,
    });
    const out = await buildActivityHistory([spent], [], new Set(), resolver);
    const send = out.find((a) => a.id === `arkade:offchain:${arkTxId}`);
    expect(send?.timestamp).toBe(baseDate.getTime() + 500);
    expect(loadIndexer).not.toHaveBeenCalled();
  });

  // E-1c — one miss, but the row is reused from `previousActivities`:
  // the resolver short-circuits before the cache lookup runs.
  it("E-1c: confirmed reuse short-circuits before getTimestamp and loadIndexer", async () => {
    const arkTxId = "send-reused-tx";
    const spent = vtxo({
      txid: "spent-2",
      value: 1000,
      arkTxId,
      isSpent: true,
    });
    // First build, no reuse — populate cache and confirm a confirmed row.
    const firstResolver = makeTimestampResolver({
      getTimestamp: async () => undefined,
      saveTimestamp: jest.fn(),
      loadIndexer: async () => ({
        getVtxos: async () => ({
          vtxos: [indexerVtxo(baseDate.getTime() + 9)],
        }),
      }),
    });
    const firstRun = await buildActivityHistory(
      [spent],
      [],
      new Set(),
      firstResolver,
    );

    const getTimestamp = jest.fn(async () => undefined);
    const loadIndexer = jest.fn(async () => ({
      getVtxos: async () => {
        throw new Error("should not reach indexer");
      },
    }));
    const resolver = makeTimestampResolver({
      getTimestamp,
      saveTimestamp: jest.fn(),
      loadIndexer,
    });
    await buildActivityHistory([spent], [], new Set(), resolver, {
      network: null,
      previousActivities: firstRun,
    });
    expect(getTimestamp).not.toHaveBeenCalled();
    expect(loadIndexer).not.toHaveBeenCalled();
  });
});
