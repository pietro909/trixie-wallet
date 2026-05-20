import type { Contract, Wallet } from "@arkade-os/sdk";
import {
  loadContractLabelsForBackup,
  loadContractParams,
  loadContractSummaries,
  updateContractLabel,
} from "../contracts";
import { ArkadeError } from "../errors";

function contract(over: Partial<Contract>): Contract {
  return {
    type: "default",
    state: "active",
    address: "ark1qdefault",
    script: "5120deadbeef",
    params: {},
    createdAt: 1_700_000_000_000,
    ...over,
  };
}

type ContractsImpl = (filter?: {
  script?: string;
}) => Promise<Contract[]> | Contract[];
type UpdateImpl = (
  script: string,
  updates: Partial<Contract>,
) => Promise<Contract> | Contract;

function fakeWallet(
  getContracts: ContractsImpl,
  updateContract?: UpdateImpl,
): Wallet {
  return {
    getContractManager: async () => ({
      getContracts: async (filter?: { script?: string }) =>
        getContracts(filter),
      updateContract: async (script: string, updates: Partial<Contract>) =>
        updateContract
          ? updateContract(script, updates)
          : ({} as unknown as Contract),
    }),
  } as unknown as Wallet;
}

describe("loadContractSummaries", () => {
  it("projects each contract to a summary without `params`", async () => {
    const wallet = fakeWallet(() => [
      contract({
        type: "default",
        address: "ark1qdefault",
        script: "5120deadbeef",
        label: "Primary",
        params: { pubKey: "leak", csvTimelock: "144" },
      }),
    ]);

    const rows = await loadContractSummaries(wallet);

    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row).toEqual({
      type: "default",
      state: "active",
      address: "ark1qdefault",
      script: "5120deadbeef",
      label: "Primary",
      createdAt: 1_700_000_000_000,
    });
    expect("params" in row).toBe(false);
  });

  it("includes `metadata` when present and non-empty", async () => {
    const wallet = fakeWallet(() => [
      contract({
        type: "default",
        metadata: { foo: "bar" },
      }),
    ]);
    const [row] = await loadContractSummaries(wallet);
    expect(row.metadata).toEqual({ foo: "bar" });
  });

  it("omits `metadata` when it's absent or an empty object", async () => {
    const w1 = fakeWallet(() => [contract({})]);
    const [r1] = await loadContractSummaries(w1);
    expect("metadata" in r1).toBe(false);
    const w2 = fakeWallet(() => [contract({ metadata: {} })]);
    const [r2] = await loadContractSummaries(w2);
    expect("metadata" in r2).toBe(false);
  });

  it("filters VHTLCs out of the result", async () => {
    const wallet = fakeWallet(() => [
      contract({ type: "default", script: "a" }),
      contract({ type: "delegate", script: "b" }),
      contract({ type: "vhtlc", script: "vh1" }),
      contract({ type: "vhtlc", script: "vh2" }),
    ]);
    const rows = await loadContractSummaries(wallet);
    expect(rows.map((r) => r.script)).toEqual(["a", "b"]);
    expect(rows.every((r) => r.type !== "vhtlc")).toBe(true);
  });

  it.each([
    [
      [
        contract({
          type: "delegate",
          script: "del",
          createdAt: 1_800_000_000_000,
        }),
        contract({
          type: "default",
          script: "def",
          createdAt: 1_700_000_000_000,
        }),
      ],
      ["def", "del"],
    ],
    [
      [
        contract({
          type: "delegate",
          script: "older",
          createdAt: 100,
        }),
        contract({
          type: "delegate",
          script: "newer",
          createdAt: 200,
        }),
        contract({
          type: "default",
          script: "def",
          createdAt: 50,
        }),
      ],
      ["def", "newer", "older"],
    ],
    [
      [
        contract({
          type: "default",
          script: "def",
          createdAt: 50,
        }),
      ],
      ["def"],
    ],
  ])("sorts default-first, then by createdAt desc", async (input, expected) => {
    const wallet = fakeWallet(() => input);
    const rows = await loadContractSummaries(wallet);
    expect(rows.map((r) => r.script)).toEqual(expected);
  });

  it("returns an empty array when no contracts are registered", async () => {
    const wallet = fakeWallet(() => []);
    const rows = await loadContractSummaries(wallet);
    expect(rows).toEqual([]);
  });

  it("wraps SDK failures as contracts_fetch_failed", async () => {
    const wallet = fakeWallet(() => {
      throw new Error("indexer down");
    });
    await expect(loadContractSummaries(wallet)).rejects.toMatchObject({
      kind: "contracts_fetch_failed",
    });
    await expect(loadContractSummaries(wallet)).rejects.toBeInstanceOf(
      ArkadeError,
    );
  });
});

