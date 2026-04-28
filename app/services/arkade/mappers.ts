import { TxType, type ArkTransaction } from "@arkade-os/sdk";
import type { Transaction } from "../../store/types";

export function mapArkTxToTransaction(tx: ArkTransaction): Transaction {
  const id =
    tx.key.arkTxid ||
    tx.key.commitmentTxid ||
    tx.key.boardingTxid ||
    `${tx.type}:${tx.createdAt}:${tx.amount}`;
  const direction: "in" | "out" =
    tx.type === TxType.TxSent ? "out" : "in";
  return {
    id,
    direction,
    amountSats: Math.abs(tx.amount),
    timestamp: tx.createdAt,
    counterpartyLabel: direction === "in" ? "Received" : "Sent",
    status: tx.settled ? "confirmed" : "pending",
  };
}

export function mapArkTxs(txs: ArkTransaction[]): Transaction[] {
  return [...txs]
    .map(mapArkTxToTransaction)
    .sort((a, b) => b.timestamp - a.timestamp);
}
