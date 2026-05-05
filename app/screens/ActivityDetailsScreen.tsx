import { type RouteProp, useRoute } from "@react-navigation/native";
import {
  ArrowDownLeft,
  ArrowUpRight,
  FileQuestion,
  Repeat,
} from "lucide-react-native";
import type * as React from "react";
import { Alert, ScrollView, StyleSheet, Text, View } from "react-native";
import Button from "../components/Button";
import CopyableField from "../components/CopyableField";
import { useToast } from "../components/ToastProvider";
import { useFormatSats } from "../hooks/useFormatSats";
import { useResolvedTheme } from "../hooks/useResolvedTheme";
import type { RootStackParamList } from "../navigation/RootStack";
import {
  buildActivityDetailSections,
  resolveExplorerUrl,
  type Section,
  type SectionRow,
} from "../services/activity-details/buildSections";
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

function statusLabel(status: Activity["status"]): string {
  switch (status) {
    case "pending":
      return "Pending";
    case "confirmed":
      return "Confirmed";
    case "failed":
      return "Failed";
    case "refunded":
      return "Refunded";
    case "info":
      return "Info";
  }
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
  return (
    <View
      key={section.id}
      style={[
        styles.section,
        {
          backgroundColor: theme.colors.card,
          borderColor: theme.colors.border,
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
  const { format: formatSats, label: unitLabel } = useFormatSats();

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
  const amountColor = isSelf
    ? theme.colors.text
    : isIn
      ? theme.colors.success
      : theme.colors.text;
  const dirLabel = directionLabel(activity.direction);
  const rail = railLabel(activity.rail);
  const sections = buildActivityDetailSections(activity, { network });

  const refundableChainSwap =
    activity.source.type === "boltz_swap" &&
    activity.source.swapType === "chain" &&
    activity.metadata?.refundAvailable === true;
  const chainSwapId =
    activity.source.type === "boltz_swap" ? activity.source.swapId : null;
  // Mirror the row id format used by `recovery.ts` so the refund button on
  // this screen and the row in ProfileRecovery share spinner / error state.
  const recoveryRowId = chainSwapId ? `chain:${chainSwapId}` : null;
  const refunding = recoveryRowId != null && recoveringIds.has(recoveryRowId);
  const refundError =
    recoveryRowId != null ? rowErrors[recoveryRowId] : undefined;

  const activityTitle = activity.title;
  const activityTimestamp = activity.timestamp;
  async function performRefund() {
    if (!chainSwapId || !recoveryRowId) return;
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
          <View
            style={[
              styles.tag,
              { backgroundColor: theme.colors.surfaceSubtle },
            ]}
          >
            <Text style={[styles.tagText, { color: theme.colors.textMuted }]}>
              {statusLabel(activity.status)}
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
