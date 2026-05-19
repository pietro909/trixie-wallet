// Pins the history-match heuristic that links a Boltz swap to its underlying
// Arkade payment row when no backup is available (seed-only restore).
//
// Bug being prevented: before this matcher was generalized, only reverse swaps
// got linked — submarine swaps stayed unlinked, so after a seed-only restore
// the merged Activity list rendered the lockup as "Arkade sent" alongside the
// "Lightning sent" row. The matcher now handles both directions; the tests
// pin both paths plus the no-link cases (ambiguity, time window, type/amount
// mismatch) so the multi-match rule can't regress silently.

import { type ArkTransaction, TxType } from "@arkade-os/sdk";
import {
  findUnambiguousHistoryMatch,
  LINKAGE_LOOKAHEAD_MS,
  LINKAGE_LOOKBACK_MS,
} from "../swap-linkage";

const T0 = 1_700_000_000_000;

function tx(
  overrides: Partial<ArkTransaction> & Pick<ArkTransaction, "type" | "amount">,
): ArkTransaction {
  return {
    key: {
      arkTxid: "ark-default",
      commitmentTxid: "",
      boardingTxid: "",
    },
    settled: true,
    createdAt: T0,
    ...overrides,
  };
}

describe("findUnambiguousHistoryMatch", () => {
  it("links a reverse swap to the matching TxReceived row", () => {
    const history: ArkTransaction[] = [
      tx({
        type: TxType.TxReceived,
        amount: 50_000,
        key: { arkTxid: "ark-recv", commitmentTxid: "", boardingTxid: "" },
      }),
    ];
    const result = findUnambiguousHistoryMatch({
      history,
      direction: "in",
      amountSats: 50_000,
      lowerBoundMs: T0 - LINKAGE_LOOKBACK_MS,
      upperBoundMs: T0 + LINKAGE_LOOKAHEAD_MS,
    });
    expect(result).toBe("ark-recv");
  });

  // Regression test for the seed-only-restore bug. Before the fix, the
  // matcher short-circuited on `swap.type !== "reverse"`, so a submarine swap
  // restored from seed never acquired a `walletTxId` and the user saw the
  // "Arkade sent" row instead of "Lightning sent".
  it("links a submarine swap to the matching TxSent row", () => {
    const history: ArkTransaction[] = [
      tx({
        type: TxType.TxSent,
        amount: -25_000,
        key: { arkTxid: "ark-sent", commitmentTxid: "", boardingTxid: "" },
      }),
    ];
    const result = findUnambiguousHistoryMatch({
      history,
      direction: "out",
      amountSats: 25_000,
      lowerBoundMs: T0 - LINKAGE_LOOKBACK_MS,
      upperBoundMs: T0 + LINKAGE_LOOKAHEAD_MS,
    });
    expect(result).toBe("ark-sent");
  });

  it("ignores rows of the opposite direction", () => {
    const history: ArkTransaction[] = [
      tx({
        type: TxType.TxReceived,
        amount: 25_000,
        key: { arkTxid: "ark-recv", commitmentTxid: "", boardingTxid: "" },
      }),
    ];
    // Submarine: looking for an outgoing tx, but the history only has an
    // incoming one with the same magnitude. Must not link.
    const result = findUnambiguousHistoryMatch({
      history,
      direction: "out",
      amountSats: 25_000,
      lowerBoundMs: T0 - LINKAGE_LOOKBACK_MS,
      upperBoundMs: T0 + LINKAGE_LOOKAHEAD_MS,
    });
    expect(result).toBeNull();
  });

  it("returns null when two or more rows match (multi-match rule)", () => {
    const history: ArkTransaction[] = [
      tx({
        type: TxType.TxSent,
        amount: -10_000,
        key: { arkTxid: "ark-sent-a", commitmentTxid: "", boardingTxid: "" },
      }),
      tx({
        type: TxType.TxSent,
        amount: -10_000,
        createdAt: T0 + 1_000,
        key: { arkTxid: "ark-sent-b", commitmentTxid: "", boardingTxid: "" },
      }),
    ];
    const result = findUnambiguousHistoryMatch({
      history,
      direction: "out",
      amountSats: 10_000,
      lowerBoundMs: T0 - LINKAGE_LOOKBACK_MS,
      upperBoundMs: T0 + LINKAGE_LOOKAHEAD_MS,
    });
    expect(result).toBeNull();
  });

  it("returns null when no row matches the amount", () => {
    const history: ArkTransaction[] = [
      tx({
        type: TxType.TxReceived,
        amount: 9_999,
        key: { arkTxid: "ark-recv", commitmentTxid: "", boardingTxid: "" },
      }),
    ];
    const result = findUnambiguousHistoryMatch({
      history,
      direction: "in",
      amountSats: 10_000,
      lowerBoundMs: T0 - LINKAGE_LOOKBACK_MS,
      upperBoundMs: T0 + LINKAGE_LOOKAHEAD_MS,
    });
    expect(result).toBeNull();
  });

  it("returns null when the only match is outside the time window", () => {
    const history: ArkTransaction[] = [
      tx({
        type: TxType.TxReceived,
        amount: 10_000,
        createdAt: T0 - LINKAGE_LOOKBACK_MS - 1,
        key: { arkTxid: "ark-recv", commitmentTxid: "", boardingTxid: "" },
      }),
    ];
    const result = findUnambiguousHistoryMatch({
      history,
      direction: "in",
      amountSats: 10_000,
      lowerBoundMs: T0 - LINKAGE_LOOKBACK_MS,
      upperBoundMs: T0 + LINKAGE_LOOKAHEAD_MS,
    });
    expect(result).toBeNull();
  });

  it("falls back to commitmentTxid when arkTxid is empty", () => {
    const history: ArkTransaction[] = [
      tx({
        type: TxType.TxReceived,
        amount: 10_000,
        key: {
          arkTxid: "",
          commitmentTxid: "commit-1",
          boardingTxid: "",
        },
      }),
    ];
    const result = findUnambiguousHistoryMatch({
      history,
      direction: "in",
      amountSats: 10_000,
      lowerBoundMs: T0 - LINKAGE_LOOKBACK_MS,
      upperBoundMs: T0 + LINKAGE_LOOKAHEAD_MS,
    });
    expect(result).toBe("commit-1");
  });

  it("falls back to boardingTxid when both arkTxid and commitmentTxid are empty", () => {
    const history: ArkTransaction[] = [
      tx({
        type: TxType.TxReceived,
        amount: 10_000,
        key: {
          arkTxid: "",
          commitmentTxid: "",
          boardingTxid: "boarding-1",
        },
      }),
    ];
    const result = findUnambiguousHistoryMatch({
      history,
      direction: "in",
      amountSats: 10_000,
      lowerBoundMs: T0 - LINKAGE_LOOKBACK_MS,
      upperBoundMs: T0 + LINKAGE_LOOKAHEAD_MS,
    });
    expect(result).toBe("boarding-1");
  });

  it("returns null when the matching row has no usable txid", () => {
    const history: ArkTransaction[] = [
      tx({
        type: TxType.TxReceived,
        amount: 10_000,
        key: { arkTxid: "", commitmentTxid: "", boardingTxid: "" },
      }),
    ];
    const result = findUnambiguousHistoryMatch({
      history,
      direction: "in",
      amountSats: 10_000,
      lowerBoundMs: T0 - LINKAGE_LOOKBACK_MS,
      upperBoundMs: T0 + LINKAGE_LOOKAHEAD_MS,
    });
    expect(result).toBeNull();
  });
});
