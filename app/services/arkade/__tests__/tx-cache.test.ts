// Tests the durable timestamp cache. `./storage` is mocked with an in-memory
// executor so we exercise the module's SQL plumbing and error contracts
// without opening a real expo-sqlite database.

type ThrowMode = "none" | "run" | "get" | "run-once";

type MockHandle = {
  reset: () => void;
  setThrowMode: (m: ThrowMode) => void;
  size: () => number;
  has: (k: string) => boolean;
};

jest.mock("../storage", () => {
  const store = new Map<string, number>();
  let throwMode: ThrowMode = "none";

  const exec = {
    run: jest.fn(async (sql: string, params?: unknown[]) => {
      if (throwMode === "run") throw new Error("run boom");
      if (throwMode === "run-once") {
        throwMode = "none";
        throw new Error("run boom once");
      }
      if (sql.startsWith("CREATE")) return;
      if (sql.startsWith("INSERT")) {
        const [k, v] = params as [string, number];
        store.set(k, v);
        return;
      }
      if (sql.startsWith("DELETE")) {
        store.clear();
        return;
      }
    }),
    get: jest.fn(
      async <T>(_sql: string, params?: unknown[]): Promise<T | undefined> => {
        if (throwMode === "get") throw new Error("get boom");
        const [k] = (params ?? []) as [string];
        const ts = store.get(k);
        return ts === undefined ? undefined : ({ timestamp: ts } as T);
      },
    ),
    all: jest.fn(async () => []),
  };

  const handle: MockHandle = {
    reset: () => {
      store.clear();
      throwMode = "none";
      exec.run.mockClear();
      exec.get.mockClear();
      exec.all.mockClear();
    },
    setThrowMode: (m) => {
      throwMode = m;
    },
    size: () => store.size,
    has: (k) => store.has(k),
  };

  return {
    __esModule: true,
    getSharedSqlExecutor: () => exec,
    __mockHandle: handle,
    __mockExec: exec,
  };
});

// Re-require the mocked module each test so the tx-cache `initPromise`
// module-level state is fresh — otherwise T-7 (retry after init failure)
// can't observe the second CREATE attempt.
const loadModules = () => {
  const storage = jest.requireMock("../storage") as {
    __mockHandle: MockHandle;
    __mockExec: {
      run: jest.Mock;
      get: jest.Mock;
      all: jest.Mock;
    };
  };
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const txCache = require("../tx-cache") as typeof import("../tx-cache");
  return { handle: storage.__mockHandle, exec: storage.__mockExec, txCache };
};

describe("tx-cache", () => {
  beforeEach(() => {
    jest.resetModules();
    const { handle } = loadModules();
    handle.reset();
  });

  // T-1 — round-trip the happy path.
  it("T-1: save then get returns the persisted timestamp", async () => {
    const { txCache } = loadModules();
    await txCache.saveTimestamp("tx-A", 1_700_000_000_000);
    const got = await txCache.getTimestamp("tx-A");
    expect(got).toBe(1_700_000_000_000);
  });

  // T-2 — a miss is `undefined`, not an error.
  it("T-2: get on missing key returns undefined", async () => {
    const { txCache } = loadModules();
    const got = await txCache.getTimestamp("missing");
    expect(got).toBeUndefined();
  });

  // T-3 — INSERT OR REPLACE semantics: the second save wins.
  it("T-3: save overwrites prior value for the same txid", async () => {
    const { txCache } = loadModules();
    await txCache.saveTimestamp("tx-A", 111);
    await txCache.saveTimestamp("tx-A", 222);
    expect(await txCache.getTimestamp("tx-A")).toBe(222);
  });

  // T-4 — clear empties the table; later writes still work.
  it("T-4: clearAllTimestamps empties the cache and does not break later writes", async () => {
    const { txCache, handle } = loadModules();
    await txCache.saveTimestamp("tx-A", 111);
    await txCache.saveTimestamp("tx-B", 222);
    expect(handle.size()).toBe(2);

    await txCache.clearAllTimestamps();
    expect(handle.size()).toBe(0);
    expect(await txCache.getTimestamp("tx-A")).toBeUndefined();

    await txCache.saveTimestamp("tx-C", 333);
    expect(await txCache.getTimestamp("tx-C")).toBe(333);
  });

  // T-5 — get-throws must resolve to undefined (best-effort contract).
  it("T-5: a get-time SQL error is swallowed and returns undefined", async () => {
    const { txCache, handle } = loadModules();
    handle.setThrowMode("get");
    await expect(txCache.getTimestamp("tx-A")).resolves.toBeUndefined();
  });

  // T-6 — save-throws must resolve without throwing.
  it("T-6: a save-time SQL error is swallowed and resolves silently", async () => {
    const { txCache, handle } = loadModules();
    handle.setThrowMode("run");
    await expect(txCache.saveTimestamp("tx-A", 1)).resolves.toBeUndefined();
  });

  // T-7 — `initPromise` resets after a CREATE failure so the next call
  //       retries the CREATE rather than getting stuck.
  it("T-7: ensureTable retries after a CREATE failure", async () => {
    const { txCache, handle, exec } = loadModules();
    handle.setThrowMode("run-once");

    // First call: CREATE throws → caught by getTimestamp → undefined.
    await expect(txCache.getTimestamp("tx-A")).resolves.toBeUndefined();

    // After the catch, `initPromise` must be null again so the next call
    // retries CREATE. Observe that by saving then reading on the same key
    // — if the retry didn't happen, save would also error out and the
    // read would be undefined.
    await txCache.saveTimestamp("tx-A", 999);
    expect(await txCache.getTimestamp("tx-A")).toBe(999);

    // Sanity: CREATE was attempted at least twice (first failed, second
    // succeeded; subsequent calls reuse the cached `initPromise`).
    const createCalls = exec.run.mock.calls.filter((c: unknown[]) =>
      typeof c[0] === "string" ? (c[0] as string).startsWith("CREATE") : false,
    );
    expect(createCalls.length).toBeGreaterThanOrEqual(2);
  });
});
