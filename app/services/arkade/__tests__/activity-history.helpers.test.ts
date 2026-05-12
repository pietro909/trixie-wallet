import type { VirtualCoin } from "@arkade-os/sdk";
import {
  activityId,
  assetDeltas,
  classifyAssetActivity,
  collectAssets,
  decomposeCommitmentGroup,
  isRenewalGroup,
  subtractAssets,
  sumValue,
} from "../activity-history";

// Minimal VirtualCoin factory — only the fields the helpers read.
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

const sortByAssetId = <T extends { assetId: string }>(xs: T[]): T[] =>
  [...xs].sort((a, b) => a.assetId.localeCompare(b.assetId));

describe("activityId", () => {
  it("concatenates kind and idValue", () => {
    expect(activityId("offchain", "abc")).toBe("arkade:offchain:abc");
    expect(activityId("boarding", "deadbeef")).toBe("arkade:boarding:deadbeef");
    expect(activityId("renewal", "cmt")).toBe("arkade:renewal:cmt");
  });

  it("accepts empty idValue without throwing", () => {
    expect(activityId("settlement", "")).toBe("arkade:settlement:");
  });
});

describe("sumValue", () => {
  it("returns 0n for an empty array", () => {
    expect(sumValue([])).toBe(0n);
  });

  it("returns the value of a single vtxo as bigint", () => {
    expect(sumValue([vtxo({ value: 500 })])).toBe(500n);
  });

  it("sums multiple values", () => {
    expect(
      sumValue([
        vtxo({ value: 100 }),
        vtxo({ value: 250 }),
        vtxo({ value: 1 }),
      ]),
    ).toBe(351n);
  });

  it("promotes numeric value to bigint without overflow on large sums", () => {
    // 2^32-ish range, well above Number safe but below MAX_SAFE_INTEGER.
    const big = [
      vtxo({ value: 2_000_000_000 }),
      vtxo({ value: 2_000_000_000 }),
    ];
    expect(sumValue(big)).toBe(4_000_000_000n);
  });
});

describe("collectAssets", () => {
  it("returns [] when no vtxos carry assets", () => {
    expect(collectAssets([vtxo(), vtxo({ value: 100 })])).toStrictEqual([]);
  });

  it("returns [] for an empty input", () => {
    expect(collectAssets([])).toStrictEqual([]);
  });

  it("skips vtxos with undefined assets", () => {
    const withAsset = vtxo({ assets: [{ assetId: "A", amount: 10n }] });
    expect(collectAssets([vtxo(), withAsset, vtxo()])).toStrictEqual([
      { assetId: "A", amount: 10n },
    ]);
  });

  it("aggregates same-asset entries across multiple vtxos", () => {
    const v1 = vtxo({ assets: [{ assetId: "A", amount: 10n }] });
    const v2 = vtxo({ assets: [{ assetId: "A", amount: 25n }] });
    expect(collectAssets([v1, v2])).toStrictEqual([
      { assetId: "A", amount: 35n },
    ]);
  });

  it("preserves distinct assets", () => {
    const v = vtxo({
      assets: [
        { assetId: "A", amount: 10n },
        { assetId: "B", amount: 20n },
      ],
    });
    expect(sortByAssetId(collectAssets([v]))).toStrictEqual([
      { assetId: "A", amount: 10n },
      { assetId: "B", amount: 20n },
    ]);
  });

  it("drops entries whose summed amount is exactly 0n", () => {
    const pos = vtxo({ assets: [{ assetId: "A", amount: 10n }] });
    // Synthetic: a vtxo with negative amount cancels.
    const neg = vtxo({ assets: [{ assetId: "A", amount: -10n }] });
    expect(collectAssets([pos, neg])).toStrictEqual([]);
  });
});

