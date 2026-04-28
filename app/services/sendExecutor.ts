import type { ParsedPaymentOption } from "./paymentParser";
import { useAppStore } from "../store/useAppStore";
import { ArkadeError } from "./arkade/errors";

export type SendResult =
  | { ok: true; txId: string; feeSats: number; amountSats: number }
  | { ok: false; error: string };

export function isPayableInThisMilestone(option: ParsedPaymentOption): boolean {
  return option.type === "arkade" && option.isPayable;
}

export function unsupportedReasonFor(
  option: ParsedPaymentOption,
): string | null {
  if (option.type === "arkade") return null;
  switch (option.type) {
    case "bitcoin":
      return "Bitcoin on-chain sends are not available yet.";
    case "lightning":
      return "Lightning sends are not available yet.";
    case "lnurl":
      return "LNURL pay is not available yet.";
  }
}

export async function executeSend(
  option: ParsedPaymentOption,
  amountSats: number,
): Promise<SendResult> {
  if (amountSats <= 0) {
    return { ok: false, error: "Amount must be greater than zero" };
  }
  if (!option.isPayable) {
    return { ok: false, error: option.warning ?? "Payment option is not payable" };
  }
  const unsupported = unsupportedReasonFor(option);
  if (unsupported) {
    return { ok: false, error: unsupported };
  }

  const address = extractArkadeAddress(option);
  if (!address) {
    return { ok: false, error: "No Arkade address found in payment input" };
  }

  try {
    const txId = await useAppStore.getState().sendArkade(address, amountSats);
    return { ok: true, txId, feeSats: 0, amountSats };
  } catch (e) {
    if (e instanceof ArkadeError) {
      return { ok: false, error: e.message };
    }
    const msg = e instanceof Error ? e.message : "Send failed";
    return { ok: false, error: msg };
  }
}

function extractArkadeAddress(option: ParsedPaymentOption): string | null {
  if (option.type !== "arkade") return null;
  // raw can be a bare ark1... address or an arkade:/ark: URI; strip scheme/query if present.
  const raw = option.raw.trim();
  const noScheme = raw.replace(/^(arkade|ark):\/\//i, "").replace(/^(arkade|ark):/i, "");
  const qIndex = noScheme.indexOf("?");
  const address = qIndex === -1 ? noScheme : noScheme.slice(0, qIndex);
  return address || null;
}
