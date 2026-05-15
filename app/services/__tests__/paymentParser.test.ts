import { isArkadeAddressForNetwork, parsePaymentInput } from "../paymentParser";

describe("paymentParser", () => {
  describe("shortenAddress logic via parsePaymentInput", () => {
    it("does not shorten standard-length Lightning Addresses", () => {
      const input = "alice@example.com";
      const result = parsePaymentInput(input);
      expect(result.options[0].destination).toBe("alice@example.com");
    });

    it("does not shorten Lightning Addresses up to 30 chars", () => {
      const input = "abcdefghijklmnopqrstuvwxyz@a.co"; // 31 chars total
      const result = parsePaymentInput(input);
      // It should shorten because it's > 30 chars
      expect(result.options[0].destination).toContain("…");
    });

    it("keeps Lightning Addresses verbatim if <= 30 chars", () => {
      const input = "1234567890123456789012345@a.co"; // 30 chars
      const result = parsePaymentInput(input);
      expect(result.options[0].destination).toBe(
        "1234567890123456789012345@a.co",
      );
    });

    it("shortens the domain part of long Lightning Addresses", () => {
      const input = "alice@extremely-long-subdomain-that-goes-on-and-on.com";
      const result = parsePaymentInput(input);
      // user@domain... -> alice@extremely-…on.com
      expect(result.options[0].destination).toBe("alice@extremely-…on.com");
    });

    it("shortens both parts of extremely long Lightning Addresses", () => {
      const input =
        "very-very-very-long-username-that-exceeds-fifteen-chars@extremely-long-subdomain.com";
      const result = parsePaymentInput(input);
      expect(result.options[0].destination).toBe(
        "very-very-very-…chars@extremely-…in.com",
      );
    });

    it("shortens opaque bech32 LNURLs using middle-elision (14/6)", () => {
      const lnurl =
        "lnurl1dp68gurn8ghj7mrww4exctndw46xjmnedejhgtnpwf4kzer99eekstmvde6hymp0xvmnxdmxx33nzcmpv93rsvvxxx";
      const result = parsePaymentInput(lnurl);
      // head=14, tail=6
      expect(result.options[0].destination).toBe("lnurl1dp68gurn…svvxxx");
      expect(result.options[0].destination.length).toBe(14 + 1 + 6);
    });

    it("shortens BOLT11 invoices using middle-elision (14/6)", () => {
      const invoice =
        "lnbc1pvjluezpp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypqdpl2pkx2ctnv5sxxmmwwd5kgetjypehxtn4v4skxct5v5sxmmanv96xv6txdanxyct5v5sxmmanv96xv6txdanxyct5v5sxmmanv96xv6txdanz3tsq9";
      const result = parsePaymentInput(invoice);
      expect(result.options[0].destination).toBe("lnbc1pvjluezpp…z3tsq9");
      expect(result.options[0].destination.length).toBe(14 + 1 + 6);
    });
  });

  describe("parsePaymentInput basic validation", () => {
    it("parses a plain Bitcoin address", () => {
      const addr = "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh";
      const result = parsePaymentInput(addr);
      expect(result.options[0].type).toBe("bitcoin");
      expect(result.options[0].destination).toBe("bc1qxy2kgd…hx0wlh"); // default 10/6
    });

    it("parses an Arkade address", () => {
      // Use a valid tark1 address from existing tests if possible, or just a valid bech32 shape.
      const addr = "tark1qpzry9x8gf2tvdw0s3jn54khce6mua7l093959";
      const result = parsePaymentInput(addr);
      expect(result.options[0].type).toBe("arkade");
      expect(result.options[0].destination).toBe("tark1qpzry…093959"); // default 10/6
    });
  });

  describe("Arkade HRP / network gating", () => {
    const tarkAddress = "tark1qpzry9x8gf2tvdw0s3jn54khce6mua7l093959";
    const arkAddress = "ark1qpzry9x8gf2tvdw0s3jn54khce6mua7l09zzzzz";

    it("flags a mainnet ark1 address as non-payable on mutinynet", () => {
      const result = parsePaymentInput(arkAddress, { network: "mutinynet" });
      expect(result.options).toHaveLength(1);
      expect(result.options[0].type).toBe("arkade");
      expect(result.options[0].isPayable).toBe(false);
      expect(result.options[0].warning).toBe(
        "This is a Mainnet address, but you are on Mutinynet",
      );
    });

    it("flags a mutinynet tark1 address as non-payable on bitcoin/mainnet", () => {
      const result = parsePaymentInput(tarkAddress, { network: "bitcoin" });
      expect(result.options).toHaveLength(1);
      expect(result.options[0].type).toBe("arkade");
      expect(result.options[0].isPayable).toBe(false);
      expect(result.options[0].warning).toBe(
        "This is a Mutinynet address, but you are on Mainnet",
      );
    });

    it("accepts a matching tark1 address on mutinynet", () => {
      const result = parsePaymentInput(tarkAddress, { network: "mutinynet" });
      expect(result.options[0].isPayable).toBe(true);
      expect(result.options[0].warning).toBeUndefined();
    });

    it("accepts a matching ark1 address on bitcoin", () => {
      const result = parsePaymentInput(arkAddress, { network: "bitcoin" });
      expect(result.options[0].isPayable).toBe(true);
      expect(result.options[0].warning).toBeUndefined();
    });

    it("downgrades the arkade option in a BIP21 URI when HRP does not match", () => {
      // Active network is bitcoin/mainnet: btc address is payable, embedded
      // tark1 ark param is downgraded to non-payable with a warning.
      const input = `bitcoin:bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh?ark=${tarkAddress}`;
      const result = parsePaymentInput(input, { network: "bitcoin" });
      const bitcoinOption = result.options.find((o) => o.type === "bitcoin");
      const arkadeOption = result.options.find((o) => o.type === "arkade");
      expect(bitcoinOption?.isPayable).toBe(true);
      expect(arkadeOption?.isPayable).toBe(false);
      expect(arkadeOption?.warning).toBe(
        "This is a Mutinynet address, but you are on Mainnet",
      );
    });
  });

  describe("isArkadeAddressForNetwork", () => {
    const tarkAddress = "tark1qpzry9x8gf2tvdw0s3jn54khce6mua7l093959";
    const arkAddress = "ark1qpzry9x8gf2tvdw0s3jn54khce6mua7l09zzzzz";

    it("matches ark1 only when network is bitcoin", () => {
      expect(isArkadeAddressForNetwork(arkAddress, "bitcoin")).toBe(true);
      expect(isArkadeAddressForNetwork(arkAddress, "mutinynet")).toBe(false);
    });

    it("matches tark1 only when network is non-bitcoin", () => {
      expect(isArkadeAddressForNetwork(tarkAddress, "mutinynet")).toBe(true);
      expect(isArkadeAddressForNetwork(tarkAddress, "bitcoin")).toBe(false);
    });

    it("returns true for either HRP when network is null", () => {
      expect(isArkadeAddressForNetwork(arkAddress, null)).toBe(true);
      expect(isArkadeAddressForNetwork(tarkAddress, null)).toBe(true);
    });

    it("returns false for empty input", () => {
      expect(isArkadeAddressForNetwork("", "bitcoin")).toBe(false);
    });
  });
});