describe("subtractAssets / assetDeltas", () => {
  it("returns positive delta when only received side has the asset", () => {
    const recv = vtxo({ assets: [{ assetId: "A", amount: 50n }] });
    expect(subtractAssets([], [recv])).toStrictEqual([
      { assetId: "A", amount: 50n },
    ]);
  });

  it("returns negative delta when only spent side has the asset", () => {
    const spent = vtxo({ assets: [{ assetId: "A", amount: 40n }] });
    expect(subtractAssets([spent], [])).toStrictEqual([
      { assetId: "A", amount: -40n },
    ]);
  });

  it("drops zero-net entries (symmetric receive+spend)", () => {
    const spent = vtxo({ assets: [{ assetId: "A", amount: 50n }] });
    const recv = vtxo({ assets: [{ assetId: "A", amount: 50n }] });
    expect(subtractAssets([spent], [recv])).toStrictEqual([]);
  });

  it("computes per-asset deltas across multiple assets and sides", () => {
    const spent = vtxo({
      assets: [
        { assetId: "A", amount: 50n }, // partially returned
        { assetId: "B", amount: 80n }, // fully burned
      ],
    });
    const recv = vtxo({
      assets: [
        { assetId: "A", amount: 30n }, // change
        { assetId: "C", amount: 200n }, // newly issued
      ],
    });
    expect(sortByAssetId(subtractAssets([spent], [recv]))).toStrictEqual([
      { assetId: "A", amount: -20n },
      { assetId: "B", amount: -80n },
      { assetId: "C", amount: 200n },
    ]);
  });

  it("assetDeltas is an alias and produces the same output", () => {
    const spent = vtxo({ assets: [{ assetId: "A", amount: 10n }] });
    const recv = vtxo({ assets: [{ assetId: "A", amount: 3n }] });
    expect(assetDeltas([spent], [recv])).toStrictEqual(
      subtractAssets([spent], [recv]),
    );
  });
});

