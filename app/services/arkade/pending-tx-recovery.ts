import type { ExtendedVirtualCoin } from "@arkade-os/sdk";
import { base64 } from "@scure/base";
import { Transaction } from "@scure/btc-signer";
import { ArkadeError, toArkadeError } from "./errors";
import { getWallet } from "./runtime";

/**
 * `PendingTx` is exposed via `arkProvider.getPendingTxs(...)` but the SDK does
 * not re-export the interface from its public entry point. We model it
 * locally to avoid deep imports into `dist/types/...`.
 */
export type PendingTx = {
  arkTxid: string;
  finalArkTx: string;
  signedCheckpointTxs: string[];
};

/**
 * Reproduce the body of `Wallet.finalizePendingTxs` using the public
 * provider/intent surface, so the recovery flow does not depend on the
 * `state.settings.hasPendingTx` short-circuit. That flag is a local
 * optimization, not a correctness gate — it can be missed if the previous
 * session crashed before setting it, or be inconsistent after a backup
 * restore. See MILESTONE_9.agents.md "Footguns".
 *
 * If the SDK ever exposes public `inspectPendingTxs()` /
 * `finalizePendingTx(arkTxid)`, delete this file and call those.
 */

const MAX_INPUTS_PER_INTENT = 20;

async function loadActiveVtxos(): Promise<ExtendedVirtualCoin[]> {
  const wallet = await getWallet();
  const scriptMap = await wallet.getScriptMap();
  const allScripts = [...scriptMap.keys()];
  if (allScripts.length === 0) return [];
  const { vtxos } = await wallet.indexerProvider.getVtxos({
    scripts: allScripts,
  });
  const out: ExtendedVirtualCoin[] = [];
  for (const vtxo of vtxos) {
    const vtxoScript = scriptMap.get(vtxo.script);
    if (!vtxoScript) continue;
    if (
      vtxo.virtualStatus.state === "swept" ||
      vtxo.virtualStatus.state === "settled"
    ) {
      continue;
    }
    out.push({
      ...vtxo,
      forfeitTapLeafScript: vtxoScript.forfeit(),
      intentTapLeafScript: vtxoScript.forfeit(),
      tapTree: vtxoScript.encode(),
    });
  }
  return out;
}

function batchVtxos(vtxos: ExtendedVirtualCoin[]): ExtendedVirtualCoin[][] {
  const batches: ExtendedVirtualCoin[][] = [];
  for (let i = 0; i < vtxos.length; i += MAX_INPUTS_PER_INTENT) {
    batches.push(vtxos.slice(i, i + MAX_INPUTS_PER_INTENT));
  }
  return batches;
}

/**
 * Scoped pending-tx discovery for the active wallet. Returns the unique
 * `PendingTx` rows the server is still holding. Order is preserved by first
 * occurrence; duplicates across batches are dropped.
 */
export async function discoverPendingTxs(): Promise<PendingTx[]> {
  const wallet = await getWallet();
  const vtxos = await loadActiveVtxos();
  if (vtxos.length === 0) return [];
  const seen = new Set<string>();
  const out: PendingTx[] = [];
  for (const batch of batchVtxos(vtxos)) {
    const intent = await wallet.makeGetPendingTxIntentSignature(batch);
    const pending = await wallet.arkProvider.getPendingTxs(intent);
    for (const tx of pending) {
      if (seen.has(tx.arkTxid)) continue;
      seen.add(tx.arkTxid);
      out.push(tx);
    }
  }
  return out;
}

/**
 * Re-run scoped discovery and finalize the row matching `arkTxid`. Throws
 * `recovery_pending_tx_not_found` when the server no longer reports it
 * (already finalized elsewhere, or the row aged out).
 */
export async function finalizePendingTx(arkTxid: string): Promise<void> {
  const wallet = await getWallet();
  const pending = await discoverPendingTxs();
  const target = pending.find((p) => p.arkTxid === arkTxid);
  if (!target) {
    throw new ArkadeError(
      "recovery_pending_tx_not_found",
      "The pending transaction is no longer reported by the server",
    );
  }
  try {
    const finalCheckpoints = await Promise.all(
      target.signedCheckpointTxs.map(async (c: string) => {
        const tx = Transaction.fromPSBT(base64.decode(c));
        const signed = await wallet.identity.sign(tx);
        return base64.encode(signed.toPSBT());
      }),
    );
    await wallet.arkProvider.finalizeTx(target.arkTxid, finalCheckpoints);
  } catch (e) {
    throw toArkadeError(
      "recovery_finalize_failed",
      "Failed to finalize the pending transaction",
      e,
    );
  }
}
