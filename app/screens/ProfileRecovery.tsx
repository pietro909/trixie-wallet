import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import {
  AlertTriangle,
  Bug,
  CheckCircle2,
  CircleHelp,
  Hourglass,
  RefreshCw,
} from "lucide-react-native";
import * as React from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Button from "../components/Button";
import { useToast } from "../components/ToastProvider";
import { useFormatSats } from "../hooks/useFormatSats";
import { useResolvedTheme } from "../hooks/useResolvedTheme";
import type {
  RecoveryActionKind,
  RecoveryItem,
  RecoveryItemType,
  RecoveryScan,
  RecoverySeverity,
} from "../services/arkade/recovery";
import { buildSupportBundle } from "../services/diagnostics/bundle";
import {
  deleteBundleTempFile,
  saveBundleFile,
  shareBundleFile,
  writeBundleToTemp,
} from "../services/diagnostics/storage";
import { type RecoveryRowError, useAppStore } from "../store/useAppStore";
import { type AppTheme, radius, spacing, typography } from "../theme/theme";

const CARD_ORDER: RecoveryItemType[] = [
  "pending_finalize",
  "submarine",
  "chain",
  "reverse",
  "arkade_settlement",
];

const CARD_TITLES: Record<RecoveryItemType, string> = {
  pending_finalize: "Unfinalized transactions",
  submarine: "Submarine VHTLC recovery",
  chain: "Chain swap refunds",
  reverse: "Reverse claim",
  arkade_settlement: "Arkade settlement anomalies",
};

const ACTION_LABELS: Record<RecoveryActionKind, string> = {
  refresh_status: "Refresh status",
  claim_reverse_vhtlc: "Refresh status",
  recover_submarine_vhtlc: "Recover VHTLC",
  refund_chain_ark: "Refund Arkade lockup",
  finalize_pending_tx: "Finalize transaction",
  support_bundle: "Export support bundle",
};

const SEVERITY_COLORS: Record<RecoverySeverity, (theme: AppTheme) => string> = {
  actionable: (t) => t.colors.primary,
  attention: (t) => t.colors.warning,
  info: (t) => t.colors.textSubtle,
};

