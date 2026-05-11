const MAX_DECIMALS = 8;

export function isValidAssetId(id: string): boolean {
  return /^[0-9a-fA-F]{68}$/.test(id);
}

export function isValidDecimals(d: number): boolean {
  return Number.isInteger(d) && d >= 0 && d <= MAX_DECIMALS;
}

export function unitsToCents(units: bigint, decimals = 8): bigint {
  if (!isValidDecimals(decimals)) return units;
  return units * BigInt(10) ** BigInt(decimals);
}

export function centsToUnits(cents: bigint, decimals = 8): bigint {
  if (!isValidDecimals(decimals)) return cents;
  return cents / BigInt(10) ** BigInt(decimals);
}

export function truncatedAssetId(id: string): string {
  if (!id || id.length < 24) return "";
  return `${id.slice(0, 12)}...${id.slice(-12)}`;
}

function hideDots(value: bigint): string {
  const str = value.toString();
  const length = str.length * 2 > 6 ? str.length * 2 : 6;
  return "·".repeat(length);
}

export function prettyAssetAmountHide(value: bigint, suffix: string): string {
  if (!value) return "";
  const dots = hideDots(value);
  return suffix ? `${dots} ${suffix}` : dots;
}

export function prettyAssetNumber(
  num?: bigint,
  maximumFractionDigits = 8,
  useGrouping = true,
  minimumFractionDigits?: number,
): string {
  if (num === undefined || num === null) return "0";
  return new Intl.NumberFormat("en", {
    style: "decimal",
    maximumFractionDigits,
    minimumFractionDigits,
    useGrouping,
  }).format(num);
}

export function prettyAssetAmount(
  amount: bigint,
  decimals: number,
  useGrouping = true,
): string {
  if (!isValidDecimals(decimals) || decimals === 0) {
    return prettyAssetNumber(amount, 0, useGrouping);
  }

  const divisor = BigInt(10) ** BigInt(decimals);
  const negative = amount < BigInt(0);
  const abs = negative ? -amount : amount;
  const whole = abs / divisor;
  const frac = abs % divisor;
  const sign = negative ? "-" : "";

  if (frac === BigInt(0)) {
    return `${sign}${prettyAssetNumber(whole, 0, useGrouping)}`;
  }

  const fracStr = frac.toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${sign}${prettyAssetNumber(whole, 0, useGrouping)}.${fracStr}`;
}

/**
 * Parse a user-entered decimal string into base-units bigint at the given
 * decimals. Returns null if the string is invalid (more decimal places than
 * the asset supports, multiple separators, non-numeric chars).
 */
export function parseAssetAmount(
  input: string,
  decimals: number,
): bigint | null {
  if (!isValidDecimals(decimals)) return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  const match = trimmed.match(/^(\d+)(?:\.(\d+))?$/);
  if (!match) return null;
  const whole = match[1];
  const frac = match[2] ?? "";
  if (frac.length > decimals) return null;
  const padded = frac.padEnd(decimals, "0");
  try {
    return (
      BigInt(whole) * BigInt(10) ** BigInt(decimals) + BigInt(padded || "0")
    );
  } catch {
    return null;
  }
}
