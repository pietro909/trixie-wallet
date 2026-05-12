import type { ActivityDirection, ActivityStatus } from "../store/types";
import type { AppTheme } from "../theme/theme";

export type StatusVisuals = {
  /** Foreground color — used for pill text and (when meaningful) amount text. */
  fg: string;
  /** Background color — used for pill chip background. */
  bg: string;
  /** Display label for the status. */
  label: string;
};

/**
 * Single source of truth for status → pill/amount color/label. Activity list
 * rows, the wallet recent-activity preview, and the activity-details summary
 * pill all read from here so a future change to the pending palette never
 * drifts across surfaces.
 *
 * @see statusAmountColor for the amount-text variant (success-green vs.
 * pending-orange vs. default text).
 */
export function statusVisuals(
  status: ActivityStatus,
  theme: AppTheme,
): StatusVisuals {
  switch (status) {
    case "pending":
      return {
        fg: theme.colors.pending,
        bg: theme.colors.pendingSoft,
        label: "Pending",
      };
    case "confirmed":
      return {
        fg: theme.colors.success,
        bg: theme.colors.successSoft,
        label: "Confirmed",
      };
    case "failed":
      return {
        fg: theme.colors.danger,
        bg: theme.colors.dangerSoft,
        label: "Failed",
      };
    case "refunded":
      return {
        fg: theme.colors.textMuted,
        bg: theme.colors.surfaceSubtle,
        label: "Refunded",
      };
    default:
      return {
        fg: theme.colors.textMuted,
        bg: theme.colors.surfaceSubtle,
        label: "Info",
      };
  }
}

/**
 * Amount-text color for a row, accounting for direction. Pending inbound
 * rows render in the pending palette; confirmed inbound stays success-green;
 * everything else defaults to plain text. The "loud green even when
 * pending" bug we're fixing in M11 lives in callers that ignored direction
 * here — every consumer must route through this helper.
 */
export function statusAmountColor(
  status: ActivityStatus,
  direction: ActivityDirection | undefined,
  theme: AppTheme,
): string {
  if (direction === "self") return theme.colors.text;
  const isIn = direction === "in";
  if (status === "pending") {
    return isIn ? theme.colors.pending : theme.colors.text;
  }
  if (status === "failed" || status === "refunded") {
    return theme.colors.text;
  }
  if (isIn) return theme.colors.success;
  return theme.colors.text;
}
