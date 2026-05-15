import { type NetworkName, networks } from "@arkade-os/sdk";
import { Address } from "@scure/btc-signer";
import { decode as decodeBolt11 } from "light-bolt11-decoder";
import { isValidAssetId } from "./arkade/asset-format";

export type PaymentType = "arkade" | "bitcoin" | "lightning" | "lnurl";

const KNOWN_NETWORK_NAMES = new Set<NetworkName>([
  "bitcoin",
  "regtest",
  "testnet",
  "signet",
  "mutinynet",
]);

export function networkNameOrNull(network: string | null): NetworkName | null {
  return network && KNOWN_NETWORK_NAMES.has(network as NetworkName)
    ? (network as NetworkName)
    : null;
}

/**
 * Returns true when the address decodes against the given network's parameters.
 * `bc1…` only matches `bitcoin`; `tb1…` matches `testnet`/`signet`/`mutinynet`;
 * `bcrt1…` only matches `regtest`.
 */
export function isBitcoinAddressForNetwork(
  address: string,
  network: string | null | undefined,
): boolean {
  const trimmed = address.trim();
  if (!trimmed) return false;
  const name = networkNameOrNull(network ?? null);
  if (!name) return BTC_ADDRESS_RE.test(trimmed);
  try {
    Address(networks[name]).decode(trimmed);
    return true;
  } catch {
    return false;
  }
}

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
  /**
   * BIP21 `assetid` — valid only for Arkade options. When present, the send
   * flow narrows to an asset transfer using `assetAmountBase` (base units,
   * stringified bigint to survive React Navigation route serialization).
   */
  assetId?: string;
  assetAmountBase?: string;
};

export type ParseResult = {
  options: ParsedPaymentOption[];
  /** Unrecognised key/value pairs from BIP-21, kept for future SDK use. */
  metadata: Record<string, string>;
  error?: string;
};

export type ParsePaymentOptions = {
  /** Active wallet network. When set, Bitcoin addresses on a different network are downgraded to non-payable. */
  network?: NetworkName | null;
};

const BTC_ADDRESS_RE =
  /^(bc1|tb1|bcrt1)[02-9ac-hj-np-z]{6,87}$|^[13mn2][a-km-zA-HJ-NP-Z1-9]{25,39}$/;
const LN_INVOICE_RE = /^ln(bc|tb|sb|bcrt)[0-9a-z]+$/i;
const LNURL_RE = /^lnurl1[02-9ac-hj-np-z]+$/i;
// Lightning Address (LUD-16): same shape as a simple email, resolves to a
// `.well-known/lnurlp/<name>` LNURL-pay endpoint. Kept tighter than RFC-5322
// to match what users practically paste in.
const LN_ADDRESS_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
// Mainnet uses the `ark` HRP; testnet, signet, mutinynet, and regtest all use `tark`.
const MAINNET_ARKADE_RE = /^ark1[02-9ac-hj-np-z]{20,}$/i;
const MUTINYNET_ARKADE_RE = /^tark1[02-9ac-hj-np-z]{20,}$/i;
const ANY_ARKADE_RE = /^t?ark1[02-9ac-hj-np-z]{20,}$/i;

function networkLabel(network: NetworkName): string {
  if (network === "bitcoin") return "Mainnet";
  if (network === "mutinynet") return "Mutinynet";
  if (network === "signet") return "Signet";
  if (network === "testnet") return "Testnet";
  if (network === "regtest") return "Regtest";
  return network;
}

/**
 * `ark1…` is Bitcoin mainnet; `tark1…` is every other network (testnet, signet,
 * mutinynet, regtest). When `network` is null, any HRP matches.
 */
export function isArkadeAddressForNetwork(
  address: string,
  network: string | null | undefined,
): boolean {
  const trimmed = address.trim();
  if (!trimmed) return false;
  if (!network) return ANY_ARKADE_RE.test(trimmed);
  if (network === "bitcoin") return MAINNET_ARKADE_RE.test(trimmed);
  return MUTINYNET_ARKADE_RE.test(trimmed);
}

function arkadeHrpNetwork(address: string): "bitcoin" | "other" | null {
  if (MAINNET_ARKADE_RE.test(address)) return "bitcoin";
  if (MUTINYNET_ARKADE_RE.test(address)) return "other";
  return null;
}

