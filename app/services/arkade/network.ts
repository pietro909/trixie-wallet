export const DEFAULT_ARK_SERVER_URL = "https://mutinynet.arkade.sh";

const MAINNET_NETWORK_NAMES = new Set(["bitcoin", "mainnet"]);

const DEFAULT_DELEGATOR_URLS: Record<string, string> = {
  bitcoin: "https://delegate.arkade.money",
  mutinynet: "https://delegator.mutinynet.arkade.sh",
  regtest: "http://localhost:7012",
};

const LNURL_SERVER_URLS: Record<string, string> = {
  mutinynet: "https://lnurl.mutinynet.arkade.sh",
};

export function isMainnetForNetworkName(network: string): boolean {
  return MAINNET_NETWORK_NAMES.has(network.toLowerCase());
}

export function defaultDelegatorUrlForNetwork(
  network: string | null | undefined,
): string | null {
  if (!network) return null;
  return DEFAULT_DELEGATOR_URLS[network.toLowerCase()] ?? null;
}

export function lnurlServerUrlForNetwork(
  network: string | null | undefined,
): string | null {
  if (!network) return null;
  return LNURL_SERVER_URLS[network.toLowerCase()] ?? null;
}

const PRIVATE_HOST_RE =
  /^(localhost|127\.0\.0\.1|0\.0\.0\.0|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/i;

/**
 * Normalize a user-typed server URL: prepend a scheme (http for loopback /
 * private ranges, https everywhere else), drop trailing slashes, and validate
 * via the URL parser. Returns "" when the input cannot be turned into a URL.
 */
export function normalizeServerUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return "";
  let candidate = trimmed;
  if (!/^https?:\/\//i.test(candidate)) {
    const stripped = candidate.replace(/^\/+/, "");
    const host = stripped.split(/[/?#]/)[0].split(":")[0];
    const scheme = PRIVATE_HOST_RE.test(host) ? "http" : "https";
    candidate = `${scheme}://${stripped}`;
  }
  try {
    const u = new URL(candidate);
    return u.toString().replace(/\/+$/, "");
  } catch {
    return "";
  }
}