describe("decomposeCommitmentGroup", () => {
  it("branch 1 — empty group → empty_group settlement", () => {
    const r = decomposeCommitmentGroup({
      spent: [],
      created: [],
      isBoardingMixed: false,
    });
    expect(r).toStrictEqual({
      kind: "settlement",
      spentAmount: 0n,
      createdAmount: 0n,
      reason: "empty_group",
    });
  });

  it("branch 2 — boarding-mixed renewal (created≥spent, no asset delta)", () => {
    const spent = [vtxo({ value: 1000 })];
    const created = [vtxo({ value: 1500 })]; // leftover attributable to boarding
    const r = decomposeCommitmentGroup({
      spent,
      created,
      isBoardingMixed: true,
    });
    expect(r).toStrictEqual({
      kind: "renewal",
      spentAmount: 1000n,
      createdAmount: 1500n,
    });
  });

  it("branch 3 — boarding-mixed with created<spent → boarding_mixed_unresolved", () => {
    const r = decomposeCommitmentGroup({
      spent: [vtxo({ value: 1000 })],
      created: [vtxo({ value: 500 })],
      isBoardingMixed: true,
    });
    expect(r.kind).toBe("settlement");
    expect((r as { reason: string }).reason).toBe("boarding_mixed_unresolved");
  });

  it("branch 3 — boarding-mixed with asset delta → boarding_mixed_unresolved", () => {
    const r = decomposeCommitmentGroup({
      spent: [vtxo({ value: 1000, assets: [{ assetId: "A", amount: 5n }] })],
      created: [vtxo({ value: 1000 })],
      isBoardingMixed: true,
    });
    expect(r.kind).toBe("settlement");
    expect((r as { reason: string }).reason).toBe("boarding_mixed_unresolved");
  });

  it("branch 4a — non-boarding asset_batch_receive (btcDelta>0, assets)", () => {
    const r = decomposeCommitmentGroup({
      spent: [vtxo({ value: 500 })],
      created: [vtxo({ value: 800, assets: [{ assetId: "A", amount: 10n }] })],
      isBoardingMixed: false,
    });
    expect(r.kind).toBe("asset_batch_receive");
    expect((r as { receiveAmount: bigint }).receiveAmount).toBe(300n);
    expect(
      (r as { assetDelta: { assetId: string; amount: bigint }[] }).assetDelta,
    ).toStrictEqual([{ assetId: "A", amount: 10n }]);
  });

  it("branch 4b — non-boarding asset_exit (btcDelta<0, assets)", () => {
    const r = decomposeCommitmentGroup({
      spent: [vtxo({ value: 1000, assets: [{ assetId: "A", amount: 50n }] })],
      created: [vtxo({ value: 300 })],
      isBoardingMixed: false,
    });
    expect(r.kind).toBe("asset_exit");
    expect((r as { exitAmount: bigint }).exitAmount).toBe(700n);
    expect(
      (r as { assetDelta: { assetId: string; amount: bigint }[] }).assetDelta,
    ).toStrictEqual([{ assetId: "A", amount: -50n }]);
  });

  it("branch 4c — non-boarding asset_settlement (btcDelta=0, assets)", () => {
    const r = decomposeCommitmentGroup({
      spent: [vtxo({ value: 1000, assets: [{ assetId: "A", amount: 5n }] })],
      created: [vtxo({ value: 1000 })],
      isBoardingMixed: false,
    });
    expect(r.kind).toBe("asset_settlement");
    expect(
      (r as { assetDelta: { assetId: string; amount: bigint }[] }).assetDelta,
    ).toStrictEqual([{ assetId: "A", amount: -5n }]);
  });

  it("branch 5 — non-boarding batch_receive (spent=0, created>0)", () => {
    const r = decomposeCommitmentGroup({
      spent: [],
      created: [vtxo({ value: 800 })],
      isBoardingMixed: false,
    });
    expect(r).toStrictEqual({ kind: "batch_receive", createdAmount: 800n });
  });

  it("branch 6 — non-boarding exit (spent>0, created=0)", () => {
    const r = decomposeCommitmentGroup({
      spent: [vtxo({ value: 1200 })],
      created: [],
      isBoardingMixed: false,
    });
    expect(r).toStrictEqual({ kind: "exit", spentAmount: 1200n });
  });

  it("branch 7 — non-boarding pure renewal (delta=0)", () => {
    const r = decomposeCommitmentGroup({
      spent: [vtxo({ value: 500 }), vtxo({ value: 500 })],
      created: [vtxo({ value: 1000 })],
      isBoardingMixed: false,
    });
    expect(r).toStrictEqual({
      kind: "renewal",
      spentAmount: 1000n,
      createdAmount: 1000n,
    });
  });

  it("branch 8 — non-boarding renewal_plus_receive (delta>0)", () => {
    const r = decomposeCommitmentGroup({
      spent: [vtxo({ value: 1000 })],
      created: [vtxo({ value: 1300 })],
      isBoardingMixed: false,
    });
    expect(r).toStrictEqual({
      kind: "renewal_plus_receive",
      renewalAmount: 1000n,
      receiveAmount: 300n,
    });
  });

  it("branch 9 — non-boarding renewal_plus_exit (delta<0)", () => {
    const r = decomposeCommitmentGroup({
      spent: [vtxo({ value: 1500 })],
      created: [vtxo({ value: 1000 })],
      isBoardingMixed: false,
    });
    expect(r).toStrictEqual({
      kind: "renewal_plus_exit",
      renewalAmount: 1000n,
      exitAmount: 500n,
    });
  });
});

