import type { ParsedPaymentOption } from "./paymentParser";
import { paymentTypeLabel } from "./paymentParser";
import { useAppStore } from "../store/useAppStore";
import type { Transaction } from "../store/types";

export type SendResult =
  | { ok: true; txId: string; feeSats: number; amountSats: number }
  | { ok: false; error: string };

function randomTxId(): string {
  const chars = "0123456789abcdef";
  let id = "";
  for (let i = 0; i < 64; i++) id += chars[Math.floor(Math.random() * 16)];
  return id;
}

export function estimateFeeSats(option: ParsedPaymentOption, amountSats: number): number {
  switch (option.type) {
    case "arkade":
      return 0;
    case "lightning":
      return Math.max(1, Math.floor(amountSats * 0.0002));
    case "lnurl":
      return Math.max(1, Math.floor(amountSats * 0.0002));
    case "bitcoin":
      return 250;
  }
}

/**
 * Mock send. Simulates 1.5–2s of network work, fails ~10% of the time so the
 * UI can exercise its error path. On success, persists a transaction to the
 * active wallet so the recent-activity list updates.
 *
 * Replace this with the Arkade SDK / Lightning client once available; the
 * shape of `SendResult` should stay stable.
 */
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

  const wallet = useAppStore.getState().walletContainer?.wallets.find(
    (w) => w.id === useAppStore.getState().walletContainer?.activeWalletId,
  );
  const fee = estimateFeeSats(option, amountSats);
  const total = amountSats + fee;
  if (wallet && total > wallet.balanceSats) {
    return { ok: false, error: "Insufficient balance for this amount and fee" };
  }

  await new Promise((r) => setTimeout(r, 1500 + Math.random() * 500));

  if (Math.random() < 0.1) {
    return { ok: false, error: "Network error — please try again" };
  }

  const txId = randomTxId();
  const tx: Transaction = {
    id: txId,
    direction: "out",
    amountSats,
    timestamp: Date.now(),
    counterpartyLabel: option.memo ?? `${paymentTypeLabel(option.type)} payment`,
    status: option.type === "bitcoin" ? "pending" : "confirmed",
  };
  await useAppStore.getState().appendTransaction(tx, -total);

  return { ok: true, txId, feeSats: fee, amountSats };
}
