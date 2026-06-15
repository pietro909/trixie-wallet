import { bech32, utf8 } from "@scure/base";
import {
  isLightningAddress,
  isLnurlIdentifier,
  lnurlDescriptionFrom,
  lnurlFixedAmountSats,
  lnurlInvoiceAmountAcceptable,
  maxSendableSats,
  minSendableSats,
  resolveLnurlEndpoint,
} from "../lnurl";

// Round-trip a fresh bech32 LNURL on each run so the test exercises the same
// decoder the runtime uses — pinning a hardcoded encoding would just test the
// fixture, not the resolver.
const SAMPLE_URL = "https://pay.example.com/lnurl/pay";
const SAMPLE_LNURL = bech32.encodeFromBytes("lnurl", utf8.decode(SAMPLE_URL));

describe("isLightningAddress", () => {
  it("accepts user@host.tld shapes", () => {
    expect(isLightningAddress("alice@example.com")).toBe(true);
    expect(isLightningAddress("a.b+tag@sub.example.co")).toBe(true);
  });
  it("rejects obvious non-addresses", () => {
    expect(isLightningAddress("alice")).toBe(false);
    expect(isLightningAddress("alice@")).toBe(false);
    expect(isLightningAddress("@example.com")).toBe(false);
    expect(isLightningAddress("alice@example")).toBe(false);
    expect(isLightningAddress("alice@example.c")).toBe(false);
  });
});

describe("isLnurlIdentifier", () => {
  it("accepts Lightning Addresses", () => {
    expect(isLnurlIdentifier("alice@example.com")).toBe(true);
  });
  it("accepts bech32 LNURL strings (case-insensitive)", () => {
    expect(isLnurlIdentifier(SAMPLE_LNURL)).toBe(true);
    expect(isLnurlIdentifier(SAMPLE_LNURL.toLowerCase())).toBe(true);
  });
  it("rejects random strings", () => {
    expect(isLnurlIdentifier("hello world")).toBe(false);
    expect(isLnurlIdentifier("lnurl1notvalidbech32")).toBe(false);
  });
});

describe("resolveLnurlEndpoint", () => {
  it("maps a Lightning Address to its .well-known URL", () => {
    const r = resolveLnurlEndpoint("alice@example.com");
    expect(r?.url).toBe("https://example.com/.well-known/lnurlp/alice");
    expect(r?.domain).toBe("example.com");
    expect(r?.identifier).toBe("alice@example.com");
  });
  it("preserves the last `@` so `+tag` aliases work", () => {
    const r = resolveLnurlEndpoint("alice+tag@example.com");
    expect(r?.url).toBe("https://example.com/.well-known/lnurlp/alice+tag");
  });
  it("decodes a bech32 LNURL into its encoded URL", () => {
    const r = resolveLnurlEndpoint(SAMPLE_LNURL);
    expect(r?.url).toBe(SAMPLE_URL);
    expect(r?.domain).toBe("pay.example.com");
    expect(r?.identifier).toBe(SAMPLE_LNURL);
  });
  it("returns null for unrecognized inputs", () => {
    expect(resolveLnurlEndpoint("nope")).toBeNull();
  });
  it("strips a leading lightning:/lnurl: URI scheme (POS QR form)", () => {
    // POS terminals encode the QR as `lightning:LNURL1…`; the resolver must
    // tolerate the scheme (any case, optional `//`) instead of rejecting it.
    for (const prefixed of [
      `lightning:${SAMPLE_LNURL}`,
      `LIGHTNING://${SAMPLE_LNURL}`,
      `lnurl:${SAMPLE_LNURL}`,
    ]) {
      const r = resolveLnurlEndpoint(prefixed);
      expect(r?.url).toBe(SAMPLE_URL);
      expect(r?.identifier).toBe(SAMPLE_LNURL);
    }
  });
  it("strips the scheme from a lightning: lightning address", () => {
    const r = resolveLnurlEndpoint("lightning:alice@example.com");
    expect(r?.url).toBe("https://example.com/.well-known/lnurlp/alice");
    expect(r?.identifier).toBe("alice@example.com");
  });
});

