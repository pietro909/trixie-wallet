import { decode as decodeBolt11 } from "light-bolt11-decoder";

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
  /** Lightning-only: invoice expiry in ms-since-epoch (Unix seconds * 1000). */
  expiresAt?: number;
  /** Lightning-only: hex-encoded BOLT11 payment hash. */
  paymentHash?: string;
};

export type ParseResult = {
  options: ParsedPaymentOption[];
  /** Unrecognised key/value pairs from BIP-21, kept for future SDK use. */
  metadata: Record<string, string>;
  error?: string;
};

const BTC_ADDRESS_RE =
  /^(bc1|tb1|bcrt1)[02-9ac-hj-np-z]{6,87}$|^[13mn2][a-km-zA-HJ-NP-Z1-9]{25,39}$/;
const LN_INVOICE_RE = /^ln(bc|tb|sb|bcrt)[0-9a-z]+$/i;
const LNURL_RE = /^lnurl1[02-9ac-hj-np-z]+$/i;
// Mainnet uses the `ark` HRP; testnet, signet, mutinynet, and regtest all use `tark`.
const ARKADE_RE = /^t?ark1[02-9ac-hj-np-z]{20,}$/i;

const KNOWN_BIP21_KEYS = new Set([
  "amount",
  "label",
  "message",
  "lightning",
  "lnurl",
  "ark",
  "arkade",
]);

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

function stripUriScheme(input: string): {
  scheme: string | null;
  rest: string;
} {
  const m = input.match(/^([a-zA-Z][a-zA-Z0-9+\-.]*):(.*)$/);
  if (!m) return { scheme: null, rest: input };
  return { scheme: m[1].toLowerCase(), rest: m[2] };
}

function splitAddressAndQuery(rest: string): {
  address: string;
  query: URLSearchParams;
} {
  const qIndex = rest.indexOf("?");
  const address = qIndex === -1 ? rest : rest.slice(0, qIndex);
  const querystring = qIndex === -1 ? "" : rest.slice(qIndex + 1);
  return { address, query: new URLSearchParams(querystring) };
}

type LightningDecodeResult = {
  amountSats: number | undefined;
  memo?: string;
  expiresAt?: number;
  paymentHash?: string;
  error?: string;
};

/**
 * Returns the absolute Unix-ms expiry of a BOLT11 invoice, or `undefined` if
 * the invoice can't be decoded. Use this instead of trusting any `expiry`
 * field returned by `@arkade-os/boltz-swap` — that wrapper falls back to the
 * raw default delta (3600 s) when the invoice has no explicit expiry tag,
 * which would mark every such invoice as expired in 1970.
 */
export function lightningInvoiceExpiresAt(invoice: string): number | undefined {
  return decodeLightning(invoice).expiresAt;
}

function decodeLightning(invoice: string): LightningDecodeResult {
  try {
    // Parse directly with light-bolt11-decoder rather than the boltz-swap
    // wrapper: the wrapper returns `expiry ?? 3600` and 3600 is the *default
    // delta* in seconds, not an absolute Unix timestamp — multiplying by 1000
    // would mark every invoice without an explicit expiry tag as expired.
    const decoded = decodeBolt11(invoice) as unknown as {
      sections: Array<{ name: string; value?: unknown }>;
    };
    const sections = decoded.sections;
    const findValue = (name: string): unknown =>
      sections.find((s) => s.name === name)?.value;
    const timestamp = findValue("timestamp");
    const expiryDelta = findValue("expiry");
    const amountMillisats = findValue("amount");
    const description = findValue("description");
    const paymentHash = findValue("payment_hash");
    const sats = amountMillisats
      ? Math.floor(Number(amountMillisats) / 1000)
      : 0;
    const expiresAt =
      typeof timestamp === "number"
        ? (timestamp + (typeof expiryDelta === "number" ? expiryDelta : 3600)) *
          1000
        : undefined;
    return {
      amountSats: sats > 0 ? sats : undefined,
      memo:
        typeof description === "string" && description
          ? description
          : undefined,
      expiresAt,
      paymentHash: typeof paymentHash === "string" ? paymentHash : undefined,
    };
  } catch (e) {
    return {
      amountSats: undefined,
      error: e instanceof Error ? e.message : "Could not decode invoice",
    };
  }
}

function buildLightningOption(
  rawInput: string,
  invoice: string,
): ParsedPaymentOption {
  const decoded = decodeLightning(invoice);
  const expired = decoded.expiresAt != null && decoded.expiresAt <= Date.now();
  const amountless = decoded.amountSats == null;
  const isPayable = !decoded.error && !expired && !amountless;
  let warning: string | undefined;
  if (decoded.error) warning = decoded.error;
  else if (expired) warning = "Invoice expired";
  else if (amountless) warning = "Amountless invoices are not supported";
  return {
    id: makeId("lightning", invoice),
    type: "lightning",
    raw: rawInput,
    destination: shorten(invoice, 14, 6),
    amountSats: decoded.amountSats,
    memo: decoded.memo,
    isPayable,
    warning,
    expiresAt: decoded.expiresAt,
    paymentHash: decoded.paymentHash,
  };
}

