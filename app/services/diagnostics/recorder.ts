/**
 * In-memory ring buffer of structured error events.
 *
 * Used by the support-bundle export (Milestone 7). Not a crash reporter —
 * uncaught exceptions and native crashes are out of scope; that work belongs
 * to a later production-readiness pass with Sentry or equivalent. This buffer
 * captures errors at instrumented call sites so a user reporting an issue can
 * reproduce, export the bundle, and let support see the failures.
 *
 * Design rules:
 *  - Redaction happens at write time, not export time. The buffer therefore
 *    only ever contains safe strings.
 *  - Fixed in-memory capacity. Lost on app restart by design.
 *  - Structured-only API. There is no console interception.
 */

export type ErrorCategory =
  | "send"
  | "receive"
  | "lightning"
  | "swap"
  | "wallet"
  | "server"
  | "backup"
  | "activity"
  | "unknown";

export type ErrorDetailValue = string | number | boolean | null;

export type ErrorEntry = {
  /** ms since epoch when the error was recorded. */
  timestamp: number;
  category: ErrorCategory;
  /** Redacted, length-bounded human-readable message. */
  message: string;
  /** Optional flat key/value map. All string values are redacted. */
  details?: Record<string, ErrorDetailValue>;
};

const MAX_ENTRIES = 200;
const MAX_FIELD_LEN = 500;
const buffer: ErrorEntry[] = [];

export function recordError(
  category: ErrorCategory,
  message: string,
  details?: Record<string, string | number | boolean | null | undefined>,
): void {
  const entry: ErrorEntry = {
    timestamp: Date.now(),
    category,
    message: redactString(
      typeof message === "string" ? message : String(message),
    ),
  };
  if (details) {
    const redacted = redactDetails(details);
    if (Object.keys(redacted).length > 0) entry.details = redacted;
  }
  buffer.push(entry);
  while (buffer.length > MAX_ENTRIES) buffer.shift();
}

export function getRecentErrors(): ErrorEntry[] {
  return buffer.slice();
}

export function clearRecentErrors(): void {
  buffer.length = 0;
}

// ===== Redaction =====

// Patterns that strip known secret-bearing or PII-bearing tokens before they
// hit the buffer. Order matters: longer-prefixed patterns first.
const REDACTORS: Array<{ regex: RegExp; replacement: string }> = [
  // Lightning BOLT11 invoices: lnbc / lntb / lnbcrt / lnsb / lnbs
  {
    regex: /\b(lnbcrt|lnbc|lntb|lnsb|lnbs)[0-9a-z]{20,}/gi,
    replacement: "[invoice]",
  },
  // Bitcoin bech32 addresses (segwit + taproot): bc1, tb1, bcrt1
  {
    regex: /\b(bcrt1|bc1|tb1)[0-9a-z]{20,}/gi,
    replacement: "[btc-address]",
  },
  // Arkade bech32 addresses: ark1, tark1
  {
    regex: /\b(tark1|ark1)[0-9a-z]{20,}/gi,
    replacement: "[ark-address]",
  },
  // Nostr private keys (bech32-encoded): nsec1...
  {
    regex: /\bnsec1[0-9a-z]{20,}/gi,
    replacement: "[nsec]",
  },
  // BIP39-style mnemonics: 12 or 24 short lowercase words.
  {
    regex: /\b(?:[a-z]{3,10}\s+){11,23}[a-z]{3,10}\b/g,
    replacement: "[mnemonic]",
  },
  // 32-byte hex tokens — covers raw private keys, payment hashes, preimages,
  // and txids. They are indistinguishable by shape, so redact them all at
  // word boundaries.
  {
    regex: /\b[0-9a-f]{64}\b/gi,
    replacement: "[hex32]",
  },
];

export function redactString(input: string): string {
  let s = input;
  for (const { regex, replacement } of REDACTORS) {
    s = s.replace(regex, replacement);
  }
  if (s.length > MAX_FIELD_LEN) {
    s = `${s.slice(0, MAX_FIELD_LEN)}…(truncated)`;
  }
  return s;
}

function redactDetails(
  details: Record<string, string | number | boolean | null | undefined>,
): Record<string, ErrorDetailValue> {
  const out: Record<string, ErrorDetailValue> = {};
  for (const [k, v] of Object.entries(details)) {
    if (v === undefined) continue;
    if (v === null) {
      out[k] = null;
    } else if (typeof v === "string") {
      out[k] = redactString(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

// Exposed for unit-style verification only; not part of the public API.
export const __internal = { MAX_ENTRIES, MAX_FIELD_LEN };
