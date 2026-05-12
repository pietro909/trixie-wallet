import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Inbox } from "lucide-react-native";
import * as React from "react";
import {
  FlatList,
  Linking,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Button from "../../components/Button";
import { useFormatSats } from "../../hooks/useFormatSats";
import { useResolvedTheme } from "../../hooks/useResolvedTheme";
import type { RootStackParamList } from "../../navigation/RootStack";
import { ArkadeError } from "../../services/arkade/errors";
import type {
  ClassifiedVtxo,
  VtxoStatus,
} from "../../services/arkade/vtxo-listing";
import { vtxoStatusVisuals } from "../../services/vtxo-status";
import { useAppStore } from "../../store/useAppStore";
import { radius, spacing, typography } from "../../theme/theme";

type Nav = NativeStackNavigationProp<RootStackParamList, "VtxoList">;

function shortOutpoint(outpoint: string): string {
  const [txid, vout] = outpoint.split(":");
  if (!txid || vout == null) return outpoint;
  const head = txid.slice(0, 8);
  return `${head}…:${vout}`;
}

function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

const STATUS_KEY: VtxoStatus[] = [
  "settled",
  "preconfirmed",
  "swept",
  "subdust",
  "spent",
];

export default function VtxoListScreen(): React.ReactElement {
  const theme = useResolvedTheme();
  const nav = useNavigation<Nav>();
  const arkAddress = useAppStore((s) => s.wallet?.arkAddress ?? null);
  const network = useAppStore(
    (s) => s.network.detectedNetwork ?? s.wallet?.network ?? null,
  );
  const loadWalletVtxos = useAppStore((s) => s.loadWalletVtxos);
  const { format: formatSats, label: unitLabel } = useFormatSats();
  const [vtxos, setVtxos] = React.useState<ClassifiedVtxo[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const fetch = React.useCallback(
    async (mode: "initial" | "refresh") => {
      if (mode === "initial") setLoading(true);
      else setRefreshing(true);
      try {
        const next = await loadWalletVtxos();
        setVtxos(next);
        setError(null);
      } catch (e) {
        const msg =
          e instanceof ArkadeError
            ? e.message
            : e instanceof Error
              ? e.message
              : "Failed to load VTXOs";
        setError(msg);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [loadWalletVtxos],
  );

  useFocusEffect(
    React.useCallback(() => {
      void fetch("initial");
    }, [fetch]),
  );

  const openExplorer = React.useCallback(() => {
    if (!arkAddress || !network) return;
    const base =
      network.toLowerCase() === "mutinynet"
        ? "https://explorer.mutinynet.arkade.sh"
        : "https://arkade.space";
    void Linking.openURL(`${base}/address/${arkAddress}`);
  }, [arkAddress, network]);

  // `renderItem` must keep a stable identity across renders: FlatList
  // compares it by reference when deciding whether to re-render visible
  // rows. A fresh function each render forces every on-screen VTXO to
  // recompute its visuals — fine at 30 rows, painful at 3000.
  const renderItem = React.useCallback(
    ({ item }: { item: ClassifiedVtxo }) => {
      const visuals = vtxoStatusVisuals(item.status, theme);
      const hasAssets = item.assets && item.assets.length > 0;
      return (
        <Pressable
          onPress={() =>
            nav.navigate("VtxoDetail", { outpoint: item.outpoint })
          }
          style={({ pressed }) => [
            styles.row,
            {
              borderBottomColor: theme.colors.divider,
              opacity: pressed ? 0.6 : 1,
            },
          ]}
        >
          <View style={styles.rowMain}>
            <Text
              style={[styles.amount, { color: visuals.amountColor }]}
              numberOfLines={1}
            >
              {formatSats(item.amountSats)} {unitLabel}
            </Text>
            <View style={[styles.pill, { backgroundColor: visuals.bg }]}>
              <Text style={[styles.pillText, { color: visuals.fg }]}>
                {visuals.label}
              </Text>
            </View>
            {hasAssets ? (
              <View
                style={[
                  styles.pill,
                  { backgroundColor: theme.colors.primarySoft },
                ]}
              >
                <Text
                  style={[styles.pillText, { color: theme.colors.primary }]}
                >
                  + ASSET
                </Text>
              </View>
            ) : null}
          </View>
          <View style={styles.rowSub}>
            <Text style={[styles.outpoint, { color: theme.colors.textSubtle }]}>
              {shortOutpoint(item.outpoint)}
            </Text>
            <Text style={[styles.created, { color: theme.colors.textSubtle }]}>
              {relativeTime(item.createdAt.getTime())}
            </Text>
          </View>
        </Pressable>
      );
    },
    [theme, formatSats, unitLabel, nav],
  );

  const header = (
    <View>
      <Text style={[styles.title, { color: theme.colors.text }]}>
        VTXOs at this address
      </Text>
      <Text style={[styles.subtitle, { color: theme.colors.textMuted }]}>
        Every virtual output linked to your Arkade address, sorted by amount.
        Pull to refresh.
      </Text>
      <View style={styles.legend}>
        {STATUS_KEY.map((key) => {
          const s = vtxoStatusVisuals(key, theme);
          return (
            <View key={key} style={styles.legendRow}>
              <View style={[styles.pill, { backgroundColor: s.bg }]}>
                <Text style={[styles.pillText, { color: s.fg }]}>
                  {s.label}
                </Text>
              </View>
              <Text
                style={[styles.legendText, { color: theme.colors.textSubtle }]}
              >
                {s.description}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );

  if (loading && vtxos.length === 0 && !error) {
    return (
      <View
        style={[styles.empty, { backgroundColor: theme.colors.background }]}
      >
        <Text style={[styles.emptyText, { color: theme.colors.textMuted }]}>
          Loading VTXOs…
        </Text>
      </View>
    );
  }

  if (error && vtxos.length === 0) {
    return (
      <View
        style={[styles.errorBox, { backgroundColor: theme.colors.background }]}
      >
        <Text style={[styles.errorTitle, { color: theme.colors.text }]}>
          Couldn't load VTXOs
        </Text>
        <Text style={[styles.errorBody, { color: theme.colors.textMuted }]}>
          {error}
        </Text>
        <Button
          label="Retry"
          theme={theme}
          onPress={() => {
            void fetch("initial");
          }}
        />
        {arkAddress && network ? (
          <Pressable onPress={openExplorer} style={styles.explorerLink}>
            <Text
              style={[styles.explorerText, { color: theme.colors.primary }]}
            >
              Open address in explorer
            </Text>
          </Pressable>
        ) : null}
      </View>
    );
  }

  return (
    <FlatList
      data={vtxos}
      keyExtractor={(item) => item.outpoint}
      renderItem={renderItem}
      ListHeaderComponent={header}
      ListEmptyComponent={
        <View style={styles.emptyState}>
          <Inbox color={theme.colors.textSubtle} size={56} />
          <Text style={[styles.emptyStateTitle, { color: theme.colors.text }]}>
            No VTXOs at this address yet
          </Text>
          <Text
            style={[styles.emptyStateBody, { color: theme.colors.textMuted }]}
          >
            Virtual outputs will appear here once you receive funds.
          </Text>
        </View>
      }
      style={{ backgroundColor: theme.colors.background }}
      contentContainerStyle={styles.list}
      initialNumToRender={30}
      windowSize={7}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => {
            void fetch("refresh");
          }}
          tintColor={theme.colors.primary}
        />
      }
    />
  );
}

const styles = StyleSheet.create({
  list: {
    padding: spacing[5],
    paddingBottom: 120,
  },
  title: {
    fontSize: typography.size.lg,
    fontWeight: typography.weight.semibold,
  },
  subtitle: {
    fontSize: typography.size.sm,
    marginTop: spacing[2],
    marginBottom: spacing[4],
    lineHeight: typography.size.sm * 1.4,
  },
  legend: {
    gap: spacing[2],
    marginBottom: spacing[4],
  },
  legendRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing[3],
  },
  legendText: {
    flex: 1,
    fontSize: typography.size.xs,
    lineHeight: typography.size.xs * 1.4,
  },
  row: {
    paddingVertical: spacing[3],
    borderBottomWidth: 1,
  },
  rowMain: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
  },
  rowSub: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 4,
  },
  amount: {
    fontSize: typography.size.md,
    fontWeight: typography.weight.semibold,
    fontVariant: ["tabular-nums"],
    flex: 1,
  },
  pill: {
    paddingHorizontal: spacing[2],
    paddingVertical: 2,
    borderRadius: radius.pill,
  },
  pillText: {
    fontSize: typography.size.xs,
    fontWeight: typography.weight.medium,
  },
  outpoint: {
    fontFamily: typography.fontFamily.mono,
    fontSize: typography.size.xs,
  },
  created: {
    fontSize: typography.size.xs,
  },
  emptyState: {
    alignItems: "center",
    paddingTop: 60,
  },
  emptyStateTitle: {
    fontSize: typography.size.lg,
    fontWeight: typography.weight.semibold,
    marginTop: spacing[4],
  },
  emptyStateBody: {
    fontSize: typography.size.sm,
    marginTop: spacing[2],
    textAlign: "center",
  },
  empty: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  emptyText: {
    fontSize: typography.size.md,
  },
  errorBox: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: spacing[6],
    gap: spacing[3],
  },
  errorTitle: {
    fontSize: typography.size.lg,
    fontWeight: typography.weight.semibold,
  },
  errorBody: {
    fontSize: typography.size.sm,
    textAlign: "center",
  },
  explorerLink: {
    marginTop: spacing[2],
  },
  explorerText: {
    fontSize: typography.size.sm,
    fontWeight: typography.weight.medium,
  },
});
