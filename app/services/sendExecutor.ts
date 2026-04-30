import { useAppStore } from "../store/useAppStore";
import { ArkadeError } from "./arkade/errors";
import { isLightningSupportedForNetwork } from "./arkade/lightning";
import type { ParsedPaymentOption } from "./paymentParser";

export type SendResult =
  | {
      ok: true;
      txId: string;
      feeSats: number;
      amountSats: number;
      swapId?: string;
    }
  | { ok: false; error: string };

export type BitcoinRail = "collab" | "chainswap";

export type ExecuteSendOptions = {
  /** Selected on-chain rail when `option.type === "bitcoin"`. Default `"collab"`. */
  bitcoinRail?: BitcoinRail;
};

export function isPayableInThisMilestone(option: ParsedPaymentOption): boolean {
  if (!option.isPayable) return false;
  if (option.type === "arkade") return true;
  if (option.type === "bitcoin") return true;
  if (option.type === "lightning") {
    const network = useAppStore.getState().wallet?.network;
    return isLightningSupportedForNetwork(network);
  }
  return false;
}

export function unsupportedReasonFor(
  option: ParsedPaymentOption,
): string | null {
  if (option.type === "arkade") return null;
  if (option.type === "bitcoin") return null;
  if (option.type === "lightning") {
    const network = useAppStore.getState().wallet?.network;
    if (!isLightningSupportedForNetwork(network)) {
      return `Lightning is not configured for ${network ?? "this network"}.`;
    }
    return null;
  }
  switch (option.type) {
    case "lnurl":
      return "LNURL pay is not available yet.";
  }
}

export async function executeSend(
  option: ParsedPaymentOption,
  amountSats: number,
  opts: ExecuteSendOptions = {},
): Promise<SendResult> {
  if (amountSats <= 0) {
    return { ok: false, error: "Amount must be greater than zero" };
  }
  if (!option.isPayable) {
    return {
      ok: false,
      error: option.warning ?? "Payment option is not payable",
    };
  }
  const unsupported = unsupportedReasonFor(option);
  if (unsupported) {
    return { ok: false, error: unsupported };
  }

  if (option.type === "lightning") {
    if (option.expiresAt != null && option.expiresAt <= Date.now()) {
      return { ok: false, error: "Invoice expired" };
    }
    try {
      const result = await useAppStore
        .getState()
        .sendLightning(option.raw, amountSats);
      return {
        ok: true,
        txId: result.txId,
        feeSats: result.feeSats,
        amountSats: result.amountSats,
      };
    } catch (e) {
      if (e instanceof ArkadeError) return { ok: false, error: e.message };
      const msg = e instanceof Error ? e.message : "Lightning send failed";
      return { ok: false, error: msg };
    }
  }

  if (option.type === "bitcoin") {
    const bitcoinAddress = extractBitcoinAddress(option);
    if (!bitcoinAddress) {
      return { ok: false, error: "No Bitcoin address found in payment input" };
    }
    const rail: BitcoinRail = opts.bitcoinRail ?? "collab";
    try {
      if (rail === "chainswap") {
        const result = await useAppStore
          .getState()
          .sendChainSwap(bitcoinAddress, amountSats);
        return {
          ok: true,
          txId: result.txId,
          feeSats: result.feeSats,
          amountSats: result.amountSats,
          swapId: result.swapId,
        };
      }
      const result = await useAppStore
        .getState()
        .sendOnchain(bitcoinAddress, amountSats);
      return {
        ok: true,
        txId: result.txId,
        feeSats: result.feeSats,
        amountSats: result.amountSats,
      };
    } catch (e) {
      if (e instanceof ArkadeError) return { ok: false, error: e.message };
      const msg = e instanceof Error ? e.message : "On-chain send failed";
      return { ok: false, error: msg };
    }
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
  const noScheme = raw
    .replace(/^(arkade|ark):\/\//i, "")
    .replace(/^(arkade|ark):/i, "");
  const qIndex = noScheme.indexOf("?");
  const address = qIndex === -1 ? noScheme : noScheme.slice(0, qIndex);
  return address || null;
}

function extractBitcoinAddress(option: ParsedPaymentOption): string | null {
  if (option.type !== "bitcoin") return null;
  const raw = option.raw.trim();
  const noScheme = raw.replace(/^bitcoin:/i, "");
  const qIndex = noScheme.indexOf("?");
  const address = qIndex === -1 ? noScheme : noScheme.slice(0, qIndex);
  return address || null;
}