describe("lnurlDescriptionFrom", () => {
  it("returns text/plain when present", () => {
    const md = JSON.stringify([
      ["text/plain", "Pay alice"],
      ["text/long-desc", "Send sats to alice"],
    ]);
    expect(lnurlDescriptionFrom(md)).toBe("Pay alice");
  });
  it("falls back to text/long-desc", () => {
    const md = JSON.stringify([
      ["image/png;base64", "abc"],
      ["text/long-desc", "Tip jar"],
    ]);
    expect(lnurlDescriptionFrom(md)).toBe("Tip jar");
  });
  it("handles empty/malformed metadata", () => {
    expect(lnurlDescriptionFrom("")).toBeUndefined();
    expect(lnurlDescriptionFrom("not json")).toBeUndefined();
    expect(lnurlDescriptionFrom("{}")).toBeUndefined();
  });
});

describe("minSendableSats / maxSendableSats", () => {
  const params = {
    callback: "https://x/y",
    minSendable: 1000,
    maxSendable: 100_000_000,
    metadata: "",
    domain: "x",
    identifier: "x",
  };
  it("rounds min UP and max DOWN so we never offer to send an amount the endpoint will reject", () => {
    expect(minSendableSats({ ...params, minSendable: 1500 })).toBe(2);
    expect(maxSendableSats({ ...params, maxSendable: 1999 })).toBe(1);
    expect(minSendableSats(params)).toBe(1);
    expect(maxSendableSats(params)).toBe(100_000);
  });
});

describe("lnurlFixedAmountSats", () => {
  const params = {
    callback: "https://x/y",
    minSendable: 1000,
    maxSendable: 100_000_000,
    metadata: "",
    domain: "x",
    identifier: "x",
  };
  it("returns the sat amount when min === max in millisats", () => {
    // 21_000 msat fixed → 21 sats. This is the case that, left blank, produced
    // an unpayable invoice (regression: fixed-amount LNURL amount field).
    expect(
      lnurlFixedAmountSats({
        ...params,
        minSendable: 21_000,
        maxSendable: 21_000,
      }),
    ).toBe(21);
  });
  it("treats a sub-sat range that collapses to one whole sat as fixed", () => {
    // ceil(21000/1000)=21, floor(21999/1000)=21 → both 21, so it's fixed.
    expect(
      lnurlFixedAmountSats({
        ...params,
        minSendable: 21_000,
        maxSendable: 21_999,
      }),
    ).toBe(21);
  });
  it("returns null for a genuine range so the field stays user-editable", () => {
    expect(lnurlFixedAmountSats(params)).toBeNull();
    expect(
      lnurlFixedAmountSats({
        ...params,
        minSendable: 1_000,
        maxSendable: 2_000,
      }),
    ).toBeNull();
  });
});

describe("lnurlInvoiceAmountAcceptable", () => {
  it("accepts an exact match", () => {
    expect(lnurlInvoiceAmountAcceptable(14_908, 14_908)).toBe(true);
  });
  it("tolerates small fiat-pinned drift (the POS case)", () => {
    // Opago: requested 14921, minted 14908 — 13 sats ≈ 0.09%, well inside band.
    expect(lnurlInvoiceAmountAcceptable(14_921, 14_908)).toBe(true);
    expect(lnurlInvoiceAmountAcceptable(14_908, 14_921)).toBe(true);
  });
  it("rejects a grossly different amount", () => {
    expect(lnurlInvoiceAmountAcceptable(14_908, 149_080)).toBe(false);
    expect(lnurlInvoiceAmountAcceptable(14_908, 1_490)).toBe(false);
  });
  it("rejects a missing or non-positive amount", () => {
    expect(lnurlInvoiceAmountAcceptable(14_908, null)).toBe(false);
    expect(lnurlInvoiceAmountAcceptable(14_908, undefined)).toBe(false);
    expect(lnurlInvoiceAmountAcceptable(14_908, 0)).toBe(false);
  });
  it("allows a 1-sat floor so tiny amounts aren't rejected by rounding", () => {
    // 10% of 5 = 0.5, floored to 1 → a 1-sat delta is still acceptable.
    expect(lnurlInvoiceAmountAcceptable(5, 6)).toBe(true);
    expect(lnurlInvoiceAmountAcceptable(5, 7)).toBe(false);
  });
});
