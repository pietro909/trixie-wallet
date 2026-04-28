import * as React from "react";
import {
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { ArrowDownLeft, ArrowUpRight, Inbox } from "lucide-react-native";
import { useResolvedTheme } from "../hooks/useResolvedTheme";
import { useAppStore } from "../store/useAppStore";
import { formatSats } from "../store/mock";
import type { Transaction } from "../store/types";
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

export default function TransactionsScreen() {
  const theme = useResolvedTheme();
  const wallet = useAppStore((s) => s.wallet);
  const refreshWallet = useAppStore((s) => s.refreshWallet);
  const [refreshing, setRefreshing] = React.useState(false);

  const transactions = wallet?.transactions ?? [];

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

  function renderItem({ item: tx }: { item: Transaction }) {
    return (
      <View
        style={[styles.row, { borderBottomColor: theme.colors.divider }]}
      >
        <View
          style={[
            styles.icon,
            {
              backgroundColor:
                tx.direction === "in"
                  ? `${theme.colors.success}20`
                  : `${theme.colors.danger}20`,
            },
          ]}
        >
          {tx.direction === "in" ? (
            <ArrowDownLeft color={theme.colors.success} size={18} />
          ) : (
            <ArrowUpRight color={theme.colors.danger} size={18} />
          )}
        </View>
        <View style={styles.info}>
          <Text style={[styles.label, { color: theme.colors.text }]}>
            {tx.counterpartyLabel}
          </Text>
          <Text style={[styles.date, { color: theme.colors.textSubtle }]}>
            {formatDate(tx.timestamp)}
            {tx.status === "pending" ? " · Pending" : ""}
          </Text>
        </View>
        <Text
          style={[
            styles.amount,
            {
              color:
                tx.direction === "in"
                  ? theme.colors.success
                  : theme.colors.text,
            },
          ]}
        >
          {tx.direction === "in" ? "+" : "-"}
          {formatSats(tx.amountSats)} sats
        </Text>
      </View>
    );
  }

  return (
    <FlatList
      data={transactions}
      keyExtractor={(tx) => tx.id}
      renderItem={renderItem}
      style={{ backgroundColor: theme.colors.background }}
      contentContainerStyle={
        transactions.length === 0 ? styles.emptyContainer : styles.list
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
            No transactions yet
          </Text>
          <Text style={[styles.emptyBody, { color: theme.colors.textMuted }]}>
            Your transaction history will appear here
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
