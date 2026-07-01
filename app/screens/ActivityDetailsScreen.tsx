import type { BoltzSwap } from "@arkade-os/boltz-swap";
import { type RouteProp, useRoute } from "@react-navigation/native";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Copy,
  FileQuestion,
  Repeat,
} from "lucide-react-native";
import type * as React from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, ScrollView, StyleSheet, Text, View } from "react-native";
import Button from "../components/Button";
import CopyableField from "../components/CopyableField";
import SecretField from "../components/SecretField";
import { useToast } from "../components/ToastProvider";
import { useAssetMetadata } from "../hooks/useAssetMetadata";
import { useFormatSats } from "../hooks/useFormatSats";
import { useResolvedTheme } from "../hooks/useResolvedTheme";
import type { RootStackParamList } from "../navigation/RootStack";
import {
  buildActivityDetailSections,
  resolveExplorerUrl,
  type Section,
  type SectionRow,
} from "../services/activity-details/buildSections";
import { buildSwapDebugSection } from "../services/activity-details/buildSwapDebugSection";
import { collectSwapMetadataExport } from "../services/activity-details/swapMetadataExport";
import { statusAmountColor, statusVisuals } from "../services/activity-status";
import {
  type ChainRefundReadiness,
  getBoltzSwapById,
  getChainRefundReadinessById,
} from "../services/arkade/lightning";
import type { Activity } from "../store/types";
import { useAppStore } from "../store/useAppStore";
import { type AppTheme, radius, spacing, typography } from "../theme/theme";

type Route = RouteProp<RootStackParamList, "ActivityDetails">;