function buildBareLightning(rawInput: string, invoice: string): ParseResult {
  return {
    options: [buildLightningOption(rawInput, invoice)],
    metadata: {},
  };
}

function buildBareLnurl(rawInput: string, lnurl: string): ParseResult {
  return {
    options: [
      {
        id: makeId("lnurl", lnurl),
        type: "lnurl",
        raw: rawInput,
        destination: shorten(lnurl, 14, 6),
        isPayable: true,
      },
    ],
    metadata: {},
  };
}

function parseArkadeBody(rawInput: string, body: string): ParseResult {
  const metadata: Record<string, string> = {};
  const { address, query } = splitAddressAndQuery(body);
  if (!ARKADE_RE.test(address)) {
    return { options: [], metadata, error: "Invalid Arkade address" };
  }
  const amountSats = query.get("amount")
    ? btcAmountToSats(query.get("amount") ?? "")
    : undefined;
  const memo = query.get("message") ?? query.get("label") ?? undefined;
  for (const [k, v] of query.entries()) {
    if (!KNOWN_BIP21_KEYS.has(k)) metadata[k] = v;
  }
  return {
    options: [
      {
        id: makeId("arkade", address),
        type: "arkade",
        raw: rawInput,
        destination: shorten(address),
        amountSats,
        memo,
        isPayable: true,
      },
    ],
    metadata,
  };
}

function parseBitcoinBody(rawInput: string, body: string): ParseResult {
  const options: ParsedPaymentOption[] = [];
  const metadata: Record<string, string> = {};
  const { address, query } = splitAddressAndQuery(body);

  const amountStr = query.get("amount") ?? "";
  const amountSats = amountStr ? btcAmountToSats(amountStr) : undefined;
  const memo = query.get("message") ?? query.get("label") ?? undefined;

  if (BTC_ADDRESS_RE.test(address)) {
    options.push({
      id: makeId("bitcoin", address),
      type: "bitcoin",
      raw: rawInput,
      destination: shorten(address),
      amountSats,
      memo,
      isPayable: true,
    });
  } else if (address) {
    options.push({
      id: makeId("bitcoin", address),
      type: "bitcoin",
      raw: rawInput,
      destination: shorten(address),
      amountSats,
      memo,
      isPayable: false,
      warning: "Bitcoin address looks malformed",
    });
  }

  const lightningParam = query.get("lightning");
  if (lightningParam) {
    if (LN_INVOICE_RE.test(lightningParam)) {
      options.push(buildLightningOption(lightningParam, lightningParam));
    } else {
      options.push({
        id: makeId("lightning", lightningParam),
        type: "lightning",
        raw: lightningParam,
        destination: shorten(lightningParam, 14, 6),
        amountSats,
        memo,
        isPayable: false,
        warning: "Embedded lightning invoice is not valid",
      });
    }
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
    return {
      options,
      metadata,
      error: "No payable target found in BIP-21 URI",
    };
  }
  return { options, metadata };
}

export function parsePaymentInput(input: string): ParseResult {
  const trimmed = input.trim();
  if (!trimmed) {
    return { options: [], metadata: {}, error: "Enter a payment string" };
  }

  const { scheme, rest } = stripUriScheme(trimmed);

  if (scheme === "lightning") {
    const value = rest.replace(/^\/\//, "");
    const sub = detectBareType(value);
    if (sub === "lightning") return buildBareLightning(trimmed, value);
    if (sub === "lnurl") return buildBareLnurl(trimmed, value);
    return {
      options: [],
      metadata: {},
      error: "Unsupported lightning: payload",
    };
  }

  if (scheme === "arkade" || scheme === "ark") {
    return parseArkadeBody(trimmed, rest.replace(/^\/\//, ""));
  }

  if (scheme === "bitcoin") {
    return parseBitcoinBody(trimmed, rest);
  }

  // No scheme — accept raw addresses/invoices/LNURL, optionally followed by a
  // `?amount=…&message=…` query (the format `makeArkadePayload` produces).
  const addressPart = splitAddressAndQuery(trimmed).address;
  const bare = detectBareType(addressPart);
  if (!bare) {
    return { options: [], metadata: {}, error: "Unrecognised payment string" };
  }
  if (bare === "lightning") return buildBareLightning(trimmed, addressPart);
  if (bare === "lnurl") return buildBareLnurl(trimmed, addressPart);
  if (bare === "arkade") return parseArkadeBody(trimmed, trimmed);
  return parseBitcoinBody(trimmed, trimmed);
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
