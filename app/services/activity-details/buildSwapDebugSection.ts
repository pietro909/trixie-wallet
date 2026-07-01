import {
  type BoltzChainSwap,
  type BoltzReverseSwap,
  type BoltzSubmarineSwap,
  type BoltzSwap,
  isChainSwapClaimable,
  isChainSwapRefundable,
  isReverseSwapClaimable,
  isSubmarineSwapRefundable,
} from "@arkade-os/boltz-swap";
import type { Activity } from "../../store/types";
import type { Section, SectionRow } from "./buildSections";

type TimeoutBlockHeights = {
  refund: number;
  unilateralClaim: number;
  unilateralRefund: number;
  unilateralRefundWithoutReceiver: number;
};

function yesNo(value: boolean): string {
  return value ? "Yes" : "No";
}

function timeoutRows(
  legLabel: string,
  timeoutBlockHeight: number | undefined,
  breakdown: TimeoutBlockHeights | undefined,
): SectionRow[] {
  const rows: SectionRow[] = [];
  if (timeoutBlockHeight != null) {
    rows.push({
      kind: "text",
      label: `${legLabel} timeout height`,
      value: String(timeoutBlockHeight),
    });
  }
  if (breakdown) {
    rows.push({
      kind: "text",
      label: `${legLabel} refund height`,
      value: String(breakdown.refund),
    });
    rows.push({
      kind: "text",
      label: `${legLabel} unilateral claim height`,
      value: String(breakdown.unilateralClaim),
    });
    rows.push({
      kind: "text",
      label: `${legLabel} unilateral refund height`,
      value: String(breakdown.unilateralRefund),
    });
    rows.push({
      kind: "text",
      label: `${legLabel} unilateral refund (no receiver) height`,
      value: String(breakdown.unilateralRefundWithoutReceiver),
    });
  }
  return rows;
}

function reverseDebugRows(swap: BoltzReverseSwap): SectionRow[] {
  const rows: SectionRow[] = [];
  if (swap.response.lockupAddress) {
    rows.push({
      kind: "copy",
      label: "Lockup address (Arkade)",
      value: swap.response.lockupAddress,
      mono: true,
      explorerKind: "arkade_address",
    });
  }
  if (swap.response.refundPublicKey) {
    rows.push({
      kind: "copy",
      label: "Boltz refund public key",
      value: swap.response.refundPublicKey,
      mono: true,
    });
  }
  if (swap.request.claimPublicKey) {
    rows.push({
      kind: "copy",
      label: "Our claim public key",
      value: swap.request.claimPublicKey,
      mono: true,
    });
  }
  rows.push(
    ...timeoutRows(
      "Lockup",
      swap.response.timeoutBlockHeight,
      swap.response.timeoutBlockHeights,
    ),
  );
  rows.push({
    kind: "text",
    label: "Claimable",
    value: yesNo(isReverseSwapClaimable(swap)),
  });
  if (swap.preimage) {
    rows.push({
      kind: "secret",
      label: "Preimage",
      value: swap.preimage,
      warning: "Proof of payment — do not share",
    });
  }
  return rows;
}

function submarineDebugRows(swap: BoltzSubmarineSwap): SectionRow[] {
  const rows: SectionRow[] = [];
  if (swap.response.address) {
    rows.push({
      kind: "copy",
      label: "Lockup address (Arkade)",
      value: swap.response.address,
      mono: true,
      explorerKind: "arkade_address",
    });
  }
  if (swap.response.claimPublicKey) {
    rows.push({
      kind: "copy",
      label: "Boltz claim public key",
      value: swap.response.claimPublicKey,
      mono: true,
    });
  }
  if (swap.request.refundPublicKey) {
    rows.push({
      kind: "copy",
      label: "Our refund public key",
      value: swap.request.refundPublicKey,
      mono: true,
    });
  }
  rows.push(
    ...timeoutRows(
      "Lockup",
      swap.response.timeoutBlockHeight,
      swap.response.timeoutBlockHeights,
    ),
  );
  rows.push({
    kind: "text",
    label: "Refundable",
    value: yesNo(swap.refundable ?? isSubmarineSwapRefundable(swap)),
  });
  rows.push({
    kind: "text",
    label: "Refunded",
    value: yesNo(swap.refunded === true),
  });
  if (swap.preimage) {
    rows.push({
      kind: "secret",
      label: "Preimage",
      value: swap.preimage,
      warning: "Proof of payment — do not share",
    });
  }
  return rows;
}

