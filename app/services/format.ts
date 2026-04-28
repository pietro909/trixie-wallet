import type { BitcoinUnit, FiatCurrency } from "../store/types";

export type ResolvedBitcoinUnit = "sats" | "btc";

export const SATS_PER_BTC = 100_000_000;
export const AUTO_BTC_THRESHOLD_SATS = 1_000_000;

export const UNIT_LABEL: Record<ResolvedBitcoinUnit, string> = {
  sats: "SAT",
  btc: "₿",
};

export function resolveBitcoinUnit(
  unit: BitcoinUnit,
  referenceSats: number,
): ResolvedBitcoinUnit {
  if (unit === "sats") return "sats";
  if (unit === "btc") return "btc";
  return referenceSats >= AUTO_BTC_THRESHOLD_SATS ? "btc" : "sats";
}

export function formatSatsAs(
  sats: number,
  unit: ResolvedBitcoinUnit,
  locale?: string,
): string {
  if (unit === "btc") {
    return new Intl.NumberFormat(locale, {
      maximumFractionDigits: 8,
      minimumFractionDigits: 0,
    }).format(sats / SATS_PER_BTC);
  }
  return new Intl.NumberFormat(locale).format(sats);
}

export function formatFiat(
  amount: number,
  currency: FiatCurrency,
  locale?: string,
): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
  }).format(amount);
}
