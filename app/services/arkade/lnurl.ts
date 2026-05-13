import { bech32, utf8 } from "@scure/base";

/**
 * Lightning Address regex. Intentionally tighter than a full RFC-5322 email
 * grammar — LN addresses are practically `<user>@<host>` with a TLD; we use
 * the same constraint as the sibling Arkade Wallet to stay interoperable
 * with what users paste in.
 */
const LN_ADDRESS_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const LNURL_PREFIX_RE = /^lnurl1/i;

const DEFAULT_TIMEOUT_MS = 15_000;

export type LnurlPayParams = {
  /** Endpoint that mints invoices when called with `?amount=<msat>`. */
  callback: string;
  /** Smallest invoice the endpoint will mint, in millisatoshis. */
  minSendable: number;
  /** Largest invoice the endpoint will mint, in millisatoshis. */
  maxSendable: number;
  /** Raw LUD-06 metadata array, stringified JSON. May be empty. */
  metadata: string;
  /**
   * Max characters the endpoint will accept on the `?comment=` query string.
   * Undefined when the endpoint doesn't advertise LUD-12 support.
   */
  commentAllowed?: number;
  /** Display host (e.g. `pay.example.com`). */
  domain: string;
  /** Original user-facing identifier (LN address or bech32 LNURL). */
  identifier: string;
};

export type LnurlEndpoint = {
  url: string;
  domain: string;
  identifier: string;
};

export function isLightningAddress(input: string): boolean {
  return LN_ADDRESS_RE.test(input.trim());
}

function isBech32Lnurl(input: string): boolean {
  const v = input.trim().toLowerCase();
  if (!LNURL_PREFIX_RE.test(v)) return false;
  try {
    bech32.decodeToBytes(v);
    return true;
  } catch {
    return false;
  }
}

export function isLnurlIdentifier(input: string): boolean {
  return isLightningAddress(input) || isBech32Lnurl(input);
}

/**
 * Resolves the LNURL params endpoint for either a Lightning Address
 * (`<name>@<host>` → `https://<host>/.well-known/lnurlp/<name>`) or a
 * bech32 `lnurl1…` string (bytes decode to a UTF-8 URL). Returns `null`
 * if neither form is recognised.
 */
export function resolveLnurlEndpoint(input: string): LnurlEndpoint | null {
  const v = input.trim();
  if (isLightningAddress(v)) {
    const at = v.lastIndexOf("@");
    const name = v.slice(0, at);
    const host = v.slice(at + 1);
    return {
      url: `https://${host}/.well-known/lnurlp/${name}`,
      domain: host,
      identifier: v,
    };
  }
  if (!isBech32Lnurl(v)) return null;
  try {
    const { bytes } = bech32.decodeToBytes(v.toLowerCase());
    const url = utf8.encode(bytes);
    const parsed = new URL(url);
    return { url, domain: parsed.host, identifier: v };
  } catch {
    return null;
  }
}

async function timedFetchJson<T>(
  url: string,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let res: Response;
    try {
      res = await fetch(url, { signal: controller.signal });
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") {
        throw new Error("LNURL endpoint timed out");
      }
      throw new Error("LNURL endpoint unreachable");
    }
    if (!res.ok) {
      throw new Error(`LNURL endpoint returned HTTP ${res.status}`);
    }
    try {
      return (await res.json()) as T;
    } catch {
      throw new Error("LNURL endpoint returned malformed JSON");
    }
  } finally {
    clearTimeout(timer);
  }
}

type LnurlPayResponse = {
  tag?: string;
  callback?: unknown;
  minSendable?: unknown;
  maxSendable?: unknown;
  metadata?: unknown;
  commentAllowed?: unknown;
  status?: unknown;
  reason?: unknown;
};

export async function fetchLnurlParams(input: string): Promise<LnurlPayParams> {
  const endpoint = resolveLnurlEndpoint(input);
  if (!endpoint) throw new Error("Not a valid LNURL identifier");
  const data = await timedFetchJson<LnurlPayResponse>(endpoint.url);
  if (data.status === "ERROR") {
    const reason = typeof data.reason === "string" ? data.reason : "Unknown";
    throw new Error(`LNURL endpoint error: ${reason}`);
  }
  if (data.tag && data.tag !== "payRequest") {
    throw new Error(`Unsupported LNURL tag: ${data.tag}`);
  }
  if (typeof data.callback !== "string" || !data.callback) {
    throw new Error("LNURL response missing callback");
  }
  if (
    typeof data.minSendable !== "number" ||
    typeof data.maxSendable !== "number"
  ) {
    throw new Error("LNURL response missing min/max sendable");
  }
  if (data.minSendable <= 0 || data.maxSendable < data.minSendable) {
    throw new Error("LNURL response has invalid min/max range");
  }
  return {
    callback: data.callback,
    minSendable: data.minSendable,
    maxSendable: data.maxSendable,
    metadata: typeof data.metadata === "string" ? data.metadata : "",
    commentAllowed:
      typeof data.commentAllowed === "number" && data.commentAllowed > 0
        ? data.commentAllowed
        : undefined,
    domain: endpoint.domain,
    identifier: endpoint.identifier,
  };
}

type LnurlCallbackResponse = {
  pr?: unknown;
  status?: unknown;
  reason?: unknown;
};

export async function fetchLnurlInvoice(
  params: LnurlPayParams,
  amountSats: number,
  comment?: string,
): Promise<string> {
  const amountMsat = Math.round(amountSats * 1000);
  if (amountMsat < params.minSendable || amountMsat > params.maxSendable) {
    throw new Error("Amount is outside the LNURL sendable range");
  }
  let url: URL;
  try {
    url = new URL(params.callback);
  } catch {
    throw new Error("LNURL callback URL is malformed");
  }
  url.searchParams.set("amount", String(amountMsat));
  if (
    comment &&
    typeof params.commentAllowed === "number" &&
    params.commentAllowed > 0
  ) {
    url.searchParams.set("comment", comment.slice(0, params.commentAllowed));
  }
  const data = await timedFetchJson<LnurlCallbackResponse>(url.toString());
  if (data.status === "ERROR") {
    const reason = typeof data.reason === "string" ? data.reason : "Unknown";
    throw new Error(`LNURL callback error: ${reason}`);
  }
  if (typeof data.pr !== "string" || !data.pr) {
    throw new Error("LNURL callback did not return an invoice");
  }
  return data.pr;
}

/**
 * Extract the first user-facing description from LUD-06 metadata. The metadata
 * is a JSON array of `[mime, value]` pairs; prefer short text/plain then fall
 * back to long-desc.
 */
export function lnurlDescriptionFrom(metadata: string): string | undefined {
  if (!metadata) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(metadata);
  } catch {
    return undefined;
  }
  if (!Array.isArray(parsed)) return undefined;
  const findEntry = (tag: string): string | undefined => {
    for (const entry of parsed) {
      if (
        Array.isArray(entry) &&
        entry[0] === tag &&
        typeof entry[1] === "string"
      ) {
        return entry[1];
      }
    }
    return undefined;
  };
  return findEntry("text/plain") ?? findEntry("text/long-desc");
}

export function minSendableSats(params: LnurlPayParams): number {
  return Math.ceil(params.minSendable / 1000);
}

export function maxSendableSats(params: LnurlPayParams): number {
  return Math.floor(params.maxSendable / 1000);
}
