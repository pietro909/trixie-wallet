import { useFocusEffect } from "@react-navigation/native";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { ExternalLink, Inbox } from "lucide-react-native";
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
import { useToast } from "../../components/ToastProvider";
import { useResolvedTheme } from "../../hooks/useResolvedTheme";
import { explorerUrl } from "../../services/activity-details/explorer";
import type { OwnedAddress } from "../../services/arkade/addresses";
import { ArkadeError } from "../../services/arkade/errors";
import { useAppStore } from "../../store/useAppStore";
import { type AppTheme, radius, spacing, typography } from "../../theme/theme";

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

function typeLabel(type: string): string {
  return type.toUpperCase();
}

function stateLabel(state: OwnedAddress["state"]): string {
  return state.toUpperCase();
}

type PillVisual = {
  fg: string;
  bg: string;
};

function typePillVisual(type: string, theme: AppTheme): PillVisual {
  if (type === "default") {
    return { fg: theme.colors.primary, bg: theme.colors.primarySoft };
  }
  return { fg: theme.colors.textMuted, bg: theme.colors.surfaceSubtle };
}

function statePillVisual(
  state: OwnedAddress["state"],
  theme: AppTheme,
): PillVisual {
  if (state === "active") {
    return { fg: theme.colors.success, bg: theme.colors.successSoft };
  }
  return { fg: theme.colors.textMuted, bg: theme.colors.surfaceSubtle };
}

export default function AddressesScreen(): React.ReactElement {
  const theme = useResolvedTheme();
  const network = useAppStore(
    (s) => s.network.detectedNetwork ?? s.wallet?.network ?? null,
  );
  const loadWalletAddresses = useAppStore((s) => s.loadWalletAddresses);
  const { showToast } = useToast();
  const [items, setItems] = React.useState<OwnedAddress[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const fetch = React.useCallback(
    async (mode: "initial" | "refresh") => {
      if (mode === "initial") setLoading(true);
      else setRefreshing(true);
      try {
        const next = await loadWalletAddresses();
        setItems(next);
        setError(null);
      } catch (e) {
        const msg =
          e instanceof ArkadeError
            ? e.message
            : e instanceof Error
              ? e.message
              : "Failed to load addresses";
        setError(msg);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [loadWalletAddresses],
  );

  useFocusEffect(
    React.useCallback(() => {
      void fetch("initial");
    }, [fetch]),
  );

  const handleCopy = React.useCallback(
    async (address: string) => {
      try {
        await Clipboard.setStringAsync(address);
        Haptics.selectionAsync().catch(() => {});
        showToast("Address copied", "success");
      } catch {
        showToast("Could not copy", "error");
      }
    },
    [showToast],
  );

  const handleOpenExplorer = React.useCallback(
    async (address: string) => {
      const url = explorerUrl("arkade_address", address, network);
      if (!url) {
        showToast("No explorer for this network", "error");
        return;
      }
      try {
        const supported = await Linking.canOpenURL(url);
        if (supported) {
          await Linking.openURL(url);
        } else {
          showToast("Cannot open link", "error");
        }
      } catch {
        showToast("Cannot open link", "error");
      }
    },
    [network, showToast],
  );

  const renderItem = React.useCallback(
    ({ item }: { item: OwnedAddress }) => {
      const tp = typePillVisual(item.type, theme);
      const sp = statePillVisual(item.state, theme);
      return (
        <Pressable
          onPress={() => {
            void handleCopy(item.address);
          }}
          style={({ pressed }) => [
            styles.row,
            {
              borderBottomColor: theme.colors.divider,
              opacity: pressed ? 0.6 : 1,
            },
          ]}
          accessibilityRole="button"
          accessibilityLabel={`Copy ${item.type} address`}
        >
          <View style={styles.rowMain}>
            <View style={[styles.pill, { backgroundColor: tp.bg }]}>
              <Text style={[styles.pillText, { color: tp.fg }]}>
                {typeLabel(item.type)}
              </Text>
            </View>
            <View style={[styles.pill, { backgroundColor: sp.bg }]}>
              <Text style={[styles.pillText, { color: sp.fg }]}>
                {stateLabel(item.state)}
              </Text>
            </View>
            <View style={styles.spacer} />
            <Pressable
              onPress={() => {
                void handleOpenExplorer(item.address);
              }}
              hitSlop={8}
              style={({ pressed }) => [
                styles.iconBtn,
                {
                  backgroundColor: theme.colors.surfaceSubtle,
                  opacity: pressed ? 0.6 : 1,
                },
              ]}
              accessibilityLabel={`Open ${item.type} address in explorer`}
              accessibilityRole="button"
            >
              <ExternalLink color={theme.colors.textMuted} size={16} />
            </Pressable>
          </View>
          <Text
            style={[styles.address, { color: theme.colors.text }]}
            numberOfLines={1}
            ellipsizeMode="middle"
          >
            {item.address}
          </Text>
          <View style={styles.rowSub}>
            {item.label ? (
              <Text
                style={[styles.label, { color: theme.colors.textSubtle }]}
                numberOfLines={1}
              >
                {item.label}
              </Text>
            ) : (
              <View />
            )}
            <Text style={[styles.created, { color: theme.colors.textSubtle }]}>
              {relativeTime(item.createdAt)}
            </Text>
          </View>
        </Pressable>
      );
    },
    [theme, handleCopy, handleOpenExplorer],
  );

  const header = (
    <View>
      <Text style={[styles.title, { color: theme.colors.text }]}>
        Your addresses
      </Text>
      <Text style={[styles.subtitle, { color: theme.colors.textMuted }]}>
        Every address registered against this wallet. Tap a row to copy, or use
        the external link to open it in the network explorer.
      </Text>
    </View>
  );

  if (loading && items.length === 0 && !error) {
    return (
      <View
        style={[styles.empty, { backgroundColor: theme.colors.background }]}
      >
        <Text style={[styles.emptyText, { color: theme.colors.textMuted }]}>
          Loading addresses…
        </Text>
      </View>
    );
  }

  if (error && items.length === 0) {
    return (
      <View
        style={[styles.errorBox, { backgroundColor: theme.colors.background }]}
      >
        <Text style={[styles.errorTitle, { color: theme.colors.text }]}>
          Couldn't load addresses
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
      </View>
    );
  }

  return (
    <FlatList
      data={items}
      keyExtractor={(item) => item.script}
      renderItem={renderItem}
      ListHeaderComponent={header}
      ListEmptyComponent={
        <View style={styles.emptyState}>
          <Inbox color={theme.colors.textSubtle} size={56} />
          <Text style={[styles.emptyStateTitle, { color: theme.colors.text }]}>
            No addresses yet
          </Text>
          <Text
            style={[styles.emptyStateBody, { color: theme.colors.textMuted }]}
          >
            The wallet has no registered contracts.
          </Text>
        </View>
      }
      style={{ backgroundColor: theme.colors.background }}
      contentContainerStyle={styles.list}
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
  row: {
    paddingVertical: spacing[3],
    borderBottomWidth: 1,
    gap: spacing[2],
  },
  rowMain: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
  },
  spacer: {
    flex: 1,
  },
  rowSub: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
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
  address: {
    fontFamily: typography.fontFamily.mono,
    fontSize: typography.size.sm,
  },
  label: {
    fontSize: typography.size.xs,
    flex: 1,
    marginRight: spacing[2],
  },
  created: {
    fontSize: typography.size.xs,
  },
  iconBtn: {
    width: 32,
    height: 32,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
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
});
