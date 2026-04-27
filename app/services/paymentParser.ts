export type PaymentType = "arkade" | "bitcoin" | "lightning" | "lnurl";

export type ParsedPaymentOption = {
  id: string;
  type: PaymentType;
  /** Original input slice that produced this option. */
  raw: string;
  /** Human-readable destination preview. */
  destination: string;
  amountSats?: number;
  memo?: string;
  isPayable: boolean;
  warning?: string;
};

export type ParseResult = {
  options: ParsedPaymentOption[];
  /** Unrecognised key/value pairs from BIP-21, kept for future SDK use. */
  metadata: Record<string, string>;
  error?: string;
};

const BTC_ADDRESS_RE = /^(bc1|tb1|bcrt1)[02-9ac-hj-np-z]{6,87}$|^[13mn2][a-km-zA-HJ-NP-Z1-9]{25,39}$/;
const LN_INVOICE_RE = /^ln(bc|tb|sb|bcrt)[0-9a-z]+$/i;
const LNURL_RE = /^lnurl1[02-9ac-hj-np-z]+$/i;
const ARKADE_RE = /^ark1[02-9ac-hj-np-z]{20,}$/i;

const KNOWN_BIP21_KEYS = new Set(["amount", "label", "message", "lightning", "lnurl", "ark", "arkade"]);

