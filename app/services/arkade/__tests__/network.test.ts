import {
  defaultDelegatorUrlForNetwork,
  isMainnetForNetworkName,
  lnurlServerUrlForNetwork,
  MAINNET_ARK_SERVER_URL,
  MUTINYNET_ARK_SERVER_URL,
  normalizeServerUrl,
} from "../network";

describe("lnurlServerUrlForNetwork", () => {
  it("maps mutinynet to the configured LNURL server URL", () => {
    expect(lnurlServerUrlForNetwork("mutinynet")).toBe(
      "https://lnurl.mutinynet.arkade.sh",
    );
  });

  it("maps bitcoin to the configured mainnet LNURL server URL", () => {
    expect(lnurlServerUrlForNetwork("bitcoin")).toBe("https://lnurl.arkade.sh");
  });

  it.each([
    "signet",
    "regtest",
    "testnet",
    "mainnet",
    "unknown",
  ])("returns null for unsupported network %p", (network) => {
    expect(lnurlServerUrlForNetwork(network)).toBeNull();
  });

  it.each([
    null,
    undefined,
    "",
  ])("returns null for nullish or empty input %p", (network) => {
    expect(lnurlServerUrlForNetwork(network)).toBeNull();
  });
});

describe("isMainnetForNetworkName", () => {
  it("returns true for the SDK 'bitcoin' value", () => {
    expect(isMainnetForNetworkName("bitcoin")).toBe(true);
  });

  it("does not accept the legacy 'mainnet' alias", () => {
    // Milestone 16: callers pass SDK NetworkName strings only; no alias shim.
    expect(isMainnetForNetworkName("mainnet")).toBe(false);
  });

  it.each([
    "mutinynet",
    "signet",
    "testnet",
    "regtest",
  ])("returns false for non-mainnet network %p", (network) => {
    expect(isMainnetForNetworkName(network)).toBe(false);
  });
});

describe("Arkade server URL constants", () => {
  it("exports the canonical mainnet Ark server URL", () => {
    expect(MAINNET_ARK_SERVER_URL).toBe("https://arkade.computer");
  });

  it("exports the canonical mutinynet Ark server URL", () => {
    expect(MUTINYNET_ARK_SERVER_URL).toBe("https://mutinynet.arkade.sh");
  });
});

describe("defaultDelegatorUrlForNetwork (regression)", () => {
  // Sanity check that the new helper did not collide with the existing
  // delegator-url lookup — both live in the same file and rely on the same
  // lookup pattern.
  it("still resolves the mutinynet delegator", () => {
    expect(defaultDelegatorUrlForNetwork("mutinynet")).toBe(
      "https://delegator.mutinynet.arkade.sh",
    );
  });
});

describe("normalizeServerUrl (regression)", () => {
  it("is unaffected by the new LNURL helper", () => {
    expect(normalizeServerUrl("example.com")).toBe("https://example.com");
  });
});