function wrongNetworkArkadeWarning(
  address: string,
  activeNetwork: NetworkName,
): string | null {
  const hrpNet = arkadeHrpNetwork(address);
  if (!hrpNet) return null;
  if (hrpNet === "bitcoin" && activeNetwork === "bitcoin") return null;
  if (hrpNet === "other" && activeNetwork !== "bitcoin") return null;
  const addressLabel = hrpNet === "bitcoin" ? "Mainnet" : "Mutinynet";
  return `This is a ${addressLabel} address, but you are on ${networkLabel(activeNetwork)}`;
}

const KNOWN_BIP21_KEYS = new Set([
  "amount",
  "label",
  "message",
  "lightning",
  "lnurl",
  "ark",
  "arkade",
  "assetid",
  "assetamount",
]);

function shorten(value: string, head = 10, tail = 6): string {
  if (value.length <= head + tail + 3) return value;
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

/**
 * Shortening rule for payment destinations. Opaque bech32 LNURLs use the
 * middle-elided `shorten()` logic. Human-readable Lightning Addresses are
 * kept verbatim unless they exceed a generous threshold (30 chars), in which
 * case they are truncated at the domain to keep the username recognizable.
 */
function shortenAddress(value: string): string {
  if (LN_ADDRESS_RE.test(value)) {
    if (value.length <= 30) return value;
    const [user, domain] = value.split("@");
    if (!domain) return shorten(value, 10, 6);
    // user@domain... -> shorten(user)@shorten(domain)
    // We use a slightly different head/tail for the user part.
    return `${shorten(user, 15, 5)}@${shorten(domain, 10, 6)}`;
  }
  return shorten(value, 14, 6);
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
  // Lightning Addresses are LNURL-pay underneath — resolved to a bech32
  // endpoint by `services/arkade/lnurl.ts` later in the Send flow.
  if (LN_ADDRESS_RE.test(v)) return "lnurl";
  if (ANY_ARKADE_RE.test(v)) return "arkade";
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

export function buildLightningOption(
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
    destination: shortenAddress(invoice),
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
        destination: shortenAddress(lnurl),
        isPayable: true,
      },
    ],
    metadata: {},
  };
}

function parseArkadeBody(
  rawInput: string,
  body: string,
  options: ParsePaymentOptions,
): ParseResult {
  const metadata: Record<string, string> = {};
  const { address, query } = splitAddressAndQuery(body);
  if (!ANY_ARKADE_RE.test(address)) {
    return { options: [], metadata, error: "Invalid Arkade address" };
  }
  const networkName = options.network ?? null;
  const wrongNetwork =
    networkName != null
      ? wrongNetworkArkadeWarning(address, networkName)
      : null;
  if (wrongNetwork) {
    return {
      options: [
        {
          id: makeId("arkade", address),
          type: "arkade",
          raw: rawInput,
          destination: shorten(address),
          isPayable: false,
          warning: wrongNetwork,
        },
      ],
      metadata,
    };
  }
  const amountSats = query.get("amount")
    ? btcAmountToSats(query.get("amount") ?? "")
    : undefined;
  const memo = query.get("message") ?? query.get("label") ?? undefined;
  const assetIdRaw = query.get("assetid");
  const assetAmountRaw = query.get("assetamount");
  let assetId: string | undefined;
  let assetAmountBase: string | undefined;
  let warning: string | undefined;
  // Asset params: payable if (assetid valid AND amount, if present, parses).
  // Otherwise the URI is non-payable — silently downgrading an asset URI to a
  // BTC send would be a footgun (user expects to send the asset, not sats).
  let isPayable = true;
  if (assetIdRaw) {
    if (!isValidAssetId(assetIdRaw)) {
      warning = "Invalid asset id in payment URI";
      isPayable = false;
    } else {
      assetId = assetIdRaw;
      if (assetAmountRaw) {
        let parsed: bigint | null = null;
        try {
          parsed = BigInt(assetAmountRaw);
        } catch {
          parsed = null;
        }
        if (parsed != null && parsed > 0n) {
          assetAmountBase = parsed.toString();
        } else {
          warning = "Asset amount must be a positive integer (base units)";
          isPayable = false;
        }
      }
    }
  } else if (assetAmountRaw) {
    // `assetamount` without `assetid` is nonsense; reject.
    warning = "Asset amount specified without an asset id";
    isPayable = false;
  }
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
        isPayable,
        assetId,
        assetAmountBase,
        warning,
      },
    ],
    metadata,
  };
}

