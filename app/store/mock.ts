import { formatFiat } from "../services/format";
import type { FiatCurrency } from "./types";

const MOCK_FIAT_RATES: Record<FiatCurrency, number> = {
  EUR: 0.00089,
  USD: 0.00097,
  GBP: 0.00076,
};

export function satsToFiat(sats: number, currency: FiatCurrency): string {
  return formatFiat(sats * MOCK_FIAT_RATES[currency], currency);
}
