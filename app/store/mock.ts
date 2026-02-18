import type { FiatCurrency, Transaction, Wallet } from "./types";

const MOCK_FIAT_RATES: Record<FiatCurrency, number> = {
  EUR: 0.00089,
  USD: 0.00097,
  GBP: 0.00076,
};

export function satsToFiat(sats: number, currency: FiatCurrency): string {
  const amount = sats * MOCK_FIAT_RATES[currency];
  const symbol = currency === "EUR" ? "\u20ac" : currency === "GBP" ? "\u00a3" : "$";
  return `${symbol}${amount.toFixed(2)}`;
}

export function formatSats(sats: number): string {
  return sats.toLocaleString("en-US");
}

function randomHex(bytes: number): string {
  const chars = "0123456789abcdef";
  let result = "";
  for (let i = 0; i < bytes * 2; i++) {
    result += chars[Math.floor(Math.random() * 16)];
  }
  return result;
}

function randomId(): string {
  return randomHex(16);
}

const MOCK_COUNTERPARTIES = [
  "Alice",
  "Bob",
  "Coffee Shop",
  "Lightning Node",
  "Ark Service Provider",
  "Faucet",
];

function generateMockTransactions(count: number): Transaction[] {
  const now = Date.now();
  const txns: Transaction[] = [];
  for (let i = 0; i < count; i++) {
    const direction = Math.random() > 0.4 ? "in" : "out";
    txns.push({
      id: randomId(),
      direction,
      amountSats: Math.floor(Math.random() * 50000) + 1000,
      timestamp: now - i * 3600000 * (Math.floor(Math.random() * 12) + 1),
      counterpartyLabel:
        MOCK_COUNTERPARTIES[Math.floor(Math.random() * MOCK_COUNTERPARTIES.length)],
      status: Math.random() > 0.2 ? "confirmed" : "pending",
    });
  }
  return txns.sort((a, b) => b.timestamp - a.timestamp);
}

export function generateMockWallet(): Wallet {
  return {
    id: randomId(),
    type: "ark",
    label: "Ark",
    balanceSats: 125000 + Math.floor(Math.random() * 50000),
    transactions: generateMockTransactions(6),
    backup: {
      privateKeyHex: randomHex(32),
      privateKeyNsec: `nsec1${randomHex(28)}`,
      mnemonic:
        "abandon ability able about above absent absorb abstract absurd abuse access accident",
    },
  };
}