function shorten(value: string, head = 10, tail = 6): string {
  if (value.length <= head + tail + 3) return value;
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

function makeId(type: PaymentType, raw: string): string {
  return `${type}:${raw.slice(0, 24)}:${raw.length}`;
}

function btcAmountToSats(value: string): number | undefined {
  const n = Number.parseFloat(value);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return Math.round(n * 100_000_000);
}

function detectBareType(value: string): PaymentType | null {
  const v = value.trim();
  if (LN_INVOICE_RE.test(v)) return "lightning";
  if (LNURL_RE.test(v)) return "lnurl";
  if (ARKADE_RE.test(v)) return "arkade";
  if (BTC_ADDRESS_RE.test(v)) return "bitcoin";
  return null;
}

function stripUriScheme(input: string): { scheme: string | null; rest: string } {
  const m = input.match(/^([a-zA-Z][a-zA-Z0-9+\-.]*):(.*)$/);
  if (!m) return { scheme: null, rest: input };
  return { scheme: m[1].toLowerCase(), rest: m[2] };
}

function parseBip21(rest: string): {
  address: string;
  query: URLSearchParams;
} {
  const qIndex = rest.indexOf("?");
  const address = qIndex === -1 ? rest : rest.slice(0, qIndex);
  const querystring = qIndex === -1 ? "" : rest.slice(qIndex + 1);
  return { address, query: new URLSearchParams(querystring) };
}

function lightningInvoiceAmountSats(invoice: string): number | undefined {
  // BOLT-11 amount: optional digits + multiplier (m/u/n/p) right after lnbc
  const m = invoice.match(/^ln(?:bc|tb|sb|bcrt)(\d+)([munp])?/i);
  if (!m) return undefined;
  const digits = Number.parseInt(m[1], 10);
  if (!Number.isFinite(digits)) return undefined;
  const mult = m[2]?.toLowerCase();
  // value in BTC = digits * 10^-(multiplier)
  const factor: Record<string, number> = { m: 1e-3, u: 1e-6, n: 1e-9, p: 1e-12 };
  const btc = mult ? digits * factor[mult] : digits;
  return Math.round(btc * 100_000_000);
}

export function parsePaymentInput(input: string): ParseResult {
  const trimmed = input.trim();
  if (!trimmed) {
    return { options: [], metadata: {}, error: "Enter a payment string" };
  }

  const options: ParsedPaymentOption[] = [];
  const metadata: Record<string, string> = {};

  const bare = detectBareType(trimmed);
  if (bare) {
    if (bare === "lightning") {
      const amountSats = lightningInvoiceAmountSats(trimmed);
      options.push({
        id: makeId(bare, trimmed),
        type: bare,
        raw: trimmed,
        destination: shorten(trimmed, 14, 6),
        amountSats,
        isPayable: true,
      });
    } else {
      options.push({
        id: makeId(bare, trimmed),
        type: bare,
        raw: trimmed,
        destination: shorten(trimmed, bare === "lnurl" ? 14 : 10, 6),
        isPayable: true,
      });
    }
    return { options, metadata };
  }

  const { scheme, rest } = stripUriScheme(trimmed);

  if (scheme === "lightning") {
    const value = rest.replace(/^\/\//, "");
    const sub = detectBareType(value);
    if (sub === "lightning" || sub === "lnurl") {
      return parsePaymentInput(value);
    }
    return { options: [], metadata, error: "Unsupported lightning: payload" };
  }

  if (scheme === "arkade" || scheme === "ark") {
    const value = rest.replace(/^\/\//, "");
    const { address, query } = parseBip21(value);
    if (!ARKADE_RE.test(address)) {
      return { options: [], metadata, error: "Invalid Arkade address" };
    }
    const amountSats = query.get("amount") ? btcAmountToSats(query.get("amount") ?? "") : undefined;
    options.push({
      id: makeId("arkade", address),
      type: "arkade",
      raw: trimmed,
      destination: shorten(address),
      amountSats,
      memo: query.get("message") ?? query.get("label") ?? undefined,
      isPayable: true,
    });
    return { options, metadata };
  }

  if (scheme === "bitcoin") {
    const { address, query } = parseBip21(rest);

    const amountStr = query.get("amount") ?? "";
    const amountSats = amountStr ? btcAmountToSats(amountStr) : undefined;
    const memo = query.get("message") ?? query.get("label") ?? undefined;

    if (BTC_ADDRESS_RE.test(address)) {
      options.push({
        id: makeId("bitcoin", address),
        type: "bitcoin",
        raw: trimmed,
        destination: shorten(address),
        amountSats,
        memo,
        isPayable: true,
      });
    } else if (address) {
      options.push({
        id: makeId("bitcoin", address),
        type: "bitcoin",
        raw: trimmed,
        destination: shorten(address),
        amountSats,
        memo,
        isPayable: false,
        warning: "Bitcoin address looks malformed",
      });
    }

    const lightningParam = query.get("lightning");
    if (lightningParam) {
      const subAmount = lightningInvoiceAmountSats(lightningParam);
      const valid = LN_INVOICE_RE.test(lightningParam);
      options.push({
        id: makeId("lightning", lightningParam),
        type: "lightning",
        raw: lightningParam,
        destination: shorten(lightningParam, 14, 6),
        amountSats: subAmount ?? amountSats,
        memo,
        isPayable: valid,
        warning: valid ? undefined : "Embedded lightning invoice is not valid",
      });
    }

    const lnurlParam = query.get("lnurl");
    if (lnurlParam && LNURL_RE.test(lnurlParam)) {
      options.push({
        id: makeId("lnurl", lnurlParam),
        type: "lnurl",
        raw: lnurlParam,
        destination: shorten(lnurlParam, 14, 6),
        memo,
        isPayable: true,
      });
    }

    const arkParam = query.get("ark") ?? query.get("arkade");
    if (arkParam && ARKADE_RE.test(arkParam)) {
      options.push({
        id: makeId("arkade", arkParam),
        type: "arkade",
        raw: arkParam,
        destination: shorten(arkParam),
        amountSats,
        memo,
        isPayable: true,
      });
    }

    for (const [k, v] of query.entries()) {
      if (!KNOWN_BIP21_KEYS.has(k)) metadata[k] = v;
    }

    if (options.length === 0) {
      return { options, metadata, error: "No payable target found in BIP-21 URI" };
    }
    return { options, metadata };
  }

  return {
    options: [],
    metadata,
    error: "Unrecognised payment string",
  };
}

export function paymentTypeLabel(type: PaymentType): string {
  switch (type) {
    case "arkade":
      return "Arkade";
    case "bitcoin":
      return "Bitcoin on-chain";
    case "lightning":
      return "Lightning";
    case "lnurl":
      return "LNURL";
  }
}
