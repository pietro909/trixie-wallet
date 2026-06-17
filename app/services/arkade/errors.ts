import { DigestMismatchError, maybeArkError } from "@arkade-os/sdk";
import { type ErrorCategory, recordError } from "../diagnostics/recorder";

export type ArkadeErrorKind =
  | "server_unreachable"
  | "invalid_mnemonic"
  | "invalid_private_key"
  | "wallet_init_failed"
  | "wallet_not_ready"
  | "delegator_unavailable"
  | "secret_storage_failed"
  | "insufficient_balance"
  | "unsupported_payment"
  | "send_failed"
  | "refresh_failed"
  | "lightning_unavailable"
  | "lightning_init_failed"
  | "invoice_invalid"
  | "invoice_expired"
  | "invoice_amountless"
  | "amount_below_limit"
  | "amount_above_limit"
  | "swap_create_failed"
  | "swap_settle_failed"
  | "swap_claim_failed"
  | "swap_refund_failed"
  | "swap_restore_failed"
  | "recovery_scan_failed"
  | "recovery_action_failed"
  | "recovery_item_missing"
  | "recovery_pending_tx_not_found"
  | "recovery_finalize_failed"
  | "vtxos_fetch_failed"
  | "addresses_fetch_failed"
  | "contracts_fetch_failed"
  | "contracts_params_not_found"
  | "contracts_update_failed"
  | "signer_migration_failed"
  | "update_required";

const CATEGORY_BY_KIND: Record<ArkadeErrorKind, ErrorCategory> = {
  server_unreachable: "server",
  invalid_mnemonic: "wallet",
  invalid_private_key: "wallet",
  wallet_init_failed: "wallet",
  wallet_not_ready: "wallet",
  delegator_unavailable: "wallet",
  secret_storage_failed: "wallet",
  insufficient_balance: "send",
  unsupported_payment: "send",
  send_failed: "send",
  refresh_failed: "wallet",
  lightning_unavailable: "lightning",
  lightning_init_failed: "lightning",
  invoice_invalid: "lightning",
  invoice_expired: "lightning",
  invoice_amountless: "lightning",
  amount_below_limit: "send",
  amount_above_limit: "send",
  swap_create_failed: "swap",
  swap_settle_failed: "swap",
  swap_claim_failed: "swap",
  swap_refund_failed: "swap",
  swap_restore_failed: "swap",
  recovery_scan_failed: "swap",
  recovery_action_failed: "swap",
  recovery_item_missing: "swap",
  recovery_pending_tx_not_found: "swap",
  recovery_finalize_failed: "swap",
  vtxos_fetch_failed: "wallet",
  addresses_fetch_failed: "wallet",
  contracts_fetch_failed: "wallet",
  contracts_params_not_found: "wallet",
  contracts_update_failed: "wallet",
  signer_migration_failed: "wallet",
  update_required: "server",
};

export class ArkadeError extends Error {
  readonly kind: ArkadeErrorKind;
  readonly cause?: unknown;

  constructor(kind: ArkadeErrorKind, message: string, cause?: unknown) {
    super(message);
    this.name = "ArkadeError";
    this.kind = kind;
    this.cause = cause;
    recordError(CATEGORY_BY_KIND[kind], `${kind}: ${message}`, {
      cause: causeMessage(cause),
    });
  }
}

export function toArkadeError(
  kind: ArkadeErrorKind,
  fallback: string,
  e: unknown,
): ArkadeError {
  if (e instanceof ArkadeError) return e;
  const msg = e instanceof Error ? e.message : fallback;
  return new ArkadeError(kind, msg, e);
}

function causeMessage(cause: unknown): string | null {
  if (cause == null) return null;
  if (cause instanceof Error) return cause.message;
  return null;
}

/**
 * Stable rejection message used by store actions when a server-required app
 * update is detected. The global {@link UpdateRequiredModal} is what the user
 * acts on; this message merely tells the originating screen not to render a
 * second, generic error on top of the modal.
 */
export const UPDATE_REQUIRED_ERROR_MESSAGE =
  "A server update requires a newer version of Trixie Wallet.";

/**
 * Walk an error's `cause` chain (including {@link ArkadeError.cause} and the
 * native `Error.cause`) looking for one that satisfies `predicate`. A `Set`
 * guards against self-referential causes. `toArkadeError` preserves the SDK
 * error both as the wrapper's message and as `.cause`, so guards built on this
 * detect SDK errors whether they arrive raw or wrapped.
 */
function someInCauseChain(
  e: unknown,
  predicate: (err: unknown) => boolean,
): boolean {
  let current: unknown = e;
  const seen = new Set<unknown>();
  while (current != null && !seen.has(current)) {
    if (predicate(current)) return true;
    seen.add(current);
    if (current instanceof ArkadeError) {
      current = current.cause;
    } else if (current instanceof Error) {
      current = (current as { cause?: unknown }).cause;
    } else {
      break;
    }
  }
  return false;
}

/**
 * True when the error (or any wrapped cause) is the SDK's
 * {@link DigestMismatchError}. `DigestMismatchError` is a plain `Error` with no
 * `code`/`name` beyond its class, so detection is by `instanceof` along the
 * cause chain.
 */
export function isDigestMismatchError(e: unknown): boolean {
  return someInCauseChain(e, (err) => err instanceof DigestMismatchError);
}

/**
 * True when the error (or any wrapped cause) is arkd's
 * `BUILD_VERSION_TOO_OLD` guard rejection. arkd carries the name/code in the
 * message prefix with an empty `details[]`; `maybeArkError` parses both forms,
 * so branch on `name`/`code`, never on raw message matching.
 */
export function isBuildVersionTooOldError(e: unknown): boolean {
  return someInCauseChain(e, (err) => {
    const ark = maybeArkError(err);
    return ark?.name === "BUILD_VERSION_TOO_OLD" || ark?.code === 48;
  });
}

/**
 * Compatibility outcome of an SDK error, computed by store actions *before*
 * they wrap the error into a generic {@link ArkadeError}. Update-required
 * outranks digest-mismatch: a stale client build cannot be fixed by refreshing
 * server info and retrying.
 */
export type CompatibilityAction =
  | { kind: "update_required" }
  | { kind: "digest_mismatch" }
  | null;

export function classifyCompatibilityError(e: unknown): CompatibilityAction {
  if (isBuildVersionTooOldError(e)) return { kind: "update_required" };
  if (isDigestMismatchError(e)) return { kind: "digest_mismatch" };
  return null;
}
