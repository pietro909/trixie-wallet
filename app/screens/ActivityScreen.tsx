import {
  ArrowDownLeft,
  ArrowUpRight,
  Inbox,
  Repeat,
} from "lucide-react-native";
import * as React from "react";
import { FlatList, RefreshControl, StyleSheet, Text, View } from "react-native";
import { useFormatSats } from "../hooks/useFormatSats";
import { useResolvedTheme } from "../hooks/useResolvedTheme";
import type { Activity } from "../store/types";
import { useAppStore } from "../store/useAppStore";
import { spacing, typography } from "../theme/theme";

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
  const wallet = useAppStore((s) => s.wallet);
  const refreshWallet = useAppStore((s) => s.refreshWallet);
  const { format: formatSats, label: unitLabel } = useFormatSats();
  const [refreshing, setRefreshing] = React.useState(false);

  const activities = wallet?.activities ?? [];

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
    const sign = isSelf || item.amountSats == null ? "" : isIn ? "+" : "-";
    return (
      <View style={[styles.row, { borderBottomColor: theme.colors.divider }]}>
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
      </View>
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
