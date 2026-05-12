import { ArrowDownLeft, ArrowUpRight, Repeat } from "lucide-react-native";
import type * as React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useFormatSats } from "../hooks/useFormatSats";
import { statusAmountColor, statusVisuals } from "../services/activity-status";
import {
  prettyAssetAmount,
  truncatedAssetId,
} from "../services/arkade/asset-format";
import type { CachedAssetDetails } from "../services/arkade/asset-metadata";
import type { Activity } from "../store/types";
import { type AppTheme, radius, spacing, typography } from "../theme/theme";
import AssetAvatar from "./AssetAvatar";

export type ActivityRowProps = {
  activity: Activity;
  theme: AppTheme;
  onPress: () => void;
  formatTimestamp: (ts: number) => string;
  /** Optional asset metadata map for asset-bearing rows. */
  assetMetadata?: Map<string, CachedAssetDetails>;
  /** Optional icon approvals for asset-bearing rows. */
  iconApprovals?: Record<string, boolean>;
};

/**
 * Single activity row used by ActivityScreen and the WalletScreen recent
 * preview. Handles both BTC and asset variants and routes amount/pill colors
 * through {@link statusVisuals}, so a pending swap row never paints green.
 */
export default function ActivityRow(
  props: ActivityRowProps,
): React.ReactElement {
  const {
    activity,
    theme,
    onPress,
    formatTimestamp,
    assetMetadata,
    iconApprovals,
  } = props;
  const { format: formatSats, label: unitLabel } = useFormatSats();

  const isIn = activity.direction === "in";
  const isSelf = activity.direction === "self";
  const visuals = statusVisuals(activity.status, theme);
  const amountColor = statusAmountColor(
    activity.status,
    activity.direction,
    theme,
  );

  const hasAssets = activity.assets && activity.assets.length > 0;
  const primaryAsset = hasAssets
    ? activity.assets?.[0]
    : typeof activity.metadata?.assetId === "string"
      ? {
          assetId: activity.metadata.assetId,
          amount:
            typeof activity.metadata.assetAmount === "number"
              ? String(activity.metadata.assetAmount)
              : "0",
        }
      : null;

  if (primaryAsset && assetMetadata) {
    const details = assetMetadata.get(primaryAsset.assetId);
    const decimals =
      typeof details?.metadata?.decimals === "number"
        ? details.metadata.decimals
        : 0;
    let parsedAmount = 0n;
    try {
      parsedAmount = BigInt(primaryAsset.amount);
    } catch {
      parsedAmount = 0n;
    }
    const absAmount = parsedAmount < 0n ? -parsedAmount : parsedAmount;
    const formatted = prettyAssetAmount(absAmount, decimals);
    const ticker =
      details?.metadata?.ticker ?? truncatedAssetId(primaryAsset.assetId);
    const assetSign = isSelf
      ? ""
      : parsedAmount < 0n
        ? "-"
        : parsedAmount > 0n
          ? "+"
          : "";
    const totalAssets = activity.assets?.length ?? 1;
    const extraCopy = totalAssets > 1 ? ` · +${totalAssets - 1} more` : "";
    return (
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [
          styles.row,
          {
            borderBottomColor: theme.colors.divider,
            opacity: pressed ? 0.6 : 1,
          },
        ]}
      >
        <AssetAvatar
          size={36}
          icon={details?.metadata?.icon ?? null}
          approved={iconApprovals?.[primaryAsset.assetId] === true}
          ticker={details?.metadata?.ticker ?? null}
          name={details?.metadata?.name ?? null}
        />
        <View style={styles.info}>
          <Text style={[styles.label, { color: theme.colors.text }]}>
            {activity.title}
          </Text>
          <View style={styles.metaRow}>
            <Text style={[styles.date, { color: theme.colors.textSubtle }]}>
              {formatTimestamp(activity.timestamp)}
              {extraCopy}
            </Text>
            {activity.status !== "confirmed" ? (
              <View
                style={[styles.statusPill, { backgroundColor: visuals.bg }]}
              >
                <Text style={[styles.statusPillText, { color: visuals.fg }]}>
                  {visuals.label}
                </Text>
              </View>
            ) : null}
          </View>
        </View>
        <Text style={[styles.amount, { color: amountColor }]}>
          {assetSign}
          {formatted} {ticker}
        </Text>
      </Pressable>
    );
  }

  const iconBg = isSelf
    ? `${theme.colors.textSubtle}20`
    : isIn
      ? `${theme.colors.success}20`
      : `${theme.colors.danger}20`;
  const Icon = isSelf ? Repeat : isIn ? ArrowDownLeft : ArrowUpRight;
  const iconColor = isSelf
    ? theme.colors.textSubtle
    : isIn
      ? theme.colors.success
      : theme.colors.danger;

  const sign = isSelf || activity.amountSats == null ? "" : isIn ? "+" : "-";
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        {
          borderBottomColor: theme.colors.divider,
          opacity: pressed ? 0.6 : 1,
        },
      ]}
    >
      <View style={[styles.icon, { backgroundColor: iconBg }]}>
        <Icon color={iconColor} size={18} />
      </View>
      <View style={styles.info}>
        <Text style={[styles.label, { color: theme.colors.text }]}>
          {activity.title}
        </Text>
        <View style={styles.metaRow}>
          <Text style={[styles.date, { color: theme.colors.textSubtle }]}>
            {formatTimestamp(activity.timestamp)}
          </Text>
          {activity.status !== "confirmed" ? (
            <View style={[styles.statusPill, { backgroundColor: visuals.bg }]}>
              <Text style={[styles.statusPillText, { color: visuals.fg }]}>
                {visuals.label}
              </Text>
            </View>
          ) : null}
        </View>
      </View>
      {activity.amountSats != null ? (
        <Text style={[styles.amount, { color: amountColor }]}>
          {sign}
          {formatSats(activity.amountSats)} {unitLabel}
        </Text>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing[3],
    borderBottomWidth: 1,
  },
  icon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  info: {
    flex: 1,
    marginLeft: spacing[3],
  },
  label: {
    fontSize: typography.size.md,
    fontWeight: typography.weight.medium,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    marginTop: 2,
  },
  date: {
    fontSize: typography.size.xs,
  },
  statusPill: {
    paddingHorizontal: spacing[2],
    paddingVertical: 1,
    borderRadius: radius.pill,
  },
  statusPillText: {
    fontSize: typography.size.xs,
    fontWeight: typography.weight.medium,
  },
  amount: {
    fontSize: typography.size.sm,
    fontWeight: typography.weight.semibold,
    fontVariant: ["tabular-nums"],
  },
});
