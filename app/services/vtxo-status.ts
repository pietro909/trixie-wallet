import type { AppTheme } from "../theme/theme";
import type { VtxoStatus } from "./arkade/vtxo-listing";

export type VtxoVisuals = {
  /** Foreground color — pill text and (when relevant) amount text. */
  fg: string;
  /** Background color — pill chip background. */
  bg: string;
  /** Amount-text color — muted for unspendable buckets. */
  amountColor: string;
  /** Display label for the status pill. */
  label: string;
  /** One-sentence description used in the list legend and detail card. */
  description: string;
};

/**
 * Single source of truth for VTXO status → pill/amount color/label.
 * VtxoListScreen and VtxoDetailScreen both consume this so the two surfaces
 * cannot drift. Mirrors the `statusVisuals` helper in `activity-status.ts`.
 */
export function vtxoStatusVisuals(
  status: VtxoStatus,
  theme: AppTheme,
): VtxoVisuals {
  switch (status) {
    case "settled":
      return {
        fg: theme.colors.success,
        bg: theme.colors.successSoft,
        amountColor: theme.colors.text,
        label: "Settled",
        description:
          "Finalized in a batch. Fully spendable through normal Arkade flows.",
      };
    case "preconfirmed":
      return {
        fg: theme.colors.pending,
        bg: theme.colors.pendingSoft,
        amountColor: theme.colors.text,
        label: "Pending",
        description:
          "Received but not yet finalized in a batch. Spendable once it settles.",
      };
    case "swept":
      return {
        fg: theme.colors.warning,
        bg: theme.colors.pendingSoft,
        amountColor: theme.colors.text,
        label: "Recoverable",
        description:
          "Swept by the server but still claimable. Will be folded into a fresh batch.",
      };
    case "subdust":
      return {
        fg: theme.colors.textMuted,
        bg: theme.colors.surfaceSubtle,
        amountColor: theme.colors.textSubtle,
        label: "Dust",
        description:
          "Below the dust threshold — currently unspendable on its own.",
      };
    case "spent":
      return {
        fg: theme.colors.danger,
        bg: theme.colors.dangerSoft,
        amountColor: theme.colors.textSubtle,
        label: "Spent",
        description: "Already consumed by a later transaction.",
      };
    default:
      return {
        fg: theme.colors.textMuted,
        bg: theme.colors.surfaceSubtle,
        amountColor: theme.colors.text,
        label: "Unknown",
        description: "Unclassified entry. Investigate via the explorer.",
      };
  }
}
