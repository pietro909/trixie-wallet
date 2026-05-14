import {
  defaultDelegatorUrlForNetwork,
  lnurlServerUrlForNetwork,
  normalizeServerUrl,
} from "../network";

describe("lnurlServerUrlForNetwork", () => {
  it("maps mutinynet to the configured LNURL server URL", () => {
    expect(lnurlServerUrlForNetwork("mutinynet")).toBe(
      "https://lnurl.mutinynet.arkade.sh",
    );
  });

  it.each([
    "bitcoin",
    "mainnet",
    "signet",
    "regtest",
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

  it("is case-insensitive", () => {
    expect(lnurlServerUrlForNetwork("MUTINYNET")).toBe(
      "https://lnurl.mutinynet.arkade.sh",
    );
  });
});

describe("defaultDelegatorUrlForNetwork (regression)", () => {
  // Sanity check that the new helper did not collide with the existing
  // delegator-url lookup — both live in the same file and rely on the same
  // case-folding pattern.
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
