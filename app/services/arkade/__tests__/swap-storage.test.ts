// Tests the swap-metadata storage. `./storage` is mocked with an in-memory
// executor that knows just enough about our table to round-trip rows through
// INSERT...ON CONFLICT DO UPDATE; the flow-resolution policy lives in JS
// inside `recordSwapMetadata`, which is what these tests pin.

import type { LocalSwapFlow } from "../swap-storage";

type Row = {
  swap_id: string;
  wallet_id: string;
  direction: "in" | "out";
  created_for_flow: LocalSwapFlow;
  invoice_amount_sats: number | null;
  arkade_amount_sats: number | null;
  wallet_tx_id: string | null;
  payment_hash: string | null;
  link_source: string | null;
  restored_at: number | null;
  created_at: number;
  updated_at: number;
};

type MockHandle = {
  reset: () => void;
  rows: () => Row[];
};

jest.mock("../storage", () => {
  const rows = new Map<string, Row>();

  const exec = {
    run: jest.fn(async (sql: string, params?: unknown[]) => {
      if (sql.startsWith("CREATE")) return;
      if (sql.startsWith("INSERT INTO trixie_swap_meta")) {
        const [
          swapId,
          walletId,
          direction,
          createdForFlow,
          invoiceAmountSats,
          arkadeAmountSats,
          paymentHash,
          restoredAt,
          createdAt,
          updatedAt,
        ] = params as [
          string,
          string,
          "in" | "out",
          LocalSwapFlow,
          number | null,
          number | null,
          string | null,
          number | null,
          number,
          number,
        ];
        const prior = rows.get(swapId);
        if (prior) {
          rows.set(swapId, {
            ...prior,
            direction,
            created_for_flow: createdForFlow,
            invoice_amount_sats: invoiceAmountSats ?? prior.invoice_amount_sats,
            arkade_amount_sats: arkadeAmountSats ?? prior.arkade_amount_sats,
            payment_hash: paymentHash ?? prior.payment_hash,
            restored_at: restoredAt ?? prior.restored_at,
            updated_at: updatedAt,
          });
        } else {
          rows.set(swapId, {
            swap_id: swapId,
            wallet_id: walletId,
            direction,
            created_for_flow: createdForFlow,
            invoice_amount_sats: invoiceAmountSats,
            arkade_amount_sats: arkadeAmountSats,
            wallet_tx_id: null,
            payment_hash: paymentHash,
            link_source: null,
            restored_at: restoredAt,
            created_at: createdAt,
            updated_at: updatedAt,
          });
        }
        return;
      }
      if (sql.startsWith("INSERT OR REPLACE INTO trixie_swap_meta")) {
        const r = params as unknown[];
        rows.set(r[0] as string, {
          swap_id: r[0] as string,
          wallet_id: r[1] as string,
          direction: r[2] as "in" | "out",
          created_for_flow: r[3] as LocalSwapFlow,
          invoice_amount_sats: r[4] as number | null,
          arkade_amount_sats: r[5] as number | null,
          wallet_tx_id: r[6] as string | null,
          payment_hash: r[7] as string | null,
          link_source: r[8] as string | null,
          restored_at: r[9] as number | null,
          created_at: r[10] as number,
          updated_at: r[11] as number,
        });
        return;
      }
      if (sql.startsWith("UPDATE trixie_swap_meta")) {
        const [walletTxId, linkSource, updatedAt, swapId] = params as [
          string,
          string,
          number,
          string,
        ];
        const prior = rows.get(swapId);
        if (prior) {
          rows.set(swapId, {
            ...prior,
            wallet_tx_id: walletTxId,
            link_source: linkSource,
            updated_at: updatedAt,
          });
        }
        return;
      }
      if (sql.startsWith("DELETE")) {
        const [walletId] = params as [string];
        for (const [id, row] of rows) {
          if (row.wallet_id === walletId) rows.delete(id);
        }
        return;
      }
    }),
    get: jest.fn(
      async <T>(sql: string, params?: unknown[]): Promise<T | undefined> => {
        if (sql.startsWith("SELECT created_for_flow")) {
          const [swapId] = params as [string];
          const r = rows.get(swapId);
          return r
            ? ({ created_for_flow: r.created_for_flow } as unknown as T)
            : undefined;
        }
        if (sql.startsWith("SELECT * FROM trixie_swap_meta WHERE swap_id")) {
          const [swapId] = params as [string];
          return rows.get(swapId) as unknown as T | undefined;
        }
        if (sql.startsWith("SELECT MAX(updated_at)")) {
          const [walletId] = params as [string];
          let max: number | null = null;
          for (const r of rows.values()) {
            if (r.wallet_id !== walletId) continue;
            if (max === null || r.updated_at > max) max = r.updated_at;
          }
          return { ts: max } as unknown as T;
        }
        return undefined;
      },
    ),
    all: jest.fn(async () => []),
  };

  const handle: MockHandle = {
    reset: () => {
      rows.clear();
      exec.run.mockClear();
      exec.get.mockClear();
      exec.all.mockClear();
    },
    rows: () => Array.from(rows.values()),
  };

  return {
    __esModule: true,
    getSharedSqlExecutor: () => exec,
    __mockHandle: handle,
  };
});

