import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import {
  ArrowDownLeft,
  ArrowUpRight,
  ChevronDown,
  ChevronRight,
  Clock,
  Inbox,
  ListTree,
  Plus,
} from "lucide-react-native";
import * as React from "react";
import {
  type LayoutChangeEvent,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import ActivityRow from "../components/ActivityRow";
import AssetCard from "../components/AssetCard";
import Button from "../components/Button";
import SignerRotationBanner from "../components/SignerRotationBanner";
import { SyncPill } from "../components/SyncPill";
import { useAssetMetadata } from "../hooks/useAssetMetadata";
import { useFormatSats } from "../hooks/useFormatSats";
import { useResolvedTheme } from "../hooks/useResolvedTheme";
import type { RootStackParamList } from "../navigation/RootStack";
import { computePendingTotals } from "../services/wallet-balance";
import { satsToFiat } from "../store/mock";
import { useAppStore } from "../store/useAppStore";
import { type AppTheme, radius, spacing, typography } from "../theme/theme";

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

function AssetSectionHeader({
  primaryColor,
  textColor,
  onMint,
  onImport,
  collapsed,
  onToggle,
  assetCount,
}: {
  primaryColor: string;
  textColor: string;
  onMint: () => void;
  onImport: () => void;
  collapsed: boolean;
  onToggle: () => void;
  assetCount: number;
}): React.ReactElement {
  const ChevronIcon = collapsed ? ChevronRight : ChevronDown;
  return (
    <View style={styles.sectionHeader}>
      <Pressable onPress={onToggle} style={styles.assetTitleRow}>
        <ChevronIcon color={textColor} size={16} />
        <Text style={[styles.sectionTitle, { color: textColor }]}>
          Assets ({assetCount})
        </Text>
      </Pressable>
      <View style={styles.assetActions}>
        <Pressable
          onPress={onMint}
          style={styles.seeAll}
          accessibilityLabel="Mint new asset"
        >
          <Plus color={primaryColor} size={16} />
          <Text style={[styles.seeAllText, { color: primaryColor }]}>Mint</Text>
        </Pressable>
        <Pressable
          onPress={onImport}
          style={styles.seeAll}
          accessibilityLabel="Import asset"
        >
          <Plus color={primaryColor} size={16} />
          <Text style={[styles.seeAllText, { color: primaryColor }]}>
            Import
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

function WalletActionDock({
  theme,
  bottomOffset,
  onSend,
  onReceive,
  onHeightChange,
}: {
  theme: AppTheme;
  bottomOffset: number;
  onSend: () => void;
  onReceive: () => void;
  onHeightChange: (height: number) => void;
}): React.ReactElement {
  function handleLayout(event: LayoutChangeEvent) {
    onHeightChange(event.nativeEvent.layout.height);
  }

  return (
    <View
      onLayout={handleLayout}
      style={[
        styles.dock,
        {
          bottom: bottomOffset,
          backgroundColor: theme.colors.surfaceSubtle,
          borderColor: theme.colors.border,
          ...theme.shadow("popover"),
        },
      ]}
    >
      <View style={styles.dockRow}>
        <Button
          label="Send"
          variant="primary"
          theme={theme}
          icon={<ArrowUpRight color={theme.colors.onPrimary} size={20} />}
          onPress={onSend}
          accessibilityLabel="Send bitcoin or assets"
          style={styles.dockButton}
        />
        <Button
          label="Receive"
          variant="secondary"
          theme={theme}
          icon={<ArrowDownLeft color={theme.colors.text} size={20} />}
          onPress={onReceive}
          accessibilityLabel="Receive bitcoin, Lightning, or assets"
          style={styles.dockButton}
        />
      </View>
    </View>
  );
}

export default function WalletScreen() {
  const theme = useResolvedTheme();
  const nav = useNavigation<Nav>();
  const wallet = useAppStore((s) => s.wallet);
  const fiatCurrency = useAppStore((s) => s.preferences.fiatCurrency);
  const refreshWallet = useAppStore((s) => s.refreshWallet);
  const syncState = useAppStore((s) => s._syncState);
  const detectedNetwork = useAppStore((s) => s.network.detectedNetwork);
  const importedAssetIds = useAppStore((s) => s.assets.importedAssetIds);
  const { format: formatSats, label: unitLabel } = useFormatSats();
  const insets = useSafeAreaInsets();
  const [refreshing, setRefreshing] = React.useState(false);
  const [assetsCollapsed, setAssetsCollapsed] = React.useState(true);
  const [dockHeight, setDockHeight] = React.useState(0);

  // Mirrors the tab bar's positioning from makeBottomTabsOptions():
  // distance from screen edge + tab bar height + gap so the dock reads as
  // a sibling of the floating tab bar, not merged with it.
  const dockBottomOffset =
    spacing[3] + Math.max(0, insets.bottom - 6) + 64 + spacing[3];
  // Button.minHeight (48) + 2 * spacing[2] (dock container vertical padding)
  // matches the steady-state dock height at default text size; used until
  // onLayout reports the real value (which grows with accessibility text).
  const dockClearance = dockHeight > 0 ? dockHeight : 64;
  const scrollPaddingBottom = dockBottomOffset + dockClearance + spacing[5];

  const walletId = wallet?.id;
  React.useEffect(() => {
    if (!walletId) return;
    refreshWallet().catch(() => {
      // surface refresh errors only on user-triggered pulls
    });
  }, [refreshWallet, walletId]);

  const network = detectedNetwork ?? wallet?.network ?? null;
  const assetBalances = wallet?.assetBalances ?? [];

  const assetIds = React.useMemo(() => {
    const set = new Set<string>();
    for (const e of assetBalances) set.add(e.assetId);
    for (const id of importedAssetIds) set.add(id);
    return Array.from(set);
  }, [assetBalances, importedAssetIds]);

  const { assetMetadata, iconApprovals } = useAssetMetadata(network, assetIds, {
    withIconApprovals: true,
    hydrateMissing: true,
  });

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
  const pendingTotals = computePendingTotals(wallet.activities);

  return (
    <View style={[styles.root, { backgroundColor: theme.colors.background }]}>
      <ScrollView
        style={{ flex: 1, backgroundColor: theme.colors.background }}
        contentContainerStyle={[
          styles.content,
          { paddingBottom: scrollPaddingBottom },
        ]}
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
          <SyncPill
            visible={syncState.kind === "syncing" && !refreshing}
            stage={syncState.kind === "syncing" ? syncState.stage : null}
            theme={theme}
            style={styles.syncPill}
          />
          <Text
            style={[styles.walletLabel, { color: theme.colors.textSubtle }]}
          >
            {wallet.label}
          </Text>
          <Text style={[styles.balance, { color: theme.colors.text }]}>
            {formatSats(wallet.balanceSats)} {unitLabel}
          </Text>
          <Text style={[styles.fiat, { color: theme.colors.textMuted }]}>
            {satsToFiat(wallet.balanceSats, fiatCurrency)}
          </Text>
          {(() => {
            const tagNetwork = detectedNetwork ?? wallet.network;
            const isMainnet = tagNetwork === "bitcoin";
            return (
              <View
                style={[
                  styles.networkTag,
                  {
                    backgroundColor: isMainnet
                      ? theme.colors.primary
                      : theme.colors.warning,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.networkTagText,
                    {
                      color: isMainnet
                        ? theme.colors.onPrimary
                        : theme.colors.onWarning,
                    },
                  ]}
                >
                  {isMainnet ? "MAINNET" : tagNetwork.toUpperCase()}
                </Text>
              </View>
            );
          })()}
        </View>

        {/* Signer rotation status — surfaced directly under the balance so
            critical key-rotation state is visible on Wallet open. */}
        <SignerRotationBanner theme={theme} />

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
              <Text
                style={[styles.seeAllText, { color: theme.colors.primary }]}
              >
                See all
              </Text>
              <ChevronRight color={theme.colors.primary} size={16} />
            </Pressable>
          </View>

          {recentActivity.length === 0 ? (
            <View style={styles.emptyTxns}>
              <Clock color={theme.colors.textSubtle} size={32} />
              <Text
                style={[
                  styles.emptyTxnsText,
                  { color: theme.colors.textMuted },
                ]}
              >
                No activity yet
              </Text>
            </View>
          ) : (
            recentActivity.map((item) => (
              <ActivityRow
                key={item.id}
                activity={item}
                theme={theme}
                onPress={() =>
                  nav.navigate("ActivityDetails", { activityId: item.id })
                }
                formatTimestamp={formatRelativeTime}
                assetMetadata={assetMetadata}
                iconApprovals={iconApprovals}
              />
            ))
          )}
        </View>

        {/* Assets */}
        <View style={styles.section}>
          <AssetSectionHeader
            primaryColor={theme.colors.primary}
            textColor={theme.colors.text}
            onMint={() => nav.navigate("AssetMint")}
            onImport={() => nav.navigate("AssetImport")}
            collapsed={assetsCollapsed}
            onToggle={() => setAssetsCollapsed((c) => !c)}
            assetCount={assetIds.length}
          />
          {!assetsCollapsed &&
            (assetIds.length > 0 ? (
              <View style={styles.assetList}>
                {assetIds.map((id) => {
                  const entry = assetBalances.find((b) => b.assetId === id);
                  let amount = 0n;
                  try {
                    amount = entry ? BigInt(entry.amount) : 0n;
                  } catch {
                    amount = 0n;
                  }
                  return (
                    <AssetCard
                      key={id}
                      assetId={id}
                      amount={amount}
                      details={assetMetadata.get(id)}
                      approvedIcon={iconApprovals[id] === true}
                      onPress={() =>
                        nav.navigate("AssetDetail", { assetId: id })
                      }
                    />
                  );
                })}
              </View>
            ) : (
              <Text
                style={[styles.assetsEmpty, { color: theme.colors.textSubtle }]}
              >
                No assets yet. Mint or import to track Arkade-native assets
                here.
              </Text>
            ))}
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
          {pendingTotals.inboundSats > 0 ? (
            <View style={styles.pendingLine}>
              <Text style={[styles.statLine, { color: theme.colors.pending }]}>
                Pending inbound: {formatSats(pendingTotals.inboundSats)}{" "}
                {unitLabel}
              </Text>
              <View
                style={[
                  styles.pendingChip,
                  { backgroundColor: theme.colors.pendingSoft },
                ]}
              >
                <Text
                  style={[
                    styles.pendingChipText,
                    { color: theme.colors.pending },
                  ]}
                >
                  Pending
                </Text>
              </View>
            </View>
          ) : null}
          {pendingTotals.outboundSats > 0 ? (
            <View style={styles.pendingLine}>
              <Text style={[styles.statLine, { color: theme.colors.pending }]}>
                Pending outbound: {formatSats(pendingTotals.outboundSats)}{" "}
                {unitLabel}
              </Text>
              <View
                style={[
                  styles.pendingChip,
                  { backgroundColor: theme.colors.pendingSoft },
                ]}
              >
                <Text
                  style={[
                    styles.pendingChipText,
                    { color: theme.colors.pending },
                  ]}
                >
                  In flight
                </Text>
              </View>
            </View>
          ) : null}
          <Text style={[styles.statLine, { color: theme.colors.textSubtle }]}>
            Total: {formatSats(wallet.balanceTotalSats)} {unitLabel}
          </Text>
          <Pressable
            onPress={() => nav.navigate("VtxoList")}
            style={({ pressed }) => [
              styles.vtxoLink,
              { opacity: pressed ? 0.6 : 1 },
            ]}
          >
            <ListTree color={theme.colors.primary} size={16} />
            <Text
              style={[styles.vtxoLinkText, { color: theme.colors.primary }]}
            >
              View VTXOs
            </Text>
            <ChevronRight color={theme.colors.primary} size={16} />
          </Pressable>
        </View>
      </ScrollView>
      <WalletActionDock
        theme={theme}
        bottomOffset={dockBottomOffset}
        onSend={() => nav.navigate("SendEntry")}
        onReceive={() => nav.navigate("ReceiveSelect")}
        onHeightChange={setDockHeight}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  content: {
    padding: spacing[5],
  },
  dock: {
    position: "absolute",
    left: spacing[5],
    right: spacing[5],
    borderRadius: radius.lg,
    padding: spacing[2],
    borderWidth: 1,
  },
  dockRow: {
    flexDirection: "row",
    gap: spacing[3],
  },
  dockButton: {
    flex: 1,
  },
  balanceCard: {
    padding: spacing[6],
    borderRadius: radius.lg,
    alignItems: "center",
  },
  syncPill: {
    position: "absolute",
    top: spacing[3],
    right: spacing[3],
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
    alignSelf: "flex-start",
    marginTop: spacing[3],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[1],
    borderRadius: radius.pill,
  },
  networkTagText: {
    fontSize: typography.size.xs,
    fontWeight: typography.weight.bold,
    letterSpacing: 1,
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
  assetList: {
    gap: spacing[2],
  },
  assetTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
  },
  assetActions: {
    flexDirection: "row",
    gap: spacing[3],
  },
  assetsEmpty: {
    fontSize: typography.size.sm,
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
  pendingLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
  },
  pendingChip: {
    paddingHorizontal: spacing[2],
    paddingVertical: 1,
    borderRadius: radius.pill,
    marginBottom: spacing[1],
  },
  pendingChipText: {
    fontSize: typography.size.xs,
    fontWeight: typography.weight.medium,
  },
  vtxoLink: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[1],
    marginTop: spacing[3],
  },
  vtxoLinkText: {
    fontSize: typography.size.sm,
    fontWeight: typography.weight.medium,
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
