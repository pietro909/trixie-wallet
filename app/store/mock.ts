import type { FiatCurrency } from "./types";

const MOCK_FIAT_RATES: Record<FiatCurrency, number> = {
  EUR: 0.00089,
  USD: 0.00097,
  GBP: 0.00076,
};

export function satsToFiat(sats: number, currency: FiatCurrency): string {
  const amount = sats * MOCK_FIAT_RATES[currency];
  const symbol = currency === "EUR" ? "€" : currency === "GBP" ? "£" : "$";
  return `${symbol}${amount.toFixed(2)}`;
}

export function formatSats(sats: number): string {
  return sats.toLocaleString("en-US");
}