const loadModule = () => {
  const storage = jest.requireMock("../storage") as {
    __mockHandle: MockHandle;
  };
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const swapStorage =
    require("../swap-storage") as typeof import("../swap-storage");
  return { handle: storage.__mockHandle, swapStorage };
};

describe("resolveCreatedForFlowOnConflict", () => {
  it("returns the incoming flow when no row exists", () => {
    const { swapStorage } = loadModule();
    expect(swapStorage.resolveCreatedForFlowOnConflict(null, "receive")).toBe(
      "receive",
    );
    expect(
      swapStorage.resolveCreatedForFlowOnConflict(null, "lnurl_receive"),
    ).toBe("lnurl_receive");
  });

  it("never downgrades lnurl_* to generic", () => {
    const { swapStorage } = loadModule();
    expect(
      swapStorage.resolveCreatedForFlowOnConflict("lnurl_receive", "receive"),
    ).toBe("lnurl_receive");
    expect(
      swapStorage.resolveCreatedForFlowOnConflict("lnurl_send", "send"),
    ).toBe("lnurl_send");
  });

  it("upgrades generic to lnurl_*", () => {
    const { swapStorage } = loadModule();
    expect(
      swapStorage.resolveCreatedForFlowOnConflict("receive", "lnurl_receive"),
    ).toBe("lnurl_receive");
    expect(
      swapStorage.resolveCreatedForFlowOnConflict("send", "lnurl_send"),
    ).toBe("lnurl_send");
  });
});

describe("isLocalSwapFlow", () => {
  it("accepts all four flow values and rejects others", () => {
    const { swapStorage } = loadModule();
    expect(swapStorage.isLocalSwapFlow("send")).toBe(true);
    expect(swapStorage.isLocalSwapFlow("receive")).toBe(true);
    expect(swapStorage.isLocalSwapFlow("lnurl_send")).toBe(true);
    expect(swapStorage.isLocalSwapFlow("lnurl_receive")).toBe(true);
    expect(swapStorage.isLocalSwapFlow("other")).toBe(false);
    expect(swapStorage.isLocalSwapFlow(null)).toBe(false);
    expect(swapStorage.isLocalSwapFlow(undefined)).toBe(false);
  });
});

describe("recordSwapMetadata conflict resolution", () => {
  beforeEach(() => {
    jest.resetModules();
    const { handle } = loadModule();
    handle.reset();
  });

  it("preserves lnurl_receive when a later generic receive write lands", async () => {
    const { swapStorage } = loadModule();
    await swapStorage.recordSwapMetadata({
      swapId: "s1",
      walletId: "w1",
      direction: "in",
      createdForFlow: "lnurl_receive",
      invoiceAmountSats: 1000,
      arkadeAmountSats: 950,
    });
    await swapStorage.recordSwapMetadata({
      swapId: "s1",
      walletId: "w1",
      direction: "in",
      createdForFlow: "receive",
      restoredAt: Date.now(),
    });
    const row = await swapStorage.getSwapMetadata("s1");
    expect(row?.createdForFlow).toBe("lnurl_receive");
  });

  it("preserves lnurl_send when a later generic send write lands", async () => {
    const { swapStorage } = loadModule();
    await swapStorage.recordSwapMetadata({
      swapId: "s2",
      walletId: "w1",
      direction: "out",
      createdForFlow: "lnurl_send",
      invoiceAmountSats: 2000,
      arkadeAmountSats: 2100,
    });
    await swapStorage.recordSwapMetadata({
      swapId: "s2",
      walletId: "w1",
      direction: "out",
      createdForFlow: "send",
      restoredAt: Date.now(),
    });
    const row = await swapStorage.getSwapMetadata("s2");
    expect(row?.createdForFlow).toBe("lnurl_send");
  });

  it("upgrades a generic receive row to lnurl_receive when the LNURL tag arrives later", async () => {
    const { swapStorage } = loadModule();
    await swapStorage.recordSwapMetadata({
      swapId: "s3",
      walletId: "w1",
      direction: "in",
      createdForFlow: "receive",
    });
    await swapStorage.recordSwapMetadata({
      swapId: "s3",
      walletId: "w1",
      direction: "in",
      createdForFlow: "lnurl_receive",
    });
    const row = await swapStorage.getSwapMetadata("s3");
    expect(row?.createdForFlow).toBe("lnurl_receive");
  });

  it("upgrades a generic send row to lnurl_send when the LNURL tag arrives later", async () => {
    const { swapStorage } = loadModule();
    await swapStorage.recordSwapMetadata({
      swapId: "s4",
      walletId: "w1",
      direction: "out",
      createdForFlow: "send",
    });
    await swapStorage.recordSwapMetadata({
      swapId: "s4",
      walletId: "w1",
      direction: "out",
      createdForFlow: "lnurl_send",
    });
    const row = await swapStorage.getSwapMetadata("s4");
    expect(row?.createdForFlow).toBe("lnurl_send");
  });
});