function chainDebugRows(swap: BoltzChainSwap): SectionRow[] {
  const rows: SectionRow[] = [];
  const lockup = swap.response.lockupDetails;
  const claim = swap.response.claimDetails;
  if (lockup?.lockupAddress) {
    rows.push({
      kind: "copy",
      label: "Lockup address (Arkade)",
      value: lockup.lockupAddress,
      mono: true,
      explorerKind: "arkade_address",
    });
  }
  if (lockup?.serverPublicKey) {
    rows.push({
      kind: "copy",
      label: "Lockup server public key",
      value: lockup.serverPublicKey,
      mono: true,
    });
  }
  rows.push(
    ...timeoutRows("Lockup", lockup?.timeoutBlockHeight, lockup?.timeouts),
  );
  if (claim?.lockupAddress) {
    rows.push({
      kind: "copy",
      label: "Claim address (Bitcoin)",
      value: claim.lockupAddress,
      mono: true,
      explorerKind: "bitcoin_address",
    });
  }
  if (claim?.serverPublicKey) {
    rows.push({
      kind: "copy",
      label: "Claim server public key",
      value: claim.serverPublicKey,
      mono: true,
    });
  }
  rows.push(
    ...timeoutRows("Claim", claim?.timeoutBlockHeight, claim?.timeouts),
  );
  if (swap.toAddress) {
    rows.push({
      kind: "copy",
      label: "Destination address",
      value: swap.toAddress,
      mono: true,
      explorerKind: "bitcoin_address",
    });
  }
  if (swap.feeSatsPerByte != null) {
    rows.push({
      kind: "text",
      label: "Fee rate",
      value: `${swap.feeSatsPerByte} sat/vB`,
    });
  }
  rows.push({
    kind: "text",
    label: "Refundable",
    value: yesNo(isChainSwapRefundable(swap)),
  });
  rows.push({
    kind: "text",
    label: "Claimable",
    value: yesNo(isChainSwapClaimable(swap)),
  });
  if (swap.preimage) {
    rows.push({
      kind: "secret",
      label: "Preimage",
      value: swap.preimage,
      warning: "Proof of payment — do not share",
    });
  }
  if (swap.ephemeralKey) {
    rows.push({
      kind: "secret",
      label: "Ephemeral signing key",
      value: swap.ephemeralKey,
      warning: "Private key for this swap's claim/refund — never share",
    });
  }
  return rows;
}

/**
 * Builds the "Swap debug" section from a live Boltz swap object (fetched via
 * `getBoltzSwapById`, the same source the "Copy metadata" export uses). Pure
 * — no I/O — so the screen owns fetching/caching the swap.
 *
 * Returns null for non-Boltz activities, or while the swap hasn't loaded yet
 * (`swap` is null) — the screen renders the rest of the sections regardless.
 */
export function buildSwapDebugSection(
  activity: Activity,
  swap: BoltzSwap | null,
): Section | null {
  if (activity.source.type !== "boltz_swap" || !swap) return null;

  const rows =
    swap.type === "reverse"
      ? reverseDebugRows(swap)
      : swap.type === "submarine"
        ? submarineDebugRows(swap)
        : chainDebugRows(swap);

  if (rows.length === 0) return null;

  return { id: "swap-debug", title: "Swap debug", rows, tone: "warning" };
}