function formatTimestamp(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function railLabel(rail: Activity["rail"]): string | null {
  if (!rail) return null;
  if (rail === "arkade") return "Arkade";
  if (rail === "bitcoin") return "Bitcoin";
  if (rail === "lightning") return "Lightning";
  return null;
}

function directionLabel(direction: Activity["direction"]): string | null {
  if (direction === "in") return "Received";
  if (direction === "out") return "Sent";
  if (direction === "self") return "Wallet event";
  return null;
}

function renderSectionRow(
  row: SectionRow,
  network: string | null | undefined,
  theme: AppTheme,
): React.ReactNode {
  if (row.kind === "copy") {
    return (
      <CopyableField
        key={row.label}
        label={row.label}
        value={row.value}
        mono={row.mono}
        multiline={row.multiline}
        explorerUrl={resolveExplorerUrl(row, network)}
      />
    );
  }
  if (row.kind === "secret") {
    return (
      <SecretField
        key={row.label}
        label={row.label}
        value={row.value}
        warning={row.warning}
      />
    );
  }
  return (
    <View key={row.label} style={styles.textRow}>
      <Text style={[styles.textRowLabel, { color: theme.colors.textSubtle }]}>
        {row.label}
      </Text>
      <Text style={[styles.textRowValue, { color: theme.colors.text }]}>
        {row.value}
      </Text>
    </View>
  );
}

function renderSection(
  section: Section,
  network: string | null | undefined,
  theme: AppTheme,
): React.ReactNode {
  const isWarning = section.tone === "warning";
  return (
    <View
      key={section.id}
      style={[
        styles.section,
        {
          backgroundColor: isWarning
            ? theme.colors.pendingSoft
            : theme.colors.card,
          borderColor: isWarning ? theme.colors.warning : theme.colors.border,
        },
      ]}
    >
      <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>
        {section.title}
      </Text>
      {section.rows.map((row) => renderSectionRow(row, network, theme))}
    </View>
  );
}

export default function ActivityDetailsScreen() {
  const theme = useResolvedTheme();
  const params = useRoute<Route>().params;
  const activityId = params.activityId;
  const activity = useAppStore((s) =>
    s.wallet?.activities.find((a) => a.id === activityId),
  );
  const network = useAppStore(
    (s) => s.network.detectedNetwork ?? s.wallet?.network ?? null,
  );
  const runRecoveryAction = useAppStore((s) => s.runRecoveryAction);
  const recoveringIds = useAppStore((s) => s.recoveringIds);
  const rowErrors = useAppStore((s) => s.rowErrors);
  const { showToast } = useToast();
  const [copyingMetadata, setCopyingMetadata] = useState(false);
  const { format: formatSats, label: unitLabel } = useFormatSats();
  const assetIds = useMemo(
    () =>
      activity?.assets && activity.assets.length > 0
        ? activity.assets.map((a) => a.assetId)
        : typeof activity?.metadata?.assetId === "string"
          ? [activity.metadata.assetId]
          : [],
    [activity],
  );
  const { assetMetadata } = useAssetMetadata(network, assetIds, {
    hydrateMissing: true,
  });
  const sections = useMemo(
    () =>
      activity
        ? buildActivityDetailSections(activity, { network, assetMetadata })
        : [],
    [activity, network, assetMetadata],
  );

  // Live Boltz swap fetch, backing the "Swap debug" section below. Reads
  // through the same `getBoltzSwapById` lookup the "Copy metadata" export
  // uses — it carries secret material (preimage, chain-swap ephemeral key),
  // so it's fetched on demand rather than projected into persisted
  // `Activity.metadata`.
  const boltzSwapId =
    activity?.source.type === "boltz_swap" ? activity.source.swapId : null;
  const [liveSwap, setLiveSwap] = useState<BoltzSwap | null>(null);

  useEffect(() => {
    if (!boltzSwapId) {
      setLiveSwap(null);
      return;
    }
    let cancelled = false;
    getBoltzSwapById(boltzSwapId)
      .then((swap) => {
        if (!cancelled) setLiveSwap(swap);
      })
      .catch(() => {
        if (!cancelled) setLiveSwap(null);
      });
    return () => {
      cancelled = true;
    };
  }, [boltzSwapId]);

  const debugSection = useMemo(
    () => (activity ? buildSwapDebugSection(activity, liveSwap) : null),
    [activity, liveSwap],
  );

  // Chain-swap refund derivations — computed unconditionally so the
  // `useCallback` below stays above the `!activity` early return and obeys
  // rules-of-hooks.
  const chainSwapId =
    activity?.source.type === "boltz_swap" ? activity.source.swapId : null;
  const activitySaysChainRefundAvailable =
    activity?.source.type === "boltz_swap" &&
    activity.source.swapType === "chain" &&
    activity.metadata?.refundAvailable === true;
  // Mirror the row id format used by `recovery.ts` so the refund button on
  // this screen and the row in ProfileRecovery share spinner / error state.
  const recoveryRowId = chainSwapId ? `chain:${chainSwapId}` : null;
  const [chainRefundReadiness, setChainRefundReadiness] = useState<
    ChainRefundReadiness | "checking" | null
  >(null);
  const activityTitle = activity?.title ?? "";
  const activityTimestamp = activity?.timestamp ?? 0;

  useEffect(() => {
    if (!activitySaysChainRefundAvailable || !chainSwapId) {
      setChainRefundReadiness(null);
      return;
    }
    let cancelled = false;
    setChainRefundReadiness("checking");
    getChainRefundReadinessById(chainSwapId)
      .then((readiness) => {
        if (!cancelled) setChainRefundReadiness(readiness);
      })
      .catch(() => {
        if (!cancelled) setChainRefundReadiness("unknown");
      });
    return () => {
      cancelled = true;
    };
  }, [activitySaysChainRefundAvailable, chainSwapId]);

  const performRefund = useCallback(async () => {
    if (!chainSwapId || !recoveryRowId || chainRefundReadiness !== "ready") {
      return;
    }
    const result = await runRecoveryAction("refund_chain_ark", recoveryRowId, {
      id: recoveryRowId,
      swapId: chainSwapId,
      type: "chain",
      title: activityTitle,
      status: "refundable",
      severity: "actionable",
      createdAt: activityTimestamp,
      linkState: "linked",
      actions: ["refund_chain_ark"],
      detail: chainSwapId,
    });
    const stillActionable = result.items.some(
      (i) => i.id === recoveryRowId && i.severity === "actionable",
    );
    if (!stillActionable && !rowErrors[recoveryRowId]) {
      showToast("Refund submitted", "success");
    }
  }, [
    chainSwapId,
    recoveryRowId,
    runRecoveryAction,
    activityTitle,
    activityTimestamp,
    rowErrors,
    showToast,
    chainRefundReadiness,
  ]);

  if (!activity) {
    return (
      <View
        style={[styles.notFound, { backgroundColor: theme.colors.background }]}
      >
        <FileQuestion color={theme.colors.textSubtle} size={56} />
        <Text style={[styles.notFoundTitle, { color: theme.colors.text }]}>
          Activity not found
        </Text>
        <Text style={[styles.notFoundBody, { color: theme.colors.textMuted }]}>
          This activity is no longer available. It may have been replaced after
          a refresh, or the wallet was reset.
        </Text>
      </View>
    );
  }

  const isIn = activity.direction === "in";
  const isSelf = activity.direction === "self";
  const Icon = isSelf ? Repeat : isIn ? ArrowDownLeft : ArrowUpRight;
  const iconColor = isSelf
    ? theme.colors.textSubtle
    : isIn
      ? theme.colors.success
      : theme.colors.danger;
  const iconBg = `${iconColor}20`;
  const sign = isSelf || activity.amountSats == null ? "" : isIn ? "+" : "-";
  const amountColor = statusAmountColor(
    activity.status,
    activity.direction,
    theme,
  );
  const visuals = statusVisuals(activity.status, theme);
  const dirLabel = directionLabel(activity.direction);
  const rail = railLabel(activity.rail);

  const isBoltzSwap = activity.source.type === "boltz_swap";
  const refundableChainSwap =
    activitySaysChainRefundAvailable && chainRefundReadiness === "ready";
  const chainRefundUnavailable =
    activitySaysChainRefundAvailable &&
    chainRefundReadiness != null &&
    chainRefundReadiness !== "checking" &&
    chainRefundReadiness !== "ready";
  const refunding = recoveryRowId != null && recoveringIds.has(recoveryRowId);
  const refundError =
    recoveryRowId != null ? rowErrors[recoveryRowId] : undefined;
  async function handleCopyMetadata() {
    // Re-narrow inside this hoisted closure — the `!activity` early return
    // above does not flow into it.
    if (!activity) return;
    setCopyingMetadata(true);
    try {
      const data = await collectSwapMetadataExport(activity);
      if (!data) {
        showToast("No swap metadata to copy", "error");
        return;
      }
      await Clipboard.setStringAsync(JSON.stringify(data, null, 2));
      Haptics.selectionAsync().catch(() => {});
      showToast("Swap metadata copied", "success");
    } catch {
      showToast("Could not copy metadata", "error");
    } finally {
      setCopyingMetadata(false);
    }
  }
  function handleRefund() {
    if (!chainSwapId) return;
    Alert.alert(
      "Refund Arkade lockup",
      `Refund the Arkade lockup for swap ${chainSwapId}? The locked offchain amount will return to this wallet.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Refund Arkade lockup",
          style: "default",
          onPress: () => {
            void performRefund();
          },
        },
      ],
    );
  }

  return (
    <ScrollView
      style={{ backgroundColor: theme.colors.background }}
      contentContainerStyle={styles.content}
    >
      <View
        style={[
          styles.summary,
          {
            backgroundColor: theme.colors.card,
            borderColor: theme.colors.border,
          },
        ]}
      >
        <View style={[styles.icon, { backgroundColor: iconBg }]}>
          <Icon color={iconColor} size={28} />
        </View>
        <Text style={[styles.title, { color: theme.colors.text }]}>
          {activity.title}
        </Text>
        {activity.amountSats != null ? (
          <Text style={[styles.amount, { color: amountColor }]}>
            {sign}
            {formatSats(activity.amountSats)} {unitLabel}
          </Text>
        ) : null}
        <Text style={[styles.timestamp, { color: theme.colors.textSubtle }]}>
          {formatTimestamp(activity.timestamp)}
        </Text>
        <View style={styles.tags}>
          <View style={[styles.tag, { backgroundColor: visuals.bg }]}>
            <Text style={[styles.tagText, { color: visuals.fg }]}>
              {visuals.label}
            </Text>
          </View>
          {rail ? (
            <View
              style={[
                styles.tag,
                { backgroundColor: theme.colors.surfaceSubtle },
              ]}
            >
              <Text style={[styles.tagText, { color: theme.colors.textMuted }]}>
                {rail}
              </Text>
            </View>
          ) : null}
          {dirLabel ? (
            <View
              style={[
                styles.tag,
                { backgroundColor: theme.colors.surfaceSubtle },
              ]}
            >
              <Text style={[styles.tagText, { color: theme.colors.textMuted }]}>
                {dirLabel}
              </Text>
            </View>
          ) : null}
        </View>
      </View>

      {sections.map((section) => renderSection(section, network, theme))}
      {debugSection ? renderSection(debugSection, network, theme) : null}

      {refundableChainSwap ? (
        <View style={styles.refundCard}>
          <Text style={[styles.refundBody, { color: theme.colors.textMuted }]}>
            This chain swap can be refunded — Boltz did not claim before its
            timeout. Tap below to recover the locked offchain amount.
          </Text>
          <Button
            label={refunding ? "Refunding…" : "Refund offchain amount"}
            theme={theme}
            loading={refunding}
            disabled={refunding}
            onPress={handleRefund}
          />
          {refundError ? (
            <Text style={[styles.refundError, { color: theme.colors.danger }]}>
              {refundError.type === "deferred_locktime"
                ? "Refund locktime not reached yet — try again later."
                : refundError.message}
            </Text>
          ) : null}
        </View>
      ) : null}

      {chainRefundUnavailable ? (
        <View style={styles.refundCard}>
          <Text style={[styles.refundBody, { color: theme.colors.textMuted }]}>
            {chainRefundReadiness === "missing_material"
              ? "This swap expired, but this device is missing the refund details needed to build the Arkade recovery transaction. Export a support bundle from Profile -> Recovery."
              : chainRefundReadiness === "not_found"
                ? "This swap is no longer in the local swap repository. Export a support bundle from Profile -> Recovery."
                : chainRefundReadiness === "endpoint_not_found"
                  ? "This swap is not known by the configured Boltz endpoints. Export a support bundle from Profile -> Recovery."
                  : chainRefundReadiness === "unknown"
                    ? "This swap expired, but refund readiness could not be verified. Export a support bundle from Profile -> Recovery."
                    : "This swap expired, but this device cannot find a refundable Arkade VHTLC for it. Export a support bundle from Profile -> Recovery."}
          </Text>
        </View>
      ) : null}

      {isBoltzSwap ? (
        <View style={styles.copyMetaCard}>
          <Button
            label="Copy metadata"
            theme={theme}
            variant="secondary"
            loading={copyingMetadata}
            disabled={copyingMetadata}
            icon={<Copy color={theme.colors.text} size={18} />}
            accessibilityLabel="Copy swap metadata as JSON"
            onPress={() => {
              void handleCopyMetadata();
            }}
          />
          <Text
            style={[styles.copyMetaHint, { color: theme.colors.textSubtle }]}
          >
            Copies all data for this swap as JSON, including secrets like the
            preimage. Share only with people you trust.
          </Text>
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: spacing[5],
    paddingBottom: 120,
  },
  refundCard: {
    marginTop: spacing[4],
    gap: spacing[3],
  },
  refundBody: {
    fontSize: typography.size.sm,
    lineHeight: typography.size.sm * 1.4,
  },
  refundError: {
    fontSize: typography.size.xs,
    lineHeight: typography.size.xs * 1.4,
  },
  copyMetaCard: {
    marginTop: spacing[4],
    gap: spacing[2],
  },
  copyMetaHint: {
    fontSize: typography.size.xs,
    lineHeight: typography.size.xs * 1.4,
    textAlign: "center",
  },
  summary: {
    padding: spacing[6],
    borderRadius: radius.lg,
    borderWidth: 1,
    alignItems: "center",
  },
  icon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing[3],
  },
  title: {
    fontSize: typography.size.lg,
    fontWeight: typography.weight.semibold,
  },
  amount: {
    fontSize: 28,
    fontWeight: typography.weight.bold,
    fontVariant: ["tabular-nums"],
    marginTop: spacing[2],
  },
  timestamp: {
    fontSize: typography.size.sm,
    marginTop: spacing[2],
  },
  tags: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing[2],
    marginTop: spacing[4],
    justifyContent: "center",
  },
  tag: {
    paddingVertical: spacing[1],
    paddingHorizontal: spacing[3],
    borderRadius: radius.pill,
  },
  tagText: {
    fontSize: typography.size.xs,
    fontWeight: typography.weight.medium,
  },
  notFound: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: spacing[6],
  },
  notFoundTitle: {
    fontSize: typography.size.lg,
    fontWeight: typography.weight.semibold,
    marginTop: spacing[4],
  },
  notFoundBody: {
    fontSize: typography.size.sm,
    marginTop: spacing[2],
    textAlign: "center",
  },
  section: {
    marginTop: spacing[4],
    padding: spacing[4],
    borderRadius: radius.md,
    borderWidth: 1,
  },
  sectionTitle: {
    fontSize: typography.size.md,
    fontWeight: typography.weight.semibold,
    marginBottom: spacing[2],
  },
  textRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    paddingVertical: spacing[2],
    gap: spacing[3],
  },
  textRowLabel: {
    fontSize: typography.size.xs,
    fontWeight: typography.weight.medium,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    flexShrink: 0,
  },
  textRowValue: {
    fontSize: typography.size.sm,
    flex: 1,
    textAlign: "right",
  },
});