describe("isRenewalGroup", () => {
  it("is true for pure renewal (non-boarding, delta=0)", () => {
    expect(
      isRenewalGroup({
        spent: [vtxo({ value: 1000 })],
        created: [vtxo({ value: 1000 })],
        isBoardingMixed: false,
      }),
    ).toBe(true);
  });

  it("is true for boarding-mixed renewal (created≥spent, no asset delta)", () => {
    expect(
      isRenewalGroup({
        spent: [vtxo({ value: 1000 })],
        created: [vtxo({ value: 1500 })],
        isBoardingMixed: true,
      }),
    ).toBe(true);
  });

  it.each([
    ["empty", { spent: [], created: [], isBoardingMixed: false }],
    [
      "batch_receive",
      { spent: [], created: [vtxo({ value: 500 })], isBoardingMixed: false },
    ],
    [
      "exit",
      { spent: [vtxo({ value: 500 })], created: [], isBoardingMixed: false },
    ],
    [
      "renewal_plus_receive",
      {
        spent: [vtxo({ value: 1000 })],
        created: [vtxo({ value: 1500 })],
        isBoardingMixed: false,
      },
    ],
    [
      "renewal_plus_exit",
      {
        spent: [vtxo({ value: 1500 })],
        created: [vtxo({ value: 1000 })],
        isBoardingMixed: false,
      },
    ],
    [
      "asset_settlement",
      {
        spent: [vtxo({ value: 1000, assets: [{ assetId: "A", amount: 5n }] })],
        created: [vtxo({ value: 1000 })],
        isBoardingMixed: false,
      },
    ],
    [
      "asset_batch_receive",
      {
        spent: [vtxo({ value: 500 })],
        created: [vtxo({ value: 800, assets: [{ assetId: "A", amount: 5n }] })],
        isBoardingMixed: false,
      },
    ],
    [
      "asset_exit",
      {
        spent: [vtxo({ value: 1000, assets: [{ assetId: "A", amount: 5n }] })],
        created: [vtxo({ value: 300 })],
        isBoardingMixed: false,
      },
    ],
    [
      "boarding_mixed_unresolved (created<spent)",
      {
        spent: [vtxo({ value: 1000 })],
        created: [vtxo({ value: 500 })],
        isBoardingMixed: true,
      },
    ],
  ])("is false for %s", (_label, args) => {
    expect(isRenewalGroup(args)).toBe(false);
  });
});

describe("classifyAssetActivity", () => {
  it("empty delta → asset_activity (regardless of direction/anchor)", () => {
    expect(
      classifyAssetActivity({
        direction: "send",
        anchorSats: 0n,
        assetDelta: [],
      }),
    ).toBe("asset_activity");
    expect(
      classifyAssetActivity({
        direction: "receive",
        anchorSats: 330n,
        assetDelta: [],
      }),
    ).toBe("asset_activity");
  });

  it("send + anchor=0 + all positive → asset_issued", () => {
    expect(
      classifyAssetActivity({
        direction: "send",
        anchorSats: 0n,
        assetDelta: [{ assetId: "A", amount: 100n }],
      }),
    ).toBe("asset_issued");
  });

  it("send + anchor=0 + all negative → asset_burned", () => {
    expect(
      classifyAssetActivity({
        direction: "send",
        anchorSats: 0n,
        assetDelta: [{ assetId: "A", amount: -100n }],
      }),
    ).toBe("asset_burned");
  });

  it("send + anchor>0 + all negative → asset_sent", () => {
    expect(
      classifyAssetActivity({
        direction: "send",
        anchorSats: 330n,
        assetDelta: [
          { assetId: "A", amount: -10n },
          { assetId: "B", amount: -20n },
        ],
      }),
    ).toBe("asset_sent");
  });

  it("send + mixed-sign delta → asset_activity", () => {
    expect(
      classifyAssetActivity({
        direction: "send",
        anchorSats: 330n,
        assetDelta: [
          { assetId: "A", amount: -10n },
          { assetId: "B", amount: 25n },
        ],
      }),
    ).toBe("asset_activity");
  });

  it("send + anchor>0 + all positive (reissuance-like) → asset_activity", () => {
    expect(
      classifyAssetActivity({
        direction: "send",
        anchorSats: 330n,
        assetDelta: [{ assetId: "A", amount: 100n }],
      }),
    ).toBe("asset_activity");
  });

  it("receive + all positive → asset_received", () => {
    expect(
      classifyAssetActivity({
        direction: "receive",
        anchorSats: 330n,
        assetDelta: [
          { assetId: "A", amount: 10n },
          { assetId: "B", amount: 25n },
        ],
      }),
    ).toBe("asset_received");
  });

  it("receive + mixed-sign delta → asset_activity", () => {
    expect(
      classifyAssetActivity({
        direction: "receive",
        anchorSats: 330n,
        assetDelta: [
          { assetId: "A", amount: 10n },
          { assetId: "B", amount: -5n },
        ],
      }),
    ).toBe("asset_activity");
  });
});
