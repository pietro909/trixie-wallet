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

/**
 * Format a numeric value for display.
 *
 * Note: web devs expect the `Intl.NumberFormat` API to accept `BigInt` like
 * V8/Chrome does, but some JS engines used on Android (Hermes or older JSC
 * builds) either reject `BigInt` or throw when converting it to `Number`.
 * That leads to runtime `TypeError: Cannot convert BigInt to number` errors
 * which we've observed in the Android emulator. To be robust across engines
 * we handle `bigint` specially:
 *  - If the `bigint` fits within `Number.MAX_SAFE_INTEGER`, we pass it to
 *    `Intl.NumberFormat` (preserving locale, grouping and fraction settings).
 *  - Otherwise we fall back to a safe, engine-independent formatting of the
 *    integer portion (manual thousands grouping). For consistency with callers
 *    that rely on `minimumFractionDigits`, we append zeroes up to the
 *    requested minimum (clamped by `maximumFractionDigits`) — note this is a
 *    simple fallback and does not reproduce all locale-specific fractional
 *    formatting/rounding behavior of `Intl`.
 */
export function prettyAssetNumber(
  num?: bigint | number,
  maximumFractionDigits = 8,
  useGrouping = true,
  minimumFractionDigits?: number,
): string {
  if (num === undefined || num === null) return "0";
  try {
    if (typeof num === "bigint") {
      const sign = num < BigInt(0) ? "-" : "";
      const absStr = (num < BigInt(0) ? (-num).toString() : num.toString());
      // Compute how many fractional zeroes to append for the fallback. If
      // caller requested a minimum, append that many zeros (but don't exceed
      // the maximumFractionDigits if provided).
      const minFrac = Math.max(0, minimumFractionDigits ?? 0);
      const fracCount = Math.min(maximumFractionDigits, minFrac);

      // If the bigint fits into a JS number safely, prefer Intl formatting
      const maxSafe = BigInt(Number.MAX_SAFE_INTEGER);
      const minSafe = BigInt(Number.MIN_SAFE_INTEGER);
      if (num <= maxSafe && num >= minSafe) {
        return new Intl.NumberFormat("en", {
          style: "decimal",
          maximumFractionDigits,
          minimumFractionDigits,
          useGrouping,
        }).format(Number(num));
      }

      // Fallback: apply grouping to the integer string manually (or leave as
      //-is when grouping disabled), then append fractional zeroes if needed.
      const grouped = useGrouping
        ? absStr.replace(/\B(?=(\d{3})+(?!\d))/g, ",")
        : absStr;
      const fracSuffix = fracCount > 0 ? `.${"0".repeat(fracCount)}` : "";
      return `${sign}${grouped}${fracSuffix}`;
    }

    const r = new Intl.NumberFormat("en", {
      style: "decimal",
      maximumFractionDigits,
      minimumFractionDigits,
      useGrouping,
    }).format(num);
    return r;
  } catch (e) {
    console.error(`Failed to format number: ${num} of type ${typeof num}`, e);
    return "0";
  }
}

export function prettyAssetAmount(
  amount: bigint,
  decimals: number,
  useGrouping = true,
): string {
  if (!isValidDecimals(decimals) || decimals === 0) {
    return prettyAssetNumber(amount, 0, useGrouping);
  }

  const negative = amount < BigInt(0);
  const abs = negative ? -amount : amount;

  const sign = negative ? "-" : "";

  const divisor = BigInt(10) ** BigInt(decimals);
  const whole = abs / divisor;
  const frac = abs % divisor;

  const formattedWhole = prettyAssetNumber(whole, 0, useGrouping);

  if (frac === BigInt(0)) {
    return `${sign}${formattedWhole}`;
  }

  const fracStr = frac.toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${sign}${formattedWhole}.${fracStr}`;
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
