import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import {
  ArrowDownLeft,
  ArrowUpRight,
  ChevronRight,
  Clock,
  Inbox,
  Repeat,
} from "lucide-react-native";
import * as React from "react";
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Button from "../components/Button";
import { useFormatSats } from "../hooks/useFormatSats";
import { useResolvedTheme } from "../hooks/useResolvedTheme";
import type { RootStackParamList } from "../navigation/RootStack";
import { satsToFiat } from "../store/mock";
import { useAppStore } from "../store/useAppStore";
import { radius, spacing, typography } from "../theme/theme";

type Nav = NativeStackNavigationProp<RootStackParamList, "Main">;

function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default function WalletScreen() {
  const theme = useResolvedTheme();
  const nav = useNavigation<Nav>();
  const wallet = useAppStore((s) => s.wallet);
  const fiatCurrency = useAppStore((s) => s.preferences.fiatCurrency);
  const refreshWallet = useAppStore((s) => s.refreshWallet);
  const detectedNetwork = useAppStore((s) => s.network.detectedNetwork);
  const { format: formatSats, label: unitLabel } = useFormatSats();
  const [refreshing, setRefreshing] = React.useState(false);

  const walletId = wallet?.id;
  React.useEffect(() => {
    if (!walletId) return;
    refreshWallet().catch(() => {
      // surface refresh errors only on user-triggered pulls
    });
  }, [refreshWallet, walletId]);

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

  if (!wallet) {
    return (
      <View
        style={[styles.empty, { backgroundColor: theme.colors.background }]}
      >
        <Inbox color={theme.colors.textSubtle} size={48} />
        <Text style={[styles.emptyText, { color: theme.colors.textMuted }]}>
          No wallet found
        </Text>
      </View>
    );
  }

  const recentActivity = wallet.activities.slice(0, 4);

  return (
    <ScrollView
      style={{ backgroundColor: theme.colors.background }}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={handleRefresh}
          tintColor={theme.colors.primary}
        />
      }
    >
      {/* Balance Card */}
      <View
        style={[
          styles.balanceCard,
          { backgroundColor: theme.colors.card, ...theme.shadow("card") },
        ]}
      >
        <Text style={[styles.walletLabel, { color: theme.colors.textSubtle }]}>
          {wallet.label}
        </Text>
        <Text style={[styles.balance, { color: theme.colors.text }]}>
          {formatSats(wallet.balanceSats)} {unitLabel}
        </Text>
        <Text style={[styles.fiat, { color: theme.colors.textMuted }]}>
          {satsToFiat(wallet.balanceSats, fiatCurrency)}
        </Text>
        <Text style={[styles.networkTag, { color: theme.colors.textSubtle }]}>
          {(detectedNetwork ?? wallet.network).toUpperCase()}
        </Text>
      </View>

      {/* Action Buttons */}
      <View style={styles.actions}>
        <Button
          label="Send"
          variant="primary"
          theme={theme}
          icon={<ArrowUpRight color={theme.colors.onPrimary} size={20} />}
          onPress={() => nav.navigate("SendEntry")}
          style={styles.actionBtn}
        />
        <Button
          label="Receive"
          variant="secondary"
          theme={theme}
          icon={<ArrowDownLeft color={theme.colors.text} size={20} />}
          onPress={() => nav.navigate("ReceiveSelect")}
          style={styles.actionBtn}
        />
      </View>

      {/* Recent Activity */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>
            Recent Activity
          </Text>
          <Pressable
            onPress={() => nav.navigate("Activity")}
            style={styles.seeAll}
          >
            <Text style={[styles.seeAllText, { color: theme.colors.primary }]}>
              See all
            </Text>
            <ChevronRight color={theme.colors.primary} size={16} />
          </Pressable>
        </View>

        {recentActivity.length === 0 ? (
          <View style={styles.emptyTxns}>
            <Clock color={theme.colors.textSubtle} size={32} />
            <Text
              style={[styles.emptyTxnsText, { color: theme.colors.textMuted }]}
            >
              No activity yet
            </Text>
          </View>
        ) : (
          recentActivity.map((item) => {
            const isIn = item.direction === "in";
            const isSelf = item.direction === "self";
            const iconBg = isSelf
              ? `${theme.colors.textSubtle}20`
              : isIn
                ? `${theme.colors.success}20`
                : `${theme.colors.danger}20`;
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
            const sign =
              isSelf || item.amountSats == null ? "" : isIn ? "+" : "-";
            return (
              <Pressable
                key={item.id}
                onPress={() =>
                  nav.navigate("ActivityDetails", { activityId: item.id })
                }
                style={({ pressed }) => [
                  styles.txRow,
                  {
                    borderBottomColor: theme.colors.divider,
                    opacity: pressed ? 0.6 : 1,
                  },
                ]}
              >
                <View style={[styles.txIcon, { backgroundColor: iconBg }]}>
                  {isSelf ? (
                    <Repeat color={iconColor} size={18} />
                  ) : isIn ? (
                    <ArrowDownLeft color={iconColor} size={18} />
                  ) : (
                    <ArrowUpRight color={iconColor} size={18} />
                  )}
                </View>
                <View style={styles.txInfo}>
                  <Text style={[styles.txLabel, { color: theme.colors.text }]}>
                    {item.title}
                  </Text>
                  <Text
                    style={[styles.txTime, { color: theme.colors.textSubtle }]}
                  >
                    {formatRelativeTime(item.timestamp)}
                    {item.status === "pending" ? " · Pending" : ""}
                  </Text>
                </View>
                {item.amountSats != null ? (
                  <Text style={[styles.txAmount, { color: amountColor }]}>
                    {sign}
                    {formatSats(item.amountSats)}
                  </Text>
                ) : null}
              </Pressable>
            );
          })
        )}
      </View>

      {/* Balance Breakdown */}
      <View
        style={[
          styles.statsCard,
          {
            backgroundColor: theme.colors.surfaceSubtle,
            borderColor: theme.colors.border,
          },
        ]}
      >
        <Text style={[styles.statsTitle, { color: theme.colors.textMuted }]}>
          Balance breakdown
        </Text>
        <Text style={[styles.statLine, { color: theme.colors.textSubtle }]}>
          Available offchain: {formatSats(wallet.balanceSats)} {unitLabel}
        </Text>
        <Text style={[styles.statLine, { color: theme.colors.textSubtle }]}>
          Boarding (onchain): {formatSats(wallet.balanceBoardingSats)}{" "}
          {unitLabel}
        </Text>
        <Text style={[styles.statLine, { color: theme.colors.textSubtle }]}>
          Total: {formatSats(wallet.balanceTotalSats)} {unitLabel}
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: spacing[5],
    paddingBottom: 120,
  },
  balanceCard: {
    padding: spacing[6],
    borderRadius: radius.lg,
    alignItems: "center",
  },
  walletLabel: {
    fontSize: typography.size.sm,
    fontWeight: typography.weight.medium,
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  balance: {
    fontSize: 36,
    fontWeight: typography.weight.bold,
    marginTop: spacing[2],
  },
  fiat: {
    fontSize: typography.size.md,
    marginTop: spacing[1],
  },
  networkTag: {
    fontSize: typography.size.xs,
    marginTop: spacing[2],
    letterSpacing: 1,
  },
  actions: {
    flexDirection: "row",
    gap: spacing[3],
    marginTop: spacing[5],
  },
  actionBtn: {
    flex: 1,
  },
  section: {
    marginTop: spacing[6],
  },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: spacing[3],
  },
  sectionTitle: {
    fontSize: typography.size.lg,
    fontWeight: typography.weight.semibold,
  },
  seeAll: {
    flexDirection: "row",
    alignItems: "center",
  },
  seeAllText: {
    fontSize: typography.size.sm,
    fontWeight: typography.weight.medium,
  },
  emptyTxns: {
    alignItems: "center",
    paddingVertical: spacing[8],
  },
  emptyTxnsText: {
    fontSize: typography.size.sm,
    marginTop: spacing[2],
  },
  txRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing[3],
    borderBottomWidth: 1,
  },
  txIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  txInfo: {
    flex: 1,
    marginLeft: spacing[3],
  },
  txLabel: {
    fontSize: typography.size.sm,
    fontWeight: typography.weight.medium,
  },
  txTime: {
    fontSize: typography.size.xs,
    marginTop: 2,
  },
  txAmount: {
    fontSize: typography.size.sm,
    fontWeight: typography.weight.semibold,
    fontVariant: ["tabular-nums"],
  },
  statsCard: {
    marginTop: spacing[6],
    padding: spacing[5],
    borderRadius: radius.md,
    borderWidth: 1,
  },
  statsTitle: {
    fontSize: typography.size.sm,
    fontWeight: typography.weight.semibold,
    marginBottom: spacing[3],
  },
  statLine: {
    fontSize: typography.size.sm,
    marginBottom: spacing[1],
  },
  empty: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  emptyText: {
    fontSize: typography.size.md,
    marginTop: spacing[3],
  },
});
