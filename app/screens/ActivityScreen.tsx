import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Inbox } from "lucide-react-native";
import * as React from "react";
import { FlatList, RefreshControl, StyleSheet, Text, View } from "react-native";
import ActivityRow from "../components/ActivityRow";
import Skeleton from "../components/Skeleton";
import { SyncPill } from "../components/SyncPill";
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

/**
 * Placeholder rows shown on a cold open while the first refresh runs and the
 * cached activity list is empty. Mirrors {@link ActivityRow}'s layout (round
 * avatar + two text lines) so the swap to real rows doesn't jump.
 */
function ActivitySkeletonList(): React.ReactElement {
  return (
    <View>
      {Array.from({ length: 5 }).map((_, i) => (
        <View
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length static placeholder list
          key={i}
          style={styles.skeletonRow}
        >
          <Skeleton width={40} height={40} borderRadius={20} />
          <View style={styles.skeletonInfo}>
            <Skeleton width="55%" height={14} />
            <Skeleton width="35%" height={11} />
          </View>
          <Skeleton width={56} height={14} />
        </View>
      ))}
    </View>
  );
}

export default function ActivityScreen() {
  const theme = useResolvedTheme();
  const nav = useNavigation<Nav>();
  const wallet = useAppStore((s) => s.wallet);
  const network = useAppStore(
    (s) => s.network.detectedNetwork ?? s.wallet?.network ?? null,
  );
  const refreshWallet = useAppStore((s) => s.refreshWallet);
  const syncState = useAppStore((s) => s._syncState);
  const [refreshing, setRefreshing] = React.useState(false);

  const activities = wallet?.activities ?? [];
  const syncing = syncState.kind === "syncing";
  const stage = syncState.kind === "syncing" ? syncState.stage : null;
  // Suppress our affordances while the native RefreshControl is up, so the user
  // never sees two "syncing" indicators at once.
  const showSkeletons = activities.length === 0 && syncing && !refreshing;

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
    <View style={[styles.root, { backgroundColor: theme.colors.background }]}>
      <FlatList
        data={activities}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        style={{ backgroundColor: theme.colors.background }}
        contentContainerStyle={
          activities.length === 0 && !showSkeletons
            ? styles.emptyContainer
            : styles.list
        }
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={theme.colors.primary}
          />
        }
        ListEmptyComponent={
          showSkeletons ? (
            <ActivitySkeletonList />
          ) : (
            <View style={styles.emptyState}>
              <Inbox color={theme.colors.textSubtle} size={56} />
              <Text style={[styles.emptyTitle, { color: theme.colors.text }]}>
                No activity yet
              </Text>
              <Text
                style={[styles.emptyBody, { color: theme.colors.textMuted }]}
              >
                Your wallet activity will appear here
              </Text>
            </View>
          )
        }
      />
      <View style={styles.pillAnchor} pointerEvents="none">
        <SyncPill
          visible={syncing && !refreshing && activities.length > 0}
          stage={stage}
          theme={theme}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  list: {
    paddingHorizontal: spacing[5],
    paddingBottom: spacing[8],
  },
  pillAnchor: {
    position: "absolute",
    top: spacing[3],
    left: 0,
    right: 0,
    alignItems: "center",
  },
  skeletonRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing[3],
  },
  skeletonInfo: {
    flex: 1,
    marginLeft: spacing[3],
    gap: spacing[2],
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
