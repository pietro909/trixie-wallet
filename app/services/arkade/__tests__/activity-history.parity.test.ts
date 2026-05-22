import type { ArkTransaction, VirtualCoin } from "@arkade-os/sdk";
import type { Activity } from "../../../store/types";
import {
  buildActivityHistory,
  type TxCreatedAtResolver,
} from "../activity-history";
import transactionHistoryRaw from "./fixtures/transaction_history.json";

// SDK-parity tests against the real-world fixtures from
// ts-sdk/test/transactionHistory.test.ts. See docs/ACTIVITY_HISTORY.specs.md §9.

type SdkTag = "offchain" | "boarding" | "exit" | "batch";
type SdkRow = {
  key: { arkTxid: string; boardingTxid: string; commitmentTxid: string };
  tag: SdkTag;
  type: "SENT" | "RECEIVED";
  amount: number;
  settled: boolean;
  createdAt: number;
};

type FixtureCase = {
  address: string;
  vtxos: Array<Record<string, unknown>>;
  allBoardingTxs: Array<Record<string, unknown>>;
  commitmentsToIgnore: string[];
  expected: SdkRow[];
  expectedBalance: number;
  sendAllTxTime?: Record<string, number>;
};

const fixtures = transactionHistoryRaw as unknown as FixtureCase[];

const sdkRowToActivityId = (r: SdkRow): string => {
  switch (r.tag) {
    case "boarding":
      return `arkade:boarding:${r.key.boardingTxid}`;
    case "batch":
      return `arkade:batch:${r.key.commitmentTxid}`;
    case "offchain":
      return `arkade:offchain:${r.key.arkTxid}`;
    case "exit":
      return `arkade:exit:${r.key.commitmentTxid}`;
  }
};

const ALLOWED_EXTRA_KINDS = new Set([
  "boarding_settled",
  "renewal",
  "settlement",
  "asset",
]);

const idKind = (id: string): string => id.split(":")[1];

const sortByTsThenId = (
  xs: Array<{ id: string; timestamp: number }>,
): Array<{ id: string; timestamp: number }> =>
  [...xs].sort((a, b) => b.timestamp - a.timestamp || a.id.localeCompare(b.id));

const buildForCase = async (c: FixtureCase): Promise<Activity[]> => {
  const vtxos = c.vtxos.map((v) => ({
    ...v,
    createdAt: new Date(v.createdAt as string),
  })) as unknown as VirtualCoin[];
  const boardingTxs = c.allBoardingTxs as unknown as ArkTransaction[];
  const sendAllTxTime = c.sendAllTxTime;
  let getTxCreatedAt: TxCreatedAtResolver | undefined;
  if (sendAllTxTime) {
    getTxCreatedAt = ((txid: string) =>
      Promise.resolve(sendAllTxTime[txid])) as TxCreatedAtResolver;
    getTxCreatedAt.getMany = (txids: string[]) =>
      Promise.resolve(
        new Map(txids.map((txid) => [txid, sendAllTxTime[txid]])),
      );
  }
  return buildActivityHistory(
    vtxos,
    boardingTxs,
    new Set(c.commitmentsToIgnore),
    getTxCreatedAt,
  );
};

// Each case gets its own describe block so a failure in case 0 doesn't
// hide a separate failure in case 1.
fixtures.forEach((c, index) => {
  const label =
    c.address.length > 40 ? `${c.address.slice(0, 40)}…` : c.address;
  describe(`SDK parity — case ${index}: ${label}`, () => {
    let activities: Activity[];
    let activityById: Map<string, Activity>;
    let sdkIdSet: Set<string>;

    beforeAll(async () => {
      activities = await buildForCase(c);
      activityById = new Map(activities.map((a) => [a.id, a]));
      sdkIdSet = new Set(c.expected.map(sdkRowToActivityId));
    });

    it("P-1/P-3: every SDK row maps to an Activity row (id, timestamp, amount, direction)", () => {
      const missing: string[] = [];
      const mismatches: string[] = [];
      for (const sdkRow of c.expected) {
        const id = sdkRowToActivityId(sdkRow);
        const match = activityById.get(id);
        if (!match) {
          missing.push(id);
          continue;
        }
        if (match.timestamp !== sdkRow.createdAt) {
          mismatches.push(
            `${id}: timestamp ${match.timestamp} ≠ SDK ${sdkRow.createdAt}`,
          );
        }
        if (match.amountSats !== sdkRow.amount) {
          mismatches.push(
            `${id}: amountSats ${match.amountSats} ≠ SDK ${sdkRow.amount}`,
          );
        }
        const expectedDir = sdkRow.type === "RECEIVED" ? "in" : "out";
        if (match.direction !== expectedDir) {
          mismatches.push(
            `${id}: direction ${match.direction} ≠ SDK ${expectedDir}`,
          );
        }
      }
      expect({ missing, mismatches }).toStrictEqual({
        missing: [],
        mismatches: [],
      });
    });

    it("P-2: balance computed over payment rows matches expectedBalance", () => {
      const balance = activities
        .filter((a) => a.kind === "payment" && typeof a.amountSats === "number")
        .reduce(
          (acc, a) =>
            acc +
            (a.direction === "in"
              ? (a.amountSats as number)
              : -(a.amountSats as number)),
          0,
        );
      expect(balance).toBe(c.expectedBalance);
    });

    it("P-4: every extra Activity row is in the allowed wallet-event namespace", () => {
      const offending: string[] = [];
      for (const a of activities) {
        if (sdkIdSet.has(a.id)) continue;
        if (!ALLOWED_EXTRA_KINDS.has(idKind(a.id))) {
          offending.push(a.id);
        }
      }
      expect(offending).toStrictEqual([]);
    });

    it("P-5: payment-row order matches SDK expected order (after deterministic sort)", () => {
      const sdkSorted = sortByTsThenId(
        c.expected.map((r) => ({
          id: sdkRowToActivityId(r),
          timestamp: r.createdAt,
        })),
      );
      const ourPaymentRows = activities
        .filter((a) => a.kind === "payment" && sdkIdSet.has(a.id))
        .map((a) => ({ id: a.id, timestamp: a.timestamp }));
      expect(sortByTsThenId(ourPaymentRows)).toStrictEqual(sdkSorted);
    });
  });
});