function formatTimestamp(ts: number): string {
  return new Date(ts).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function bundleBasename(): string {
  const stamp = new Date()
    .toISOString()
    .replace(/[:.]/g, "-")
    .replace(/-?Z$/, "");
  return `trixie-recovery-${stamp}`;
}

function formatRemaining(seconds: number): string {
  if (seconds <= 0) return "Ready now; scan again";
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  if (days > 0) return `${days}d ${hours}h remaining`;
  if (hours > 0) return `${hours}h ${minutes}m remaining`;
  if (minutes > 0) return `${minutes}m ${secs}s remaining`;
  return `${secs}s remaining`;
}

function rowErrorText(
  err: RecoveryRowError,
  remainingSeconds: number | null,
): string {
  if (err.type === "deferred_locktime") {
    if (remainingSeconds == null) {
      return "Refund locktime not reached yet — try again later.";
    }
    return `Refund locktime not reached yet — ${formatRemaining(remainingSeconds)}.`;
  }
  return err.message;
}

function severityIcon(severity: RecoverySeverity, color: string) {
  if (severity === "actionable")
    return <CheckCircle2 color={color} size={16} />;
  if (severity === "attention")
    return <AlertTriangle color={color} size={16} />;
  return <CircleHelp color={color} size={16} />;
}

export default function ProfileRecovery() {
  const theme = useResolvedTheme();
  const { showToast } = useToast();
  const { format: formatSats, label: unitLabel } = useFormatSats();
  const scanRecoveryState = useAppStore((s) => s.scanRecoveryState);
  const runRecoveryAction = useAppStore((s) => s.runRecoveryAction);
  const clearRowError = useAppStore((s) => s.clearRecoveryRowError);
  const recoveringIds = useAppStore((s) => s.recoveringIds);
  const rowErrors = useAppStore((s) => s.rowErrors);

  const [scan, setScan] = React.useState<RecoveryScan | null>(null);
  const [scanning, setScanning] = React.useState(false);
  const [bundleBusy, setBundleBusy] = React.useState(false);
  const [now, setNow] = React.useState(() => Math.floor(Date.now() / 1000));

  const anyRowInFlight = recoveringIds.size > 0;

  const refresh = React.useCallback(async () => {
    setScanning(true);
    try {
      const result = await scanRecoveryState();
      setScan(result);
    } catch (e) {
      showToast(
        e instanceof Error ? e.message : "Recovery scan failed",
        "error",
      );
    } finally {
      setScanning(false);
    }
  }, [scanRecoveryState, showToast]);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  // Tick wall-clock every second so submarine `pre_cltv` countdowns update.
  // Cheap; no network calls.
  React.useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, []);

  const presentBundleActions = React.useCallback(() => {
    Alert.alert(
      "Support bundle",
      "Bundles a redacted snapshot of wallet, server, and recent error events. Safe to share with support.",
      [
        {
          text: "Save to device",
          onPress: () => {
            void (async () => {
              setBundleBusy(true);
              try {
                const bundle = await buildSupportBundle();
                const written = writeBundleToTemp({
                  bundle,
                  basename: bundleBasename(),
                });
                try {
                  const result = await saveBundleFile({
                    sourceUri: written.uri,
                    filename: written.filename,
                  });
                  if (result.kind === "saved") {
                    Haptics.notificationAsync(
                      Haptics.NotificationFeedbackType.Success,
                    );
                    showToast("Support bundle saved", "success");
                  }
                } finally {
                  deleteBundleTempFile(written.uri);
                }
              } catch (e) {
                showToast(
                  e instanceof Error ? e.message : "Could not save bundle",
                  "error",
                );
              } finally {
                setBundleBusy(false);
              }
            })();
          },
        },
        {
          text: "Share…",
          onPress: () => {
            void (async () => {
              setBundleBusy(true);
              try {
                const bundle = await buildSupportBundle();
                const written = writeBundleToTemp({
                  bundle,
                  basename: bundleBasename(),
                });
                try {
                  await shareBundleFile(written.uri);
                } finally {
                  deleteBundleTempFile(written.uri);
                }
              } catch (e) {
                showToast(
                  e instanceof Error ? e.message : "Could not share bundle",
                  "error",
                );
              } finally {
                setBundleBusy(false);
              }
            })();
          },
        },
        {
          text: "Copy as JSON",
          onPress: () => {
            void (async () => {
              setBundleBusy(true);
              try {
                const bundle = await buildSupportBundle();
                await Clipboard.setStringAsync(JSON.stringify(bundle, null, 2));
                Haptics.notificationAsync(
                  Haptics.NotificationFeedbackType.Success,
                );
                showToast("Support bundle copied", "success");
              } catch (e) {
                showToast(
                  e instanceof Error ? e.message : "Could not copy bundle",
                  "error",
                );
              } finally {
                setBundleBusy(false);
              }
            })();
          },
        },
        { text: "Cancel", style: "cancel" },
      ],
    );
  }, [showToast]);

  const handleAction = React.useCallback(
    async (action: RecoveryActionKind, item: RecoveryItem) => {
      if (action === "support_bundle") {
        presentBundleActions();
        return;
      }
      const result = await runRecoveryAction(action, item.id, item);
      setScan(result);
    },
    [runRecoveryAction, presentBundleActions],
  );

  const confirmAction = React.useCallback(
    (action: RecoveryActionKind, item: RecoveryItem) => {
      if (action === "refresh_status" || action === "support_bundle") {
        void handleAction(action, item);
        return;
      }
      const ref = item.swapId ?? item.arkTxid ?? item.id.replace(/^[^:]+:/, "");
      const messages: Partial<Record<RecoveryActionKind, string>> = {
        recover_submarine_vhtlc: `Recover VHTLC for swap ${ref}? Funds will be swept back to your wallet.`,
        refund_chain_ark: `Refund the Arkade lockup for swap ${ref}? The locked offchain amount will return to this wallet.`,
        finalize_pending_tx: `Finalize Arkade transaction ${ref}? The server will mark it complete.`,
      };
      const msg = messages[action] ?? `Run ${ACTION_LABELS[action]}?`;
      Alert.alert(ACTION_LABELS[action], msg, [
        { text: "Cancel", style: "cancel" },
        {
          text: ACTION_LABELS[action],
          style: "default",
          onPress: () => void handleAction(action, item),
        },
      ]);
    },
    [handleAction],
  );

  const grouped = React.useMemo(() => {
    const map: Record<RecoveryItemType, RecoveryItem[]> = {
      pending_finalize: [],
      submarine: [],
      chain: [],
      reverse: [],
      arkade_settlement: [],
    };
    for (const item of scan?.items ?? []) {
      map[item.type].push(item);
    }
    return map;
  }, [scan]);

  const totals = React.useMemo(() => {
    let actionable = 0;
    let attention = 0;
    let info = 0;
    for (const item of scan?.items ?? []) {
      if (item.severity === "actionable") actionable += 1;
      else if (item.severity === "attention") attention += 1;
      else info += 1;
    }
    return { actionable, attention, info };
  }, [scan]);

  const renderRow = (item: RecoveryItem) => {
    const inFlight = recoveringIds.has(item.id);
    const err = rowErrors[item.id];
    const primaryAction = item.actions[0];
    const secondaryAction = item.actions.find((a) => a !== primaryAction);
    const severityColor = SEVERITY_COLORS[item.severity](theme);
    const remaining =
      item.refundLocktime != null ? item.refundLocktime - now : null;
    return (
      <View
        key={item.id}
        style={[
          styles.row,
          {
            borderColor: theme.colors.border,
            backgroundColor: theme.colors.surfaceSubtle,
          },
        ]}
      >
        <View style={styles.rowHeader}>
          <View style={styles.rowSeverity}>
            {severityIcon(item.severity, severityColor)}
            <Text style={[styles.rowTitle, { color: theme.colors.text }]}>
              {item.title}
            </Text>
          </View>
          {item.amountSats != null ? (
            <Text style={[styles.rowAmount, { color: theme.colors.text }]}>
              {formatSats(item.amountSats)} {unitLabel}
            </Text>
          ) : null}
        </View>
        <Text style={[styles.rowDetail, { color: theme.colors.textSubtle }]}>
          {item.detail}
        </Text>
        <Text style={[styles.rowMeta, { color: theme.colors.textSubtle }]}>
          {formatTimestamp(item.createdAt)} · status {item.status}
          {item.linkState !== "not_applicable" ? ` · ${item.linkState}` : ""}
        </Text>
        {item.type === "submarine" &&
        item.status === "pre_cltv" &&
        remaining != null ? (
          <View style={styles.timerRow}>
            <Hourglass color={theme.colors.warning} size={14} />
            <Text style={[styles.rowMeta, { color: theme.colors.warning }]}>
              {formatRemaining(remaining)}
            </Text>
          </View>
        ) : null}
        {err ? (
          <Text
            onPress={() => clearRowError(item.id)}
            style={[styles.rowError, { color: theme.colors.danger }]}
          >
            {rowErrorText(err, remaining)} (tap to dismiss)
          </Text>
        ) : null}
        <View style={styles.rowActions}>
          {primaryAction ? (
            <Button
              label={inFlight ? "Working…" : ACTION_LABELS[primaryAction]}
              theme={theme}
              loading={inFlight}
              disabled={inFlight}
              onPress={() => confirmAction(primaryAction, item)}
              variant={item.severity === "actionable" ? "primary" : "secondary"}
              style={styles.rowActionPrimary}
            />
          ) : null}
          {secondaryAction ? (
            <Pressable
              onPress={() => confirmAction(secondaryAction, item)}
              disabled={inFlight}
              hitSlop={6}
              style={({ pressed }) => [
                styles.rowSecondary,
                pressed && { opacity: 0.6 },
              ]}
            >
              <Text
                style={[
                  styles.rowSecondaryText,
                  { color: theme.colors.primary },
                ]}
              >
                {ACTION_LABELS[secondaryAction]}
              </Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    );
  };

  const renderCard = (type: RecoveryItemType) => {
    const items = grouped[type];
    if (items.length === 0) return null;
    return (
      <View
        key={type}
        style={[
          styles.card,
          {
            backgroundColor: theme.colors.card,
            borderColor: theme.colors.border,
          },
        ]}
      >
        <Text style={[styles.cardTitle, { color: theme.colors.text }]}>
          {CARD_TITLES[type]}
        </Text>
        {items.map(renderRow)}
      </View>
    );
  };

  const fresh = scan != null;
  const nothingToShow = fresh && (scan?.items.length ?? 0) === 0;

  return (
    <ScrollView
      style={{ backgroundColor: theme.colors.background }}
      contentContainerStyle={styles.content}
    >
      <View style={styles.header}>
        <Text style={[styles.heading, { color: theme.colors.text }]}>
          Recovery
        </Text>
        <Text style={[styles.subheading, { color: theme.colors.textMuted }]}>
          Inspect dangling swap state and unfinalized transactions, and act on
          them one item at a time.
        </Text>
      </View>

      {scan?.reason ? (
        <View
          style={[
            styles.banner,
            { backgroundColor: `${theme.colors.warning}25` },
          ]}
        >
          <AlertTriangle color={theme.colors.warning} size={18} />
          <Text style={[styles.bannerText, { color: theme.colors.text }]}>
            {scan.reason}
          </Text>
        </View>
      ) : null}

      <View style={styles.scanRow}>
        <Button
          label={scanning ? "Scanning…" : "Scan now"}
          theme={theme}
          loading={scanning}
          disabled={scanning || anyRowInFlight}
          onPress={() => void refresh()}
          icon={<RefreshCw color={theme.colors.surface} size={16} />}
          style={styles.scanButton}
        />
        {fresh ? (
          <View style={styles.summary}>
            <Text style={[styles.summaryLine, { color: theme.colors.text }]}>
              {totals.actionable} actionable · {totals.attention} waiting ·{" "}
              {totals.info} pending
            </Text>
            <Text
              style={[styles.summaryLine, { color: theme.colors.textSubtle }]}
            >
              Last scan {formatTimestamp(scan.scannedAt)}
            </Text>
          </View>
        ) : null}
      </View>

      {scan?.manager ? (
        <Text style={[styles.managerLine, { color: theme.colors.textSubtle }]}>
          Swap manager: {scan.manager.isRunning ? "running" : "stopped"} ·
          monitoring {scan.manager.monitoredSwaps} ·
          {scan.manager.websocketConnected ? " ws on" : " ws off"}
          {scan.manager.usePollingFallback ? " · polling" : ""}
        </Text>
      ) : null}

      {nothingToShow ? (
        <View
          style={[
            styles.card,
            {
              backgroundColor: theme.colors.card,
              borderColor: theme.colors.border,
            },
          ]}
        >
          <View style={styles.empty}>
            <CheckCircle2 color={theme.colors.success} size={28} />
            <Text style={[styles.emptyTitle, { color: theme.colors.text }]}>
              Nothing to recover
            </Text>
            <Text style={[styles.emptyBody, { color: theme.colors.textMuted }]}>
              No claimable, refundable, or unfinalized state was found in this
              wallet.
            </Text>
            <Pressable
              onPress={presentBundleActions}
              hitSlop={6}
              disabled={bundleBusy}
            >
              <Text style={[styles.linkText, { color: theme.colors.primary }]}>
                {bundleBusy ? "Preparing bundle…" : "Export support bundle"}
              </Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      {CARD_ORDER.map(renderCard)}

      <Pressable
        onPress={presentBundleActions}
        hitSlop={6}
        disabled={bundleBusy}
        style={styles.bundleFooter}
      >
        <Bug color={theme.colors.textSubtle} size={14} />
        <Text style={[styles.linkText, { color: theme.colors.textSubtle }]}>
          {bundleBusy ? "Preparing bundle…" : "Export support bundle"}
        </Text>
      </Pressable>

      {scanning && !fresh ? (
        <ActivityIndicator color={theme.colors.primary} />
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: spacing[5],
    paddingBottom: 120,
    gap: spacing[4],
  },
  header: {
    gap: spacing[2],
  },
  heading: {
    fontSize: typography.size.xl,
    fontWeight: typography.weight.bold,
  },
  subheading: {
    fontSize: typography.size.sm,
    lineHeight: typography.lineHeight.sm,
  },
  banner: {
    flexDirection: "row",
    gap: spacing[2],
    padding: spacing[3],
    borderRadius: radius.sm,
    alignItems: "flex-start",
  },
  bannerText: {
    flex: 1,
    fontSize: typography.size.xs,
    lineHeight: typography.lineHeight.xs,
  },
  scanRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
  },
  scanButton: {
    flexShrink: 0,
  },
  summary: {
    flex: 1,
    gap: 2,
  },
  summaryLine: {
    fontSize: typography.size.xs,
  },
  managerLine: {
    fontSize: typography.size.xs,
  },
  card: {
    padding: spacing[4],
    borderRadius: radius.md,
    borderWidth: 1,
    gap: spacing[3],
  },
  cardTitle: {
    fontSize: typography.size.md,
    fontWeight: typography.weight.semibold,
  },
  row: {
    padding: spacing[3],
    borderRadius: radius.sm,
    borderWidth: 1,
    gap: spacing[2],
  },
  rowHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing[2],
  },
  rowSeverity: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    flexShrink: 1,
  },
  rowTitle: {
    fontSize: typography.size.sm,
    fontWeight: typography.weight.semibold,
    flexShrink: 1,
  },
  rowAmount: {
    fontSize: typography.size.sm,
    fontWeight: typography.weight.semibold,
    fontVariant: ["tabular-nums"],
  },
  rowDetail: {
    fontSize: typography.size.xs,
    fontFamily: typography.fontFamily.mono,
  },
  rowMeta: {
    fontSize: typography.size.xs,
  },
  timerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
  },
  rowError: {
    fontSize: typography.size.xs,
    lineHeight: typography.lineHeight.xs,
  },
  rowActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    marginTop: spacing[1],
  },
  rowActionPrimary: {
    flex: 1,
  },
  rowSecondary: {
    paddingVertical: spacing[2],
    paddingHorizontal: spacing[2],
  },
  rowSecondaryText: {
    fontSize: typography.size.xs,
    fontWeight: typography.weight.semibold,
  },
  empty: {
    alignItems: "center",
    gap: spacing[2],
  },
  emptyTitle: {
    fontSize: typography.size.md,
    fontWeight: typography.weight.semibold,
  },
  emptyBody: {
    fontSize: typography.size.sm,
    textAlign: "center",
  },
  linkText: {
    fontSize: typography.size.sm,
    fontWeight: typography.weight.semibold,
  },
  bundleFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing[2],
    paddingVertical: spacing[3],
  },
});
