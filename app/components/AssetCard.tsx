import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type ViewStyle,
} from "react-native";
import { useResolvedTheme } from "../hooks/useResolvedTheme";
import {
  prettyAssetAmount,
  truncatedAssetId,
} from "../services/arkade/asset-format";
import type { CachedAssetDetails } from "../services/arkade/asset-metadata";
import { radius, spacing, typography } from "../theme/theme";
import AssetAvatar from "./AssetAvatar";

type Props = {
  assetId: string;
  amount: bigint;
  details?: CachedAssetDetails;
  approvedIcon?: boolean;
  onPress?: () => void;
  style?: ViewStyle;
  /** Show truncated id as a sub-line under the name (useful for cards on Wallet). */
  showIdSubtitle?: boolean;
};

export default function AssetCard({
  assetId,
  amount,
  details,
  approvedIcon,
  onPress,
  style,
  showIdSubtitle = true,
}: Props) {
  const theme = useResolvedTheme();
  const decimals =
    typeof details?.metadata?.decimals === "number"
      ? details.metadata.decimals
      : 0;
  const ticker = details?.metadata?.ticker;
  const name = details?.metadata?.name;
  const icon = details?.metadata?.icon;
  const displayName = name ?? ticker ?? truncatedAssetId(assetId);
  const subtitle = showIdSubtitle ? truncatedAssetId(assetId) : null;
  const formatted = prettyAssetAmount(amount, decimals);

  const Inner = (
    <View
      style={[
        styles.row,
        {
          backgroundColor: theme.colors.card,
          borderColor: theme.colors.border,
        },
        style,
      ]}
    >
      <AssetAvatar
        size={36}
        icon={icon ?? null}
        approved={approvedIcon === true}
        ticker={ticker ?? null}
        name={name ?? null}
      />
      <View style={styles.info}>
        <Text
          style={[styles.name, { color: theme.colors.text }]}
          numberOfLines={1}
        >
          {displayName}
        </Text>
        {subtitle ? (
          <Text
            style={[styles.subtitle, { color: theme.colors.textSubtle }]}
            numberOfLines={1}
          >
            {subtitle}
          </Text>
        ) : null}
      </View>
      <View style={styles.amountWrap}>
        <Text style={[styles.amount, { color: theme.colors.text }]}>
          {formatted}
        </Text>
        {ticker ? (
          <Text style={[styles.ticker, { color: theme.colors.textSubtle }]}>
            {ticker}
          </Text>
        ) : null}
      </View>
    </View>
  );

  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
      >
        {Inner}
      </Pressable>
    );
  }
  return Inner;
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing[3],
    paddingHorizontal: spacing[4],
    borderRadius: radius.md,
    borderWidth: 1,
    gap: spacing[3],
  },
  info: {
    flex: 1,
    gap: 2,
  },
  name: {
    fontSize: typography.size.md,
    fontWeight: typography.weight.semibold,
  },
  subtitle: {
    fontSize: typography.size.xs,
  },
  amountWrap: {
    alignItems: "flex-end",
    gap: 2,
  },
  amount: {
    fontSize: typography.size.md,
    fontWeight: typography.weight.semibold,
    fontVariant: ["tabular-nums"],
  },
  ticker: {
    fontSize: typography.size.xs,
  },
});
