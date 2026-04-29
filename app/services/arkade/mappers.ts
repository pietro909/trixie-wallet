import { type ArkTransaction, TxType } from "@arkade-os/sdk";
import type { Activity } from "../../store/types";

export function mapArkTxToActivity(tx: ArkTransaction): Activity {
  const id =
    tx.key.arkTxid ||
    tx.key.commitmentTxid ||
    tx.key.boardingTxid ||
    `${tx.type}:${tx.createdAt}:${tx.amount}`;
  const direction: "in" | "out" = tx.type === TxType.TxSent ? "out" : "in";
  return {
    id,
    kind: "payment",
    direction,
    amountSats: Math.abs(tx.amount),
    timestamp: tx.createdAt,
    title: direction === "in" ? "Arkade received" : "Arkade sent",
    status: tx.settled ? "confirmed" : "pending",
    rail: "arkade",
    source: { type: "arkade_tx", walletTxId: id },
  };
}

export function mapArkTxs(txs: ArkTransaction[]): Activity[] {
  return [...txs]
    .map(mapArkTxToActivity)
    .sort((a, b) => b.timestamp - a.timestamp);
}