describe("loadContractParams", () => {
  it("returns just the params map for the matching contract", async () => {
    const wallet = fakeWallet(() => [
      contract({
        type: "default",
        script: "abc",
        params: { pubKey: "p", serverPubKey: "s", csvTimelock: "144" },
      }),
    ]);
    const params = await loadContractParams(wallet, "abc");
    expect(params).toEqual({
      pubKey: "p",
      serverPubKey: "s",
      csvTimelock: "144",
    });
    expect("type" in params).toBe(false);
    expect("address" in params).toBe(false);
    expect("state" in params).toBe(false);
  });

  it("forwards the script filter to the SDK", async () => {
    const seen: unknown[] = [];
    const wallet = fakeWallet((filter) => {
      seen.push(filter);
      return [
        contract({
          script: "abc",
          params: { pubKey: "p" },
        }),
      ];
    });
    await loadContractParams(wallet, "abc");
    expect(seen).toEqual([{ script: "abc" }]);
  });

  it("throws contracts_params_not_found when no contract matches", async () => {
    const wallet = fakeWallet(() => []);
    await expect(loadContractParams(wallet, "nope")).rejects.toMatchObject({
      kind: "contracts_params_not_found",
    });
  });

  it("wraps SDK failures as contracts_fetch_failed", async () => {
    const wallet = fakeWallet(() => {
      throw new Error("indexer down");
    });
    await expect(loadContractParams(wallet, "abc")).rejects.toMatchObject({
      kind: "contracts_fetch_failed",
    });
  });
});

describe("updateContractLabel", () => {
  it("clears the label when given an empty string", async () => {
    const updateSpy = jest.fn(async () => contract({}));
    const wallet = fakeWallet(() => [], updateSpy);
    await updateContractLabel(wallet, "s", "");
    expect(updateSpy).toHaveBeenCalledWith("s", { label: undefined });
  });

  it("clears the label when given whitespace only", async () => {
    const updateSpy = jest.fn(async () => contract({}));
    const wallet = fakeWallet(() => [], updateSpy);
    await updateContractLabel(wallet, "s", "   ");
    expect(updateSpy).toHaveBeenCalledWith("s", { label: undefined });
  });

  it("trims and sets a non-empty label", async () => {
    const updateSpy = jest.fn(async () => contract({}));
    const wallet = fakeWallet(() => [], updateSpy);
    await updateContractLabel(wallet, "s", "  Primary  ");
    expect(updateSpy).toHaveBeenCalledWith("s", { label: "Primary" });
  });

  it("wraps SDK failures as contracts_update_failed", async () => {
    const wallet = fakeWallet(
      () => [],
      () => {
        throw new Error("network blip");
      },
    );
    await expect(
      updateContractLabel(wallet, "s", "Primary"),
    ).rejects.toMatchObject({
      kind: "contracts_update_failed",
    });
  });
});

describe("loadContractLabelsForBackup", () => {
  it("includes only non-VHTLC contracts with non-empty labels", async () => {
    const wallet = fakeWallet(() => [
      contract({ type: "default", script: "a", label: "Primary" }),
      contract({ type: "delegate", script: "b", label: "Delegate" }),
      contract({ type: "vhtlc", script: "vh", label: "should-skip" }),
    ]);
    const rows = await loadContractLabelsForBackup(wallet);
    expect(rows).toEqual([
      { script: "a", label: "Primary" },
      { script: "b", label: "Delegate" },
    ]);
  });

  it("drops contracts with undefined, empty, or whitespace-only labels", async () => {
    const wallet = fakeWallet(() => [
      contract({ type: "default", script: "a" }),
      contract({ type: "default", script: "b", label: "" }),
      contract({ type: "default", script: "c", label: "   " }),
      contract({ type: "default", script: "d", label: "Keep" }),
    ]);
    const rows = await loadContractLabelsForBackup(wallet);
    expect(rows).toEqual([{ script: "d", label: "Keep" }]);
  });

  it("returns an empty array when nothing qualifies", async () => {
    const wallet = fakeWallet(() => [
      contract({ type: "vhtlc", script: "vh1", label: "irrelevant" }),
    ]);
    const rows = await loadContractLabelsForBackup(wallet);
    expect(rows).toEqual([]);
  });

  it("propagates SDK failures as contracts_fetch_failed (fail-loud)", async () => {
    const wallet = fakeWallet(() => {
      throw new Error("indexer down");
    });
    await expect(loadContractLabelsForBackup(wallet)).rejects.toMatchObject({
      kind: "contracts_fetch_failed",
    });
    await expect(loadContractLabelsForBackup(wallet)).rejects.toBeInstanceOf(
      ArkadeError,
    );
  });
});
