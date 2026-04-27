import type { Wallet } from "../store/types";

export type ReceiveType = "arkade" | "bitcoin" | "lightning" | "lnurl";

export type ReceivePayload = {
  type: ReceiveType;
  /** Label shown in payload list, e.g. "Bitcoin (BIP-21)" */
  label: string;
  /** The full string the user will scan / share. */
  payload: string;
  /** Short user-facing destination preview. */
  destination: string;
  /** Amount embedded in the payload, if any. */
  amountSats?: number;
};

const BECH32_CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";

function deterministicHex(seed: string, bytes: number): string {
  let h1 = 0x811c9dc5;
  let h2 = 0xdeadbeef;
  for (let i = 0; i < seed.length; i++) {
    h1 = Math.imul(h1 ^ seed.charCodeAt(i), 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ seed.charCodeAt(i), 0x85ebca6b) >>> 0;
  }
  const out: string[] = [];
  for (let i = 0; i < bytes; i++) {
    h1 = Math.imul(h1 ^ (i * 2654435761), 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ (i * 1597334677), 0x85ebca6b) >>> 0;
    const byte = (h1 ^ h2) & 0xff;
    out.push(byte.toString(16).padStart(2, "0"));
  }
  return out.join("");
}

function deterministicBech32(seed: string, length: number): string {
  const hex = deterministicHex(seed, length);
  let result = "";
  for (let i = 0; i < length; i++) {
    const v = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    result += BECH32_CHARSET[v % BECH32_CHARSET.length];
  }
  return result;
}

function shorten(value: string, head = 12, tail = 8): string {
  if (value.length <= head + tail + 3) return value;
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

export function makeArkadeAddress(wallet: Wallet): string {
  return `ark1${deterministicBech32(`ark:${wallet.id}`, 56)}`;
}

export function makeBitcoinAddress(wallet: Wallet): string {
  return `bc1q${deterministicBech32(`btc:${wallet.id}`, 38)}`;
}

export function makeLnurl(wallet: Wallet): string {
  return `lnurl1${deterministicBech32(`lnurl:${wallet.id}`, 100).toUpperCase()}`;
}

/**
 * Mock BOLT-11 invoice. Real generation needs a Lightning node; this is a
 * stable placeholder until the Arkade SDK lands.
 */
export function makeLightningInvoice(wallet: Wallet, amountSats: number): string {
  const amountPart = `${Math.max(1, Math.floor(amountSats))}n`;
  const body = deterministicBech32(`ln:${wallet.id}:${amountSats}`, 240);
  return `lnbc${amountPart}1p${body}`;
}

function buildBip21(address: string, amountSats?: number, params: Record<string, string> = {}) {
  const search = new URLSearchParams();
  if (amountSats && amountSats > 0) {
    search.set("amount", (amountSats / 100_000_000).toFixed(8));
  }
  for (const [k, v] of Object.entries(params)) search.set(k, v);
  const query = search.toString();
  return query ? `bitcoin:${address}?${query}` : `bitcoin:${address}`;
}

type Options = {
  amountSats?: number;
};

/**
 * Generates the receive payload for a single selected type.
 *
 * - Arkade and Bitcoin support an optional embedded amount.
 * - LNURL ignores amount (the amount is negotiated at pay-time).
 * - Lightning REQUIRES amount; throws if missing.
 */
export function makeReceivePayload(
  wallet: Wallet,
  type: ReceiveType,
  options: Options = {},
): ReceivePayload {
  const { amountSats } = options;
  switch (type) {
    case "arkade": {
      const address = makeArkadeAddress(wallet);
      const payload =
        amountSats && amountSats > 0
          ? `${address}?amount=${(amountSats / 100_000_000).toFixed(8)}`
          : address;
      return {
        type,
        label: "Arkade",
        payload,
        destination: shorten(address),
        amountSats: amountSats && amountSats > 0 ? amountSats : undefined,
      };
    }
    case "bitcoin": {
      const address = makeBitcoinAddress(wallet);
      const payload = buildBip21(address, amountSats);
      return {
        type,
        label: amountSats ? "Bitcoin (BIP-21)" : "Bitcoin",
        payload,
        destination: shorten(address),
        amountSats: amountSats && amountSats > 0 ? amountSats : undefined,
      };
    }
    case "lnurl": {
      const payload = makeLnurl(wallet);
      return {
        type,
        label: "LNURL-pay",
        payload,
        destination: shorten(payload, 14, 6),
      };
    }
    case "lightning": {
      if (!amountSats || amountSats <= 0) {
        throw new Error("Lightning invoice requires an amount in sats");
      }
      const payload = makeLightningInvoice(wallet, amountSats);
      return {
        type,
        label: "Lightning invoice",
        payload,
        destination: shorten(payload, 14, 6),
        amountSats,
      };
    }
  }
}

/**
 * Returns every payload the user might want to share in addition to the
 * primary one. Lightning is included only when an amount-backed invoice
 * was already generated (i.e. when it is the primary type).
 */
export function makeAllPayloads(
  wallet: Wallet,
  primary: ReceiveType,
  options: Options = {},
): ReceivePayload[] {
  const list: ReceivePayload[] = [
    makeReceivePayload(wallet, "arkade", options),
    makeReceivePayload(wallet, "bitcoin", options),
    makeReceivePayload(wallet, "lnurl"),
  ];
  if (primary === "lightning") {
    list.push(makeReceivePayload(wallet, "lightning", options));
  }
  const primaryIndex = list.findIndex((p) => p.type === primary);
  if (primaryIndex > 0) {
    const [item] = list.splice(primaryIndex, 1);
    list.unshift(item);
  }
  return list;
}
