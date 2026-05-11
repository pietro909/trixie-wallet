import type { ArkadeWalletMetadata } from "../store/types";

export type ReceiveType = "arkade" | "bitcoin" | "lightning" | "lnurl";

export type ReceivePayload = {
  type: ReceiveType;
  label: string;
  payload: string;
  destination: string;
  amountSats?: number;
};

function shorten(value: string, head = 12, tail = 8): string {
  if (value.length <= head + tail + 3) return value;
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

function buildBip21(
  address: string,
  amountSats?: number,
  params: Record<string, string> = {},
) {
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
  /** Optional asset id to bind into a BIP21 `assetid` query field. */
  assetId?: string;
  /** Optional asset amount in base units (stringified bigint). */
  assetAmountBase?: string;
  /** Optional asset ticker, used to build the human label. */
  assetTicker?: string;
};

export function makeArkadePayload(
  wallet: ArkadeWalletMetadata,
  options: Options = {},
): ReceivePayload {
  const { amountSats, assetId, assetAmountBase, assetTicker } = options;
  const address = wallet.arkAddress;
  const params = new URLSearchParams();
  if (amountSats && amountSats > 0) {
    params.set("amount", (amountSats / 100_000_000).toFixed(8));
  }
  if (assetId) {
    params.set("assetid", assetId);
    if (assetAmountBase) params.set("assetamount", assetAmountBase);
  }
  const query = params.toString();
  const payload = query ? `${address}?${query}` : address;
  const label = assetId
    ? assetTicker
      ? `Arkade · ${assetTicker}`
      : "Arkade asset"
    : "Arkade";
  return {
    type: "arkade",
    label,
    payload,
    destination: shorten(address),
    amountSats: amountSats && amountSats > 0 ? amountSats : undefined,
  };
}

export function makeBitcoinPayload(
  wallet: ArkadeWalletMetadata,
  options: Options = {},
): ReceivePayload {
  const { amountSats } = options;
  const address = wallet.boardingAddress;
  return {
    type: "bitcoin",
    label: amountSats ? "Bitcoin (BIP-21)" : "Bitcoin boarding",
    payload: buildBip21(address, amountSats),
    destination: shorten(address),
    amountSats: amountSats && amountSats > 0 ? amountSats : undefined,
  };
}

export function makeReceivePayload(
  wallet: ArkadeWalletMetadata,
  type: ReceiveType,
  options: Options = {},
): ReceivePayload {
  switch (type) {
    case "arkade":
      return makeArkadePayload(wallet, options);
    case "bitcoin":
      return makeBitcoinPayload(wallet, options);
    case "lightning":
      throw new Error("Lightning receive is not available in this milestone");
    case "lnurl":
      throw new Error("LNURL receive is not available in this milestone");
  }
}

export function makeAllPayloads(
  wallet: ArkadeWalletMetadata,
  primary: ReceiveType,
  options: Options = {},
): ReceivePayload[] {
  // When the user is receiving a specific asset, hide the BTC boarding
  // alternate since pasting it into a sender produces a Bitcoin send, not an
  // asset send.
  const list: ReceivePayload[] = options.assetId
    ? [makeArkadePayload(wallet, options)]
    : [makeArkadePayload(wallet, options), makeBitcoinPayload(wallet, options)];
  const primaryIndex = list.findIndex((p) => p.type === primary);
  if (primaryIndex > 0) {
    const [item] = list.splice(primaryIndex, 1);
    list.unshift(item);
  }
  return list;
}
