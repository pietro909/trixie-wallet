import type { Contract, Wallet } from "@arkade-os/sdk";
import { loadOwnedAddresses } from "../addresses";
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

function fakeWallet(
  getContracts: () => Promise<Contract[]> | Contract[],
): Wallet {
  return {
    getContractManager: async () => ({
      getContracts: async (_filter?: unknown) => getContracts(),
    }),
  } as unknown as Wallet;
}

describe("loadOwnedAddresses", () => {
  it("returns one row per contract with only public fields", async () => {
    const wallet = fakeWallet(() => [
      contract({
        type: "default",
        address: "ark1qdefault",
        script: "5120deadbeef",
        label: "Primary",
        // params should not leak through
        params: { secret: "do-not-expose" },
      }),
    ]);

    const rows = await loadOwnedAddresses(wallet);

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

  it("omits the label key when the contract has no label", async () => {
    const wallet = fakeWallet(() => [contract({})]);
    const [row] = await loadOwnedAddresses(wallet);
    expect("label" in row).toBe(false);
  });

  it("pins the default contract to the top regardless of createdAt", async () => {
    const wallet = fakeWallet(() => [
      contract({
        type: "delegate",
        script: "delg1",
        address: "ark1qdeleg1",
        createdAt: 1_800_000_000_000, // newest
      }),
      contract({
        type: "default",
        script: "def1",
        address: "ark1qdef1",
        createdAt: 1_700_000_000_000, // oldest
      }),
      contract({
        type: "vhtlc",
        script: "vh1",
        address: "ark1qvh1",
        createdAt: 1_750_000_000_000,
      }),
    ]);

    const rows = await loadOwnedAddresses(wallet);
    expect(rows.map((r) => r.type)).toEqual(["default", "delegate", "vhtlc"]);
  });

  it("sorts non-default contracts by createdAt desc", async () => {
    const wallet = fakeWallet(() => [
      contract({ type: "vhtlc", script: "a", createdAt: 100 }),
      contract({ type: "vhtlc", script: "b", createdAt: 300 }),
      contract({ type: "vhtlc", script: "c", createdAt: 200 }),
    ]);

    const rows = await loadOwnedAddresses(wallet);
    expect(rows.map((r) => r.script)).toEqual(["b", "c", "a"]);
  });

  it("returns an empty array when the wallet owns no contracts", async () => {
    const wallet = fakeWallet(() => []);
    const rows = await loadOwnedAddresses(wallet);
    expect(rows).toEqual([]);
  });

  it("wraps SDK failures in an ArkadeError with the right kind", async () => {
    const wallet = fakeWallet(() => {
      throw new Error("indexer down");
    });
    await expect(loadOwnedAddresses(wallet)).rejects.toMatchObject({
      kind: "addresses_fetch_failed",
    });
    await expect(loadOwnedAddresses(wallet)).rejects.toBeInstanceOf(
      ArkadeError,
    );
  });
});
