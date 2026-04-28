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
  | "refresh_failed";

export class ArkadeError extends Error {
  readonly kind: ArkadeErrorKind;
  readonly cause?: unknown;

  constructor(kind: ArkadeErrorKind, message: string, cause?: unknown) {
    super(message);
    this.name = "ArkadeError";
    this.kind = kind;
    this.cause = cause;
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
