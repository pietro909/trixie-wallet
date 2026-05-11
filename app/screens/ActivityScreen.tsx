import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Inbox,
  Repeat,
} from "lucide-react-native";
import * as React from "react";
import {
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import AssetAvatar from "../components/AssetAvatar";
import { useFormatSats } from "../hooks/useFormatSats";
import { useResolvedTheme } from "../hooks/useResolvedTheme";
import type { RootStackParamList } from "../navigation/RootStack";
import {
  prettyAssetAmount,
  truncatedAssetId,
} from "../services/arkade/asset-format";
import { readIconApprovals } from "../services/arkade/asset-icon-approval";
import {
  type CachedAssetDetails,
  readAssetMetadataMap,
} from "../services/arkade/asset-metadata";
import type { Activity } from "../store/types";
import { useAppStore } from "../store/useAppStore";
import { spacing, typography } from "../theme/theme";

type Nav = NativeStackNavigationProp<RootStackParamList>;

function formatDate(timestamp: number): string {
  const d = new Date(timestamp);
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function statusSuffix(status: Activity["status"]): string {
  switch (status) {
    case "pending":
      return " · Pending";
    case "failed":
      return " · Failed";
    case "refunded":
      return " · Refunded";
    default:
      return "";
  }
}

export default function ActivityScreen() {
  const theme = useResolvedTheme();
  const nav = useNavigation<Nav>();
  const wallet = useAppStore((s) => s.wallet);
  const network = useAppStore(
    (s) => s.network.detectedNetwork ?? s.wallet?.network ?? null,
  );
  const refreshWallet = useAppStore((s) => s.refreshWallet);
  const { format: formatSats, label: unitLabel } = useFormatSats();
  const [refreshing, setRefreshing] = React.useState(false);
  const [assetMetadata, setAssetMetadata] = React.useState<
    Map<string, CachedAssetDetails>
  >(() => new Map());
  const [iconApprovals, setIconApprovals] = React.useState<
    Record<string, boolean>
  >({});

  const activities = wallet?.activities ?? [];

  const assetIdsInActivities = React.useMemo(() => {
    const set = new Set<string>();
    for (const a of activities) {
      if (a.assets) for (const e of a.assets) set.add(e.assetId);
      const legacyId = a.metadata?.assetId;
      if (typeof legacyId === "string") set.add(legacyId);
    }
    return Array.from(set);
  }, [activities]);

  React.useEffect(() => {
    if (!network || assetIdsInActivities.length === 0) return;
    let cancelled = false;
    void (async () => {
      const [map, approvals] = await Promise.all([
        readAssetMetadataMap(network, assetIdsInActivities),
        readIconApprovals(),
      ]);
      if (cancelled) return;
      setAssetMetadata(map);
      setIconApprovals(approvals);
    })();
    return () => {
      cancelled = true;
    };
  }, [network, assetIdsInActivities]);

  async function handleRefresh() {
    setRefreshing(true);
    try {
      await refreshWallet();
    } catch {
      // best-effort
    } finally {
      setRefreshing(false);
    }
  }

  function renderItem({ item }: { item: Activity }) {
    const isIn = item.direction === "in";
    const isSelf = item.direction === "self";
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
    const amountColor = isSelf
      ? theme.colors.text
      : isIn
        ? theme.colors.success
        : theme.colors.text;

    const hasAssets = item.assets && item.assets.length > 0;
    const primaryAsset = hasAssets
      ? item.assets?.[0]
      : typeof item.metadata?.assetId === "string"
        ? {
            assetId: item.metadata.assetId as string,
            amount:
              typeof item.metadata.assetAmount === "number"
                ? String(item.metadata.assetAmount)
                : "0",
          }
        : null;

    if (primaryAsset) {
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
      const totalAssets = item.assets?.length ?? 1;
      const extraCopy = totalAssets > 1 ? ` · +${totalAssets - 1} more` : "";
      return (
        <Pressable
          onPress={() =>
            nav.navigate("ActivityDetails", { activityId: item.id })
          }
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
            approved={iconApprovals[primaryAsset.assetId] === true}
            ticker={details?.metadata?.ticker ?? null}
            name={details?.metadata?.name ?? null}
          />
          <View style={styles.info}>
            <Text style={[styles.label, { color: theme.colors.text }]}>
              {item.title}
            </Text>
            <Text style={[styles.date, { color: theme.colors.textSubtle }]}>
              {formatDate(item.timestamp)}
              {statusSuffix(item.status)}
              {extraCopy}
            </Text>
          </View>
          <Text style={[styles.amount, { color: amountColor }]}>
            {assetSign}
            {formatted} {ticker}
          </Text>
        </Pressable>
      );
    }

    const sign = isSelf || item.amountSats == null ? "" : isIn ? "+" : "-";
    return (
      <Pressable
        onPress={() => nav.navigate("ActivityDetails", { activityId: item.id })}
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
            {item.title}
          </Text>
          <Text style={[styles.date, { color: theme.colors.textSubtle }]}>
            {formatDate(item.timestamp)}
            {statusSuffix(item.status)}
          </Text>
        </View>
        {item.amountSats != null ? (
          <Text style={[styles.amount, { color: amountColor }]}>
            {sign}
            {formatSats(item.amountSats)} {unitLabel}
          </Text>
        ) : null}
      </Pressable>
    );
  }

  return (
    <FlatList
      data={activities}
      keyExtractor={(item) => item.id}
      renderItem={renderItem}
      style={{ backgroundColor: theme.colors.background }}
      contentContainerStyle={
        activities.length === 0 ? styles.emptyContainer : styles.list
      }
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={handleRefresh}
          tintColor={theme.colors.primary}
        />
      }
      ListEmptyComponent={
        <View style={styles.emptyState}>
          <Inbox color={theme.colors.textSubtle} size={56} />
          <Text style={[styles.emptyTitle, { color: theme.colors.text }]}>
            No activity yet
          </Text>
          <Text style={[styles.emptyBody, { color: theme.colors.textMuted }]}>
            Your wallet activity will appear here
          </Text>
        </View>
      }
    />
  );
}

const styles = StyleSheet.create({
  list: {
    paddingHorizontal: spacing[5],
  },
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
  date: {
    fontSize: typography.size.xs,
    marginTop: 2,
  },
  amount: {
    fontSize: typography.size.sm,
    fontWeight: typography.weight.semibold,
    fontVariant: ["tabular-nums"],
  },
  emptyContainer: {
    flex: 1,
  },
  emptyState: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingTop: 120,
  },
  emptyTitle: {
    fontSize: typography.size.lg,
    fontWeight: typography.weight.semibold,
    marginTop: spacing[4],
  },
  emptyBody: {
    fontSize: typography.size.sm,
    marginTop: spacing[2],
  },
});
