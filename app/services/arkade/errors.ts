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
  | "recovery_finalize_failed";

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
};

export class ArkadeError extends Error {
  readonly kind: ArkadeErrorKind;
  readonly cause?: unknown;

  constructor(kind: ArkadeErrorKind, message: string, cause?: unknown) {
    super(message);
    this.name = "ArkadeError";
    this.kind = kind;
    this.cause = cause;
    recordError(CATEGORY_BY_KIND[kind] ?? "unknown", `${kind}: ${message}`, {
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
