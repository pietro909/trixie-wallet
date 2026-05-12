import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Inbox } from "lucide-react-native";
import * as React from "react";
import { FlatList, RefreshControl, StyleSheet, Text, View } from "react-native";
import ActivityRow from "../components/ActivityRow";
import { useAssetMetadata } from "../hooks/useAssetMetadata";
import { useResolvedTheme } from "../hooks/useResolvedTheme";
import type { RootStackParamList } from "../navigation/RootStack";
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

export default function ActivityScreen() {
  const theme = useResolvedTheme();
  const nav = useNavigation<Nav>();
  const wallet = useAppStore((s) => s.wallet);
  const network = useAppStore(
    (s) => s.network.detectedNetwork ?? s.wallet?.network ?? null,
  );
  const refreshWallet = useAppStore((s) => s.refreshWallet);
  const [refreshing, setRefreshing] = React.useState(false);

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

  const { assetMetadata, iconApprovals } = useAssetMetadata(
    network,
    assetIdsInActivities,
    { withIconApprovals: true },
  );

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
    return (
      <ActivityRow
        activity={item}
        theme={theme}
        onPress={() => nav.navigate("ActivityDetails", { activityId: item.id })}
        formatTimestamp={formatDate}
        assetMetadata={assetMetadata}
        iconApprovals={iconApprovals}
      />
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
