import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { ChevronRight, Inbox } from "lucide-react-native";
import * as React from "react";
import {
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Button from "../../components/Button";
import { useResolvedTheme } from "../../hooks/useResolvedTheme";
import type { RootStackParamList } from "../../navigation/RootStack";
import type { ContractSummary } from "../../services/arkade/contracts";
import { ArkadeError } from "../../services/arkade/errors";
import { useAppStore } from "../../store/useAppStore";
import { type AppTheme, radius, spacing, typography } from "../../theme/theme";

type Nav = NativeStackNavigationProp<RootStackParamList, "Contracts">;

type StateFilter = "all" | "active" | "inactive";
type TypeFilter = "all" | "default" | "delegate";

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

function stateLabel(state: ContractSummary["state"]): string {
  return state.toUpperCase();
}

type PillVisual = { fg: string; bg: string };

function typePillVisual(type: string, theme: AppTheme): PillVisual {
  if (type === "default") {
    return { fg: theme.colors.primary, bg: theme.colors.primarySoft };
  }
  return { fg: theme.colors.textMuted, bg: theme.colors.surfaceSubtle };
}

function statePillVisual(
  state: ContractSummary["state"],
  theme: AppTheme,
): PillVisual {
  if (state === "active") {
    return { fg: theme.colors.success, bg: theme.colors.successSoft };
  }
  return { fg: theme.colors.textMuted, bg: theme.colors.surfaceSubtle };
}

function emptyCopy(stateFilter: StateFilter, typeFilter: TypeFilter): string {
  if (stateFilter === "all" && typeFilter === "all") {
    return "The wallet has no registered contracts.";
  }
  return "No contracts match these filters.";
}

type FilterChipProps<T extends string> = {
  label: string;
  value: T;
  /** Sentinel returned when an already-active specific chip is tapped. */
  defaultValue: T;
  active: boolean;
  onSelect: (v: T) => void;
  theme: AppTheme;
};

function FilterChip<T extends string>({
  label,
  value,
  defaultValue,
  active,
  onSelect,
  theme,
}: FilterChipProps<T>): React.ReactElement {
  // Tapping an active specific chip deselects back to the row's default
  // ("all"). The default chip itself is a no-op when active. Tapping an
  // inactive chip selects it (rows are mutually exclusive).
  const handlePress = () => {
    if (active) {
      if (value !== defaultValue) onSelect(defaultValue);
      return;
    }
    onSelect(value);
  };
  return (
    <Pressable
      onPress={handlePress}
      style={({ pressed }) => [
        styles.chip,
        {
          backgroundColor: active
            ? theme.colors.primary
            : theme.colors.surfaceSubtle,
          opacity: pressed ? 0.7 : 1,
        },
      ]}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
    >
      <Text
        style={[
          styles.chipText,
          { color: active ? theme.colors.onPrimary : theme.colors.text },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export default function ContractsScreen(): React.ReactElement {
  const theme = useResolvedTheme();
  const nav = useNavigation<Nav>();
  const loadWalletContractSummaries = useAppStore(
    (s) => s.loadWalletContractSummaries,
  );
  const [contracts, setContracts] = React.useState<ContractSummary[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [stateFilter, setStateFilter] = React.useState<StateFilter>("all");
  const [typeFilter, setTypeFilter] = React.useState<TypeFilter>("all");

  const fetch = React.useCallback(
    async (mode: "initial" | "refresh") => {
      if (mode === "initial") setLoading(true);
      else setRefreshing(true);
      try {
        const next = await loadWalletContractSummaries();
        setContracts(next);
        setError(null);
      } catch (e) {
        const msg =
          e instanceof ArkadeError
            ? e.message
            : e instanceof Error
              ? e.message
              : "Failed to load contracts";
        setError(msg);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [loadWalletContractSummaries],
  );

  useFocusEffect(
    React.useCallback(() => {
      void fetch("initial");
    }, [fetch]),
  );

  const filtered = React.useMemo(() => {
    return contracts.filter((c) => {
      const stateMatch = stateFilter === "all" || c.state === stateFilter;
      const typeMatch = typeFilter === "all" || c.type === typeFilter;
      return stateMatch && typeMatch;
    });
  }, [contracts, stateFilter, typeFilter]);

  const renderItem = React.useCallback(
    ({ item }: { item: ContractSummary }) => {
      const tp = typePillVisual(item.type, theme);
      const sp = statePillVisual(item.state, theme);
      return (
        <Pressable
          onPress={() =>
            nav.navigate("ContractDetail", { script: item.script })
          }
          style={({ pressed }) => [
            styles.row,
            {
              borderBottomColor: theme.colors.divider,
              opacity: pressed ? 0.6 : 1,
            },
          ]}
          accessibilityRole="button"
          accessibilityLabel={`Open ${item.type} contract`}
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
            <ChevronRight color={theme.colors.textSubtle} size={18} />
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
    [theme, nav],
  );

  const header = (
    <View>
      <Text style={[styles.title, { color: theme.colors.text }]}>
        Your contracts
      </Text>
      <Text style={[styles.subtitle, { color: theme.colors.textMuted }]}>
        Every Arkade contract registered against this wallet. Tap a row to view
        details, edit its label, or reveal its parameters.
      </Text>
      <View style={styles.filterGroup}>
        <Text style={[styles.filterLabel, { color: theme.colors.textMuted }]}>
          State
        </Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipsRow}
        >
          <FilterChip
            label="All"
            value="all"
            defaultValue="all"
            active={stateFilter === "all"}
            onSelect={setStateFilter}
            theme={theme}
          />
          <FilterChip
            label="Active"
            value="active"
            defaultValue="all"
            active={stateFilter === "active"}
            onSelect={setStateFilter}
            theme={theme}
          />
          <FilterChip
            label="Inactive"
            value="inactive"
            defaultValue="all"
            active={stateFilter === "inactive"}
            onSelect={setStateFilter}
            theme={theme}
          />
        </ScrollView>
      </View>
      <View style={styles.filterGroup}>
        <Text style={[styles.filterLabel, { color: theme.colors.textMuted }]}>
          Type
        </Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipsRow}
        >
          <FilterChip
            label="All"
            value="all"
            defaultValue="all"
            active={typeFilter === "all"}
            onSelect={setTypeFilter}
            theme={theme}
          />
          <FilterChip
            label="Default"
            value="default"
            defaultValue="all"
            active={typeFilter === "default"}
            onSelect={setTypeFilter}
            theme={theme}
          />
          <FilterChip
            label="Delegate"
            value="delegate"
            defaultValue="all"
            active={typeFilter === "delegate"}
            onSelect={setTypeFilter}
            theme={theme}
          />
        </ScrollView>
      </View>
    </View>
  );

  if (loading && contracts.length === 0 && !error) {
    return (
      <View
        style={[styles.empty, { backgroundColor: theme.colors.background }]}
      >
        <Text style={[styles.emptyText, { color: theme.colors.textMuted }]}>
          Loading contracts…
        </Text>
      </View>
    );
  }

  if (error && contracts.length === 0) {
    return (
      <View
        style={[styles.errorBox, { backgroundColor: theme.colors.background }]}
      >
        <Text style={[styles.errorTitle, { color: theme.colors.text }]}>
          Couldn't load contracts
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
      data={filtered}
      keyExtractor={(item) => item.script}
      renderItem={renderItem}
      ListHeaderComponent={header}
      ListEmptyComponent={
        <View style={styles.emptyState}>
          <Inbox color={theme.colors.textSubtle} size={56} />
          <Text style={[styles.emptyStateTitle, { color: theme.colors.text }]}>
            {contracts.length === 0
              ? "No contracts yet"
              : "No matching contracts"}
          </Text>
          <Text
            style={[styles.emptyStateBody, { color: theme.colors.textMuted }]}
          >
            {emptyCopy(stateFilter, typeFilter)}
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
  filterGroup: {
    marginBottom: spacing[3],
  },
  filterLabel: {
    fontSize: typography.size.xs,
    fontWeight: typography.weight.semibold,
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: spacing[2],
  },
  chipsRow: {
    flexDirection: "row",
    gap: spacing[2],
    paddingRight: spacing[2],
  },
  chip: {
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    borderRadius: radius.pill,
  },
  chipText: {
    fontSize: typography.size.xs,
    fontWeight: typography.weight.semibold,
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