function parseBitcoinBody(
  rawInput: string,
  body: string,
  options: ParsePaymentOptions,
): ParseResult {
  const parsedOptions: ParsedPaymentOption[] = [];
  const metadata: Record<string, string> = {};
  const { address, query } = splitAddressAndQuery(body);

  const amountStr = query.get("amount") ?? "";
  const amountSats = amountStr ? btcAmountToSats(amountStr) : undefined;
  const memo = query.get("message") ?? query.get("label") ?? undefined;
  // Asset params on a `bitcoin:` URI are nonsense — assets are Arkade-only.
  // Reject the URI rather than silently dropping the asset hint and treating
  // it as a normal BTC send.
  const hasAssetParams = query.has("assetid") || query.has("assetamount");
  if (hasAssetParams) {
    return {
      options: [],
      metadata,
      error: "Asset transfers are not supported on Bitcoin on-chain URIs",
    };
  }

  if (BTC_ADDRESS_RE.test(address)) {
    const networkName = options.network ?? null;
    const matchesNetwork =
      !networkName || isBitcoinAddressForNetwork(address, networkName);
    parsedOptions.push({
      id: makeId("bitcoin", address),
      type: "bitcoin",
      raw: rawInput,
      destination: shorten(address),
      amountSats,
      memo,
      isPayable: matchesNetwork,
      warning: matchesNetwork
        ? undefined
        : `Wrong-network Bitcoin address (expected ${networkName})`,
    });
  } else if (address) {
    parsedOptions.push({
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
      parsedOptions.push(buildLightningOption(lightningParam, lightningParam));
    } else {
      parsedOptions.push({
        id: makeId("lightning", lightningParam),
        type: "lightning",
        raw: lightningParam,
        destination: shortenAddress(lightningParam),
        amountSats,
        memo,
        isPayable: false,
        warning: "Embedded lightning invoice is not valid",
      });
    }
  }

  const lnurlParam = query.get("lnurl");
  if (
    lnurlParam &&
    (LNURL_RE.test(lnurlParam) || LN_ADDRESS_RE.test(lnurlParam))
  ) {
    parsedOptions.push({
      id: makeId("lnurl", lnurlParam),
      type: "lnurl",
      raw: lnurlParam,
      destination: shortenAddress(lnurlParam),
      memo,
      isPayable: true,
    });
  }

  const arkParam = query.get("ark") ?? query.get("arkade");
  if (arkParam && ANY_ARKADE_RE.test(arkParam)) {
    const networkName = options.network ?? null;
    const wrongNetwork =
      networkName != null
        ? wrongNetworkArkadeWarning(arkParam, networkName)
        : null;
    parsedOptions.push({
      id: makeId("arkade", arkParam),
      type: "arkade",
      raw: arkParam,
      destination: shorten(arkParam),
      amountSats: wrongNetwork ? undefined : amountSats,
      memo: wrongNetwork ? undefined : memo,
      isPayable: wrongNetwork == null,
      warning: wrongNetwork ?? undefined,
    });
  }

  for (const [k, v] of query.entries()) {
    if (!KNOWN_BIP21_KEYS.has(k)) metadata[k] = v;
  }

  if (parsedOptions.length === 0) {
    return {
      options: parsedOptions,
      metadata,
      error: "No payable target found in BIP-21 URI",
    };
  }
  return { options: parsedOptions, metadata };
}

export function parsePaymentInput(
  input: string,
  options: ParsePaymentOptions = {},
): ParseResult {
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
    return parseArkadeBody(trimmed, rest.replace(/^\/\//, ""), options);
  }

  if (scheme === "bitcoin") {
    return parseBitcoinBody(trimmed, rest, options);
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
  if (bare === "arkade") return parseArkadeBody(trimmed, trimmed, options);
  return parseBitcoinBody(trimmed, trimmed, options);
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
