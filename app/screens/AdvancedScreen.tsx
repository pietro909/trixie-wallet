import { ESPLORA_URL } from "@arkade-os/sdk";
import * as Clipboard from "expo-clipboard";
import Constants from "expo-constants";
import * as Haptics from "expo-haptics";
import {
  Braces,
  ChevronDown,
  ChevronUp,
  Compass,
  Copy,
  Database,
  Server,
  Share2,
  SlidersHorizontal,
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
import AuthGate from "../components/AuthGate";
import { useToast } from "../components/ToastProvider";
import { useBackgroundTaskMetrics } from "../hooks/useBackgroundTaskMetrics";
import { useFormatSats } from "../hooks/useFormatSats";
import { useResolvedTheme } from "../hooks/useResolvedTheme";
import {
  boltzApiUrlForNetwork,
  boltzLegacyApiUrlsForNetwork,
  getLightningFees,
  getLightningLimits,
  isLightningSupportedForNetwork,
} from "../services/arkade/lightning";
import { defaultDelegatorUrlForNetwork } from "../services/arkade/network";
import { SWAP_BACKGROUND_TASK_NAME } from "../services/arkade/swap-background";
import type { BgTaskMetrics } from "../services/diagnostics/bg-task-metrics";
import {
  BUNDLE_STAGE_LABEL,
  type BundleStage,
  buildSupportBundle,
} from "../services/diagnostics/bundle";
import {
  deleteBundleTempFile,
  saveBundleFile,
  shareBundleFile,
  writeBundleToTemp,
} from "../services/diagnostics/storage";
import type { BackgroundTaskKey, WalletBehavior } from "../store/types";
import { useAppStore } from "../store/useAppStore";
import { type AppTheme, radius, spacing, typography } from "../theme/theme";

type IconType = React.ComponentType<{ color?: string; size?: number }>;

function readString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

const extra = (Constants.expoConfig?.extra ?? {}) as Record<string, unknown>;
const versions = (extra.versions ?? {}) as Record<string, unknown>;
const git = (extra.git ?? {}) as Record<string, unknown>;
const SDK_VERSION = readString(versions.sdk);
const BOLTZ_VERSION = readString(versions.boltzSwap);
const APP_COMMIT = readString(git.commit);
const APP_TAG = readString(git.tag);

function defaultEsploraUrl(network: string | null): string | null {
  if (!network) return null;
  return (ESPLORA_URL as Record<string, string>)[network.toLowerCase()] ?? null;
}

function formatExitDelay(seconds: number): string {
  if (!seconds || !Number.isFinite(seconds)) return "—";
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  if (days) return hours ? `${days}d ${hours}h` : `${days}d`;
  if (hours) {
    const mins = Math.floor((seconds % 3600) / 60);
    return mins ? `${hours}h ${mins}m` : `${hours}h`;
  }
  const mins = Math.floor(seconds / 60);
  return mins ? `${mins}m` : `${seconds}s`;
}

export default function AdvancedScreen() {
  const theme = useResolvedTheme();
  const { showToast } = useToast();
  const networkState = useAppStore((s) => s.network);
  const wallet = useAppStore((s) => s.wallet);
  const walletBehavior = useAppStore((s) => s.walletBehavior);
  const backgroundTasks = useAppStore((s) => s.backgroundTasks);
  const refreshServer = useAppStore((s) => s.refreshServer);
  const setWalletBehavior = useAppStore((s) => s.setWalletBehavior);
  const setBackgroundTaskEnabled = useAppStore(
    (s) => s.setBackgroundTaskEnabled,
  );
  const { format: formatSats, label: unitLabel } = useFormatSats();

  const [detailsOpen, setDetailsOpen] = React.useState(false);
  const [busyKey, setBusyKey] = React.useState<string | null>(null);
  const [bundleStage, setBundleStage] = React.useState<BundleStage | null>(
    null,
  );
  const [authVisible, setAuthVisible] = React.useState(false);
  const serverInfo = networkState.serverInfo;
  const detectedNetwork = networkState.detectedNetwork;
  const behaviorNetwork = detectedNetwork ?? wallet?.network ?? null;
  const delegateUrl = defaultDelegatorUrlForNetwork(behaviorNetwork);

  React.useEffect(() => {
    if (networkState.status === "idle") {
      refreshServer();
    }
  }, [networkState.status, refreshServer]);

  const handleCopy = React.useCallback(
    async (text: string, label: string) => {
      if (!text) return;
      try {
        await Clipboard.setStringAsync(text);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        showToast(`${label} copied`, "success");
      } catch {
        showToast("Could not copy", "error");
      }
    },
    [showToast],
  );

  function bundleBasename(): string {
    const stamp = new Date()
      .toISOString()
      .replace(/[:.]/g, "-")
      .replace(/-?Z$/, "");
    return `trixie-support-${stamp}`;
  }

  async function withBundle<T>(
    fn: (b: { uri: string; filename: string }) => Promise<T>,
  ): Promise<T> {
    const bundle = await buildSupportBundle(setBundleStage);
    const written = writeBundleToTemp({
      bundle,
      basename: bundleBasename(),
    });
    try {
      return await fn(written);
    } finally {
      deleteBundleTempFile(written.uri);
    }
  }

  async function shareSupportBundle() {
    setBusyKey("bundle");
    try {
      await withBundle(async (file) => {
        await shareBundleFile(file.uri);
      });
    } catch (e) {
      showToast(
        e instanceof Error ? e.message : "Could not share support bundle",
        "error",
      );
    } finally {
      setBusyKey(null);
      setBundleStage(null);
    }
  }

  async function saveSupportBundle() {
    setBusyKey("bundle");
    try {
      const result = await withBundle((file) =>
        saveBundleFile({ sourceUri: file.uri, filename: file.filename }),
      );
      if (result.kind === "saved") {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        showToast("Support bundle saved", "success");
      }
    } catch (e) {
      showToast(
        e instanceof Error ? e.message : "Could not save support bundle",
        "error",
      );
    } finally {
      setBusyKey(null);
      setBundleStage(null);
    }
  }

  async function copySupportBundle() {
    setBusyKey("bundle");
    try {
      const bundle = await buildSupportBundle(setBundleStage);
      await Clipboard.setStringAsync(JSON.stringify(bundle, null, 2));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      showToast("Support bundle copied", "success");
    } catch (e) {
      showToast(
        e instanceof Error ? e.message : "Could not copy support bundle",
        "error",
      );
    } finally {
      setBusyKey(null);
      setBundleStage(null);
    }
  }

  function presentBundleActions() {
    setAuthVisible(true);
  }

  function handleAuthorizedBundle() {
    setAuthVisible(false);
    Alert.alert(
      "Support bundle",
      "Bundles a redacted snapshot of wallet, server, and recent error events. Safe to share with support.",
      [
        { text: "Save to device", onPress: () => void saveSupportBundle() },
        { text: "Share…", onPress: () => void shareSupportBundle() },
        { text: "Copy as JSON", onPress: () => void copySupportBundle() },
        { text: "Cancel", style: "cancel" },
      ],
    );
  }

  const applyWalletBehavior = React.useCallback(
    async (next: WalletBehavior) => {
      try {
        await setWalletBehavior(next);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        showToast(
          "Wallet behaviour saved. Restart the app to apply it fully.",
          "success",
        );
      } catch (e) {
        showToast(
          e instanceof Error ? e.message : "Could not update wallet behaviour",
          "error",
        );
      }
    },
    [setWalletBehavior, showToast],
  );

  const confirmWalletBehavior = React.useCallback(
    (title: string, body: string, next: WalletBehavior) => {
      Alert.alert(title, `${body}\n\nRestart the app after applying.`, [
        { text: "Cancel", style: "cancel" },
        {
          text: "Apply",
          style: "default",
          onPress: () => {
            void applyWalletBehavior(next);
          },
        },
      ]);
    },
    [applyWalletBehavior],
  );

  function toggleVtxoAutoRenewal() {
    if (walletBehavior.vtxoAutoRenewal) {
      confirmWalletBehavior(
        "Turn off VTXO auto-renewal?",
        walletBehavior.delegatedRenewal
          ? "Delegated renewal will also turn off because it uses the same SDK settlement manager."
          : "The wallet will stop renewing expiring VTXOs automatically.",
        { vtxoAutoRenewal: false, delegatedRenewal: false },
      );
      return;
    }

    confirmWalletBehavior(
      "Turn on VTXO auto-renewal?",
      "The SDK settlement manager will watch expiring VTXOs and renew them automatically.",
      { ...walletBehavior, vtxoAutoRenewal: true },
    );
  }

  function toggleDelegatedRenewal() {
    if (!walletBehavior.delegatedRenewal && !delegateUrl) {
      showToast("No delegate endpoint for this network", "error");
      return;
    }

    if (walletBehavior.delegatedRenewal) {
      confirmWalletBehavior(
        "Turn off delegated renewal?",
        "Renewals will stay local to this device. This can change the Arkade receive address.",
        { ...walletBehavior, delegatedRenewal: false },
      );
      return;
    }

    confirmWalletBehavior(
      "Turn on delegated renewal?",
      `The wallet will use ${delegateUrl} for delegated renewal. This can change the Arkade receive address.`,
      { vtxoAutoRenewal: true, delegatedRenewal: true },
    );
  }

  const applyBackgroundTaskEnabled = React.useCallback(
    async (taskKey: BackgroundTaskKey, enabled: boolean) => {
      try {
        await setBackgroundTaskEnabled(taskKey, enabled);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } catch (e) {
        showToast(
          e instanceof Error ? e.message : "Could not update background task",
          "error",
        );
      }
    },
    [setBackgroundTaskEnabled, showToast],
  );

  const toggleSwapPollTask = React.useCallback(() => {
    if (!backgroundTasks.swapPoll) {
      void applyBackgroundTaskEnabled("swapPoll", true);
      return;
    }
    Alert.alert(
      "Turn off Lightning background polling?",
      "Lightning swaps will stop progressing while the app is in the background. Reverse swaps may stall and submarine refunds will not trigger until you reopen the app.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Turn off",
          style: "destructive",
          onPress: () => {
            void applyBackgroundTaskEnabled("swapPoll", false);
          },
        },
      ],
    );
  }, [backgroundTasks.swapPoll, applyBackgroundTaskEnabled]);

  const arkUrl = networkState.arkServerUrl;
  const indexerUrl = arkUrl;
  const esploraOverride = wallet?.esploraUrl ?? null;
  const esploraDefault = defaultEsploraUrl(detectedNetwork);
  const esploraUrl = esploraOverride ?? esploraDefault;

  const lightningNetwork = wallet?.network ?? detectedNetwork ?? null;
  const lightningSupported = isLightningSupportedForNetwork(lightningNetwork);
  const boltzUrl = lightningNetwork
    ? boltzApiUrlForNetwork(lightningNetwork)
    : null;
  const boltzLegacyUrls = lightningNetwork
    ? boltzLegacyApiUrlsForNetwork(lightningNetwork)
    : [];
  const lightningRestore = wallet?.lightningRestore ?? null;
  const [lightningLimits, setLightningLimits] = React.useState<{
    min: number;
    max: number;
  } | null>(null);
  const [lightningFees, setLightningFees] = React.useState<{
    submarinePercent: number;
    submarineMinerSats: number;
    reversePercent: number;
    reverseMinerSats: number;
  } | null>(null);
  const [lightningStatus, setLightningStatus] = React.useState<
    "idle" | "loading" | "online" | "offline"
  >("idle");

  React.useEffect(() => {
    if (!lightningSupported || !lightningNetwork || !wallet) {
      setLightningStatus("idle");
      return;
    }
    let cancelled = false;
    setLightningStatus("loading");
    (async () => {
      try {
        const [limits, fees] = await Promise.all([
          getLightningLimits(lightningNetwork),
          getLightningFees(lightningNetwork),
        ]);
        if (cancelled) return;
        setLightningLimits({ min: limits.min, max: limits.max });
        setLightningFees({
          submarinePercent: fees.submarine.percentage,
          submarineMinerSats: fees.submarine.minerFees,
          reversePercent: fees.reverse.percentage,
          reverseMinerSats:
            fees.reverse.minerFees.lockup + fees.reverse.minerFees.claim,
        });
        setLightningStatus("online");
      } catch {
        if (cancelled) return;
        setLightningStatus("offline");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [lightningSupported, lightningNetwork, wallet]);

  function formatRestoreTimestamp(ts: number): string {
    return new Date(ts).toLocaleString();
  }

  return (
    <ScrollView
      style={{ backgroundColor: theme.colors.background }}
      contentContainerStyle={styles.content}
    >
      <View style={styles.header}>
        <SlidersHorizontal color={theme.colors.primary} size={48} />
        <Text style={[styles.title, { color: theme.colors.text }]}>
          Advanced
        </Text>
        <Text style={[styles.subtitle, { color: theme.colors.textMuted }]}>
          Inspect the wallet runtime and copy raw configuration.
        </Text>
      </View>

      <Text style={[styles.sectionLabel, { color: theme.colors.textMuted }]}>
        Endpoints
      </Text>
      <View
        style={[
          styles.cardFlush,
          {
            backgroundColor: theme.colors.card,
            borderColor: theme.colors.border,
          },
        ]}
      >
        <EndpointRow
          theme={theme}
          icon={Server}
          label="Ark server"
          subtitle="Submits transactions, signs intents"
          url={arkUrl}
          onCopy={() => handleCopy(arkUrl, "Ark server URL")}
        />
        <Divider theme={theme} />
        <EndpointRow
          theme={theme}
          icon={Database}
          label="Indexer"
          subtitle="Reads vtxos and history"
          url={indexerUrl}
          tag="Same host"
          onCopy={() => handleCopy(indexerUrl, "Indexer URL")}
        />
        <Divider theme={theme} />
        <EndpointRow
          theme={theme}
          icon={Compass}
          label="Esplora"
          subtitle="Onchain block explorer"
          url={esploraUrl ?? "Will use SDK default once connected"}
          tag={
            esploraOverride
              ? "Override"
              : esploraDefault
                ? "Default"
                : undefined
          }
          inert={!esploraUrl}
          onCopy={
            esploraUrl ? () => handleCopy(esploraUrl, "Esplora URL") : undefined
          }
        />
        <Divider theme={theme} />
        <EndpointRow
          theme={theme}
          icon={Share2}
          label="Delegate"
          subtitle="Delegated renewal endpoint"
          url={delegateUrl ?? "No default delegate for this network"}
          tag={
            walletBehavior.delegatedRenewal
              ? "On"
              : delegateUrl
                ? "Off"
                : "Unavailable"
          }
          inert={!delegateUrl}
          onCopy={
            delegateUrl
              ? () => handleCopy(delegateUrl, "Delegate URL")
              : undefined
          }
        />
      </View>

      {serverInfo ? (
        <>
          <Text
            style={[styles.sectionLabel, { color: theme.colors.textMuted }]}
          >
            Server details
          </Text>
          <View
            style={[
              styles.cardFlush,
              {
                backgroundColor: theme.colors.card,
                borderColor: theme.colors.border,
              },
            ]}
          >
            <Pressable
              onPress={() => setDetailsOpen((v) => !v)}
              accessibilityRole="button"
              accessibilityLabel={
                detailsOpen ? "Hide server details" : "Show server details"
              }
              accessibilityState={{ expanded: detailsOpen }}
              style={({ pressed }) => [
                styles.detailsHeader,
                pressed && { opacity: 0.7 },
              ]}
            >
              <Text
                style={[styles.detailsHeaderText, { color: theme.colors.text }]}
              >
                {detailsOpen ? "Hide details" : "Show details"}
              </Text>
              {detailsOpen ? (
                <ChevronUp color={theme.colors.textMuted} size={18} />
              ) : (
                <ChevronDown color={theme.colors.textMuted} size={18} />
              )}
            </Pressable>
            {detailsOpen ? (
              <>
                <Divider theme={theme} />
                <DetailRow
                  theme={theme}
                  label="Version"
                  value={
                    serverInfo.version
                      ? `v${serverInfo.version}`
                      : "Not reported"
                  }
                />
                <DetailRow
                  theme={theme}
                  label="Network"
                  value={serverInfo.network}
                />
                <DetailRow
                  theme={theme}
                  label="Signer pubkey"
                  value={serverInfo.signerPubkey}
                  mono
                  truncate
                  onCopy={() =>
                    handleCopy(serverInfo.signerPubkey, "Signer pubkey")
                  }
                />
                <DetailRow
                  theme={theme}
                  label="Forfeit address"
                  value={serverInfo.forfeitAddress}
                  mono
                  truncate
                  onCopy={() =>
                    handleCopy(serverInfo.forfeitAddress, "Forfeit address")
                  }
                />
                <DetailRow
                  theme={theme}
                  label="Dust threshold"
                  value={`${formatSats(serverInfo.dustSats)} ${unitLabel}`}
                />
                <DetailRow
                  theme={theme}
                  label="Unilateral exit"
                  value={formatExitDelay(serverInfo.unilateralExitDelaySeconds)}
                />
                <DetailRow
                  theme={theme}
                  label="Tx fee rate"
                  value={`${serverInfo.txFeeRate} sat/vB`}
                  last
                />
              </>
            ) : null}
          </View>
        </>
      ) : null}

      <Text style={[styles.sectionLabel, { color: theme.colors.textMuted }]}>
        Wallet Behaviour
      </Text>
      <View
        style={[
          styles.cardFlush,
          {
            backgroundColor: theme.colors.card,
            borderColor: theme.colors.border,
          },
        ]}
      >
        <BehaviorToggleRow
          theme={theme}
          label="VTXO auto-renewal"
          checked={walletBehavior.vtxoAutoRenewal}
          onPress={toggleVtxoAutoRenewal}
          hint={
            walletBehavior.vtxoAutoRenewal
              ? "The SDK settlement manager renews expiring VTXOs."
              : "Expiring VTXOs stay manual."
          }
        />
        <Divider theme={theme} />
        <BehaviorToggleRow
          theme={theme}
          label="Delegated renewal"
          checked={walletBehavior.delegatedRenewal}
          onPress={toggleDelegatedRenewal}
          disabled={!walletBehavior.delegatedRenewal && !delegateUrl}
          tag={delegateUrl ? undefined : "Unavailable"}
          hint={
            delegateUrl
              ? walletBehavior.delegatedRenewal
                ? "Renewal handoff uses the configured Arkade delegate."
                : "Renewals stay local to this device."
              : "This network has no default delegate endpoint."
          }
        />
      </View>

      <Text style={[styles.sectionLabel, { color: theme.colors.textMuted }]}>
        Background tasks
      </Text>
      <View
        style={[
          styles.cardFlush,
          {
            backgroundColor: theme.colors.card,
            borderColor: theme.colors.border,
          },
        ]}
      >
        <BackgroundTaskRow
          theme={theme}
          taskName={SWAP_BACKGROUND_TASK_NAME}
          displayName="Lightning swap polling"
          description={
            backgroundTasks.swapPoll
              ? "Every ~15 minutes the OS wakes the app to advance pending Lightning swaps and trigger refunds."
              : "Lightning swaps will not advance while the app is in the background."
          }
          enabled={backgroundTasks.swapPoll}
          recommendedOn
          onToggle={toggleSwapPollTask}
        />
      </View>

      {lightningSupported ? (
        <>
          <Text
            style={[styles.sectionLabel, { color: theme.colors.textMuted }]}
          >
            Lightning
          </Text>
          <View
            style={[
              styles.cardFlush,
              {
                backgroundColor: theme.colors.card,
                borderColor: theme.colors.border,
              },
            ]}
          >
            <DetailRow
              theme={theme}
              label="Boltz API"
              value={boltzUrl ?? "—"}
              mono
              subtext={
                boltzLegacyUrls.length > 0
                  ? `Legacy recovery fallback: ${boltzLegacyUrls.map((u) => new URL(u).host).join(", ")}`
                  : undefined
              }
              onCopy={
                boltzUrl ? () => handleCopy(boltzUrl, "Boltz URL") : undefined
              }
            />
            <DetailRow
              theme={theme}
              label="Status"
              value={
                lightningStatus === "online"
                  ? "Connected"
                  : lightningStatus === "loading"
                    ? "Loading…"
                    : lightningStatus === "offline"
                      ? "Offline"
                      : "Idle"
              }
            />
            <DetailRow
              theme={theme}
              label="Min / Max"
              value={
                lightningLimits
                  ? `${lightningLimits.min.toLocaleString()} – ${lightningLimits.max.toLocaleString()} sats`
                  : "—"
              }
            />
            <DetailRow
              theme={theme}
              label="Submarine fee"
              value={
                lightningFees
                  ? `${lightningFees.submarinePercent}% + ${lightningFees.submarineMinerSats.toLocaleString()} sats miner`
                  : "—"
              }
            />
            <DetailRow
              theme={theme}
              label="Reverse fee"
              value={
                lightningFees
                  ? `${lightningFees.reversePercent}% + ${lightningFees.reverseMinerSats.toLocaleString()} sats miner`
                  : "—"
              }
            />
            <DetailRow
              theme={theme}
              label="Last restore"
              value={
                lightningRestore
                  ? `${lightningRestore.lastCount} swap(s) at ${formatRestoreTimestamp(
                      lightningRestore.lastAt,
                    )}`
                  : "Not run yet"
              }
            />
            {lightningRestore?.lastError ? (
              <DetailRow
                theme={theme}
                label="Restore error"
                value={lightningRestore.lastError}
              />
            ) : null}
          </View>
        </>
      ) : null}

      <Text style={[styles.sectionLabel, { color: theme.colors.textMuted }]}>
        Diagnostics
      </Text>
      <View
        style={[
          styles.cardFlush,
          {
            backgroundColor: theme.colors.card,
            borderColor: theme.colors.border,
          },
        ]}
      >
        <DetailRow
          theme={theme}
          label="Arkade SDK"
          value={SDK_VERSION ? `v${SDK_VERSION}` : "—"}
        />
        <DetailRow
          theme={theme}
          label="Boltz swap"
          value={BOLTZ_VERSION ? `v${BOLTZ_VERSION}` : "—"}
        />
        <DetailRow
          theme={theme}
          label="App commit"
          value={APP_COMMIT ?? "—"}
          mono
          onCopy={
            APP_COMMIT ? () => handleCopy(APP_COMMIT, "Commit") : undefined
          }
        />
        {APP_TAG ? (
          <DetailRow theme={theme} label="App tag" value={APP_TAG} />
        ) : null}
        <RawRow
          theme={theme}
          label="Support bundle"
          hint="Wallet, server, recovery counts, and recent error events. Redacted — safe to share."
          busy={busyKey === "bundle"}
          busyLabel={bundleStage ? BUNDLE_STAGE_LABEL[bundleStage] : undefined}
          onPress={presentBundleActions}
        />
      </View>
      <AuthGate
        visible={authVisible}
        title="Authorize Support Bundle"
        message="Authorize to build a redacted snapshot of wallet and server state for debugging."
        onSuccess={handleAuthorizedBundle}
        onCancel={() => setAuthVisible(false)}
      />
    </ScrollView>
  );
}

function EndpointRow({
  theme,
  icon,
  label,
  subtitle,
  url,
  tag,
  inert,
  onCopy,
}: {
  theme: AppTheme;
  icon: IconType;
  label: string;
  subtitle?: string;
  url: string;
  tag?: string;
  inert?: boolean;
  onCopy?: () => void;
}) {
  const Icon = icon;
  return (
    <View style={styles.endpointRow}>
      <View
        style={[
          styles.endpointIcon,
          { backgroundColor: theme.colors.surfaceSubtle },
        ]}
      >
        <Icon
          color={inert ? theme.colors.textSubtle : theme.colors.textMuted}
          size={20}
        />
      </View>
      <View style={styles.endpointBody}>
        <View style={styles.endpointHeaderRow}>
          <Text
            style={[
              styles.endpointLabel,
              { color: inert ? theme.colors.textSubtle : theme.colors.text },
            ]}
          >
            {label}
          </Text>
          {tag ? (
            <View
              style={[
                styles.endpointTag,
                { backgroundColor: theme.colors.surfaceSubtle },
              ]}
            >
              <Text
                style={[
                  styles.endpointTagText,
                  { color: theme.colors.textSubtle },
                ]}
              >
                {tag}
              </Text>
            </View>
          ) : null}
        </View>
        {subtitle ? (
          <Text
            style={[
              styles.endpointSubtitle,
              { color: theme.colors.textSubtle },
            ]}
            numberOfLines={1}
          >
            {subtitle}
          </Text>
        ) : null}
        <View style={styles.endpointUrlRow}>
          <Text
            style={[
              styles.endpointUrl,
              {
                color: inert ? theme.colors.textSubtle : theme.colors.textMuted,
              },
            ]}
            numberOfLines={1}
            ellipsizeMode="middle"
          >
            {url}
          </Text>
          {onCopy ? (
            <Pressable
              onPress={onCopy}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel={`Copy ${label} URL`}
              style={({ pressed }) => (pressed ? { opacity: 0.5 } : null)}
            >
              <Copy color={theme.colors.textMuted} size={16} />
            </Pressable>
          ) : null}
        </View>
      </View>
    </View>
  );
}

function DetailRow({
  theme,
  label,
  value,
  mono,
  truncate,
  last,
  subtext,
  onCopy,
}: {
  theme: AppTheme;
  label: string;
  value: string;
  mono?: boolean;
  truncate?: boolean;
  last?: boolean;
  subtext?: string;
  onCopy?: () => void;
}) {
  return (
    <>
      <View style={styles.detailRow}>
        <Text style={[styles.detailLabel, { color: theme.colors.textMuted }]}>
          {label}
        </Text>
        <View style={styles.detailValueWrap}>
          <View style={styles.detailValueColumn}>
            <Text
              style={[
                styles.detailValue,
                {
                  color: theme.colors.text,
                  fontFamily: mono
                    ? typography.fontFamily.mono
                    : typography.fontFamily.ui,
                },
              ]}
              numberOfLines={truncate ? 1 : undefined}
              ellipsizeMode={truncate ? "middle" : undefined}
            >
              {value}
            </Text>
            {subtext ? (
              <Text
                style={[
                  styles.detailValue,
                  {
                    color: theme.colors.textMuted,
                    fontFamily: typography.fontFamily.ui,
                    fontSize: 11,
                    marginTop: 2,
                  },
                ]}
              >
                {subtext}
              </Text>
            ) : null}
          </View>
          {onCopy ? (
            <Pressable
              onPress={onCopy}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel={`Copy ${label}`}
              style={({ pressed }) => (pressed ? { opacity: 0.5 } : null)}
            >
              <Copy color={theme.colors.textMuted} size={14} />
            </Pressable>
          ) : null}
        </View>
      </View>
      {last ? null : <Divider theme={theme} />}
    </>
  );
}

function Divider({ theme }: { theme: AppTheme }) {
  return <View style={{ height: 1, backgroundColor: theme.colors.divider }} />;
}

function BehaviorToggleRow({
  theme,
  label,
  checked,
  disabled,
  tag,
  hint,
  onPress,
}: {
  theme: AppTheme;
  label: string;
  checked: boolean;
  disabled?: boolean;
  tag?: string;
  hint?: string;
  onPress: () => void;
}) {
  const trackColor = checked
    ? theme.colors.primary
    : theme.colors.surfaceSubtle;
  const isInert = disabled === true;
  return (
    <Pressable
      onPress={onPress}
      disabled={isInert}
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked, disabled: isInert }}
      style={({ pressed }) => [
        styles.behaviorRow,
        pressed && !isInert ? { opacity: 0.6 } : null,
        isInert ? { opacity: 0.45 } : null,
      ]}
    >
      <View style={styles.behaviorHead}>
        <View style={styles.behaviorTitleWrap}>
          <Text style={[styles.behaviorLabel, { color: theme.colors.text }]}>
            {label}
          </Text>
          {tag ? (
            <View
              style={[
                styles.endpointTag,
                { backgroundColor: theme.colors.surfaceSubtle },
              ]}
            >
              <Text
                style={[
                  styles.endpointTagText,
                  { color: theme.colors.textSubtle },
                ]}
              >
                {tag}
              </Text>
            </View>
          ) : null}
        </View>
        <View
          style={[
            styles.switchTrack,
            {
              backgroundColor: trackColor,
              borderColor: checked ? theme.colors.primary : theme.colors.border,
            },
          ]}
        >
          <View
            style={[
              styles.switchThumb,
              {
                backgroundColor: checked
                  ? theme.colors.onPrimary
                  : theme.colors.textSubtle,
                transform: [{ translateX: checked ? 18 : 0 }],
              },
            ]}
          />
        </View>
      </View>
      {hint ? (
        <Text style={[styles.behaviorHint, { color: theme.colors.textSubtle }]}>
          {hint}
        </Text>
      ) : null}
    </Pressable>
  );
}

function formatRelativeTime(timestamp: number): string {
  const deltaMs = Date.now() - timestamp;
  if (!Number.isFinite(deltaMs) || deltaMs < 0) return "just now";
  const seconds = Math.floor(deltaMs / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString();
}

function formatSummary(summary: Record<string, number> | null): string | null {
  if (!summary) return null;
  const parts: string[] = [];
  for (const [key, value] of Object.entries(summary)) {
    if (value > 0) parts.push(`${key} ${value}`);
  }
  return parts.length > 0 ? parts.join(", ") : null;
}

function BackgroundTaskRow({
  theme,
  taskName,
  displayName,
  description,
  enabled,
  recommendedOn,
  onToggle,
}: {
  theme: AppTheme;
  taskName: string;
  displayName: string;
  description: string;
  enabled: boolean;
  recommendedOn?: boolean;
  onToggle: () => void;
}) {
  const metrics = useBackgroundTaskMetrics(taskName);
  const showRecommendedTag = recommendedOn === true && !enabled;
  return (
    <View>
      <BehaviorToggleRow
        theme={theme}
        label={displayName}
        checked={enabled}
        onPress={onToggle}
        hint={description}
        tag={showRecommendedTag ? "Recommended on" : undefined}
      />
      <BackgroundTaskMetricsBlock theme={theme} metrics={metrics} />
    </View>
  );
}

function BackgroundTaskMetricsBlock({
  theme,
  metrics,
}: {
  theme: AppTheme;
  metrics: BgTaskMetrics | null;
}) {
  const [showDetails, setShowDetails] = React.useState(false);

  if (!metrics) return null;
  if (metrics.totalRuns === 0) {
    return (
      <View
        style={[
          styles.bgMetricsBlock,
          { borderTopColor: theme.colors.divider },
        ]}
      >
        <BackgroundTaskMetricsLine
          theme={theme}
          label="Last run"
          value="Never run"
        />
      </View>
    );
  }

  const summary = formatSummary(metrics.lastSuccessSummary);
  const successPart =
    metrics.lastSuccessAt != null
      ? `${formatRelativeTime(metrics.lastSuccessAt)}${
          summary ? ` — ${summary}` : ""
        }${
          metrics.lastSuccessDurationMs != null
            ? ` (${metrics.lastSuccessDurationMs} ms)`
            : ""
        }`
      : null;

  const failurePart =
    metrics.lastFailureAt != null
      ? `${formatRelativeTime(metrics.lastFailureAt)}${
          metrics.lastFailureMessage ? ` — ${metrics.lastFailureMessage}` : ""
        }`
      : null;

  const hasDetails =
    metrics.lastFailureDetails &&
    Object.keys(metrics.lastFailureDetails).length > 0;

  return (
    <View
      style={[styles.bgMetricsBlock, { borderTopColor: theme.colors.divider }]}
    >
      {successPart ? (
        <BackgroundTaskMetricsLine
          theme={theme}
          label="Last run"
          value={successPart}
        />
      ) : null}
      {failurePart ? (
        <View>
          <BackgroundTaskMetricsLine
            theme={theme}
            label="Last failure"
            value={failurePart}
            danger
          />
          {hasDetails && (
            <Pressable
              onPress={() => setShowDetails((v) => !v)}
              accessibilityRole="button"
              accessibilityLabel={
                showDetails ? "Hide failure details" : "Show failure details"
              }
              accessibilityState={{ expanded: showDetails }}
              style={styles.detailsToggle}
            >
              <Text
                style={[
                  styles.detailsToggleText,
                  { color: theme.colors.primary },
                ]}
              >
                {showDetails ? "Hide details" : "Show details"}
              </Text>
            </Pressable>
          )}
          {showDetails && hasDetails && (
            <View
              style={[
                styles.detailsBox,
                {
                  backgroundColor: theme.colors.surfaceSubtle,
                  borderColor: theme.colors.border,
                },
              ]}
            >
              <Text
                style={[
                  styles.detailsText,
                  {
                    color: theme.colors.textMuted,
                    fontFamily: typography.fontFamily.mono,
                  },
                ]}
              >
                {JSON.stringify(metrics.lastFailureDetails, null, 2)}
              </Text>
            </View>
          )}
        </View>
      ) : null}
      <BackgroundTaskMetricsLine
        theme={theme}
        label="Runs"
        value={`${metrics.totalSuccesses} success / ${metrics.totalRuns} total${
          metrics.totalFailures > 0 ? ` · ${metrics.totalFailures} failed` : ""
        }`}
      />
    </View>
  );
}

function BackgroundTaskMetricsLine({
  theme,
  label,
  value,
  danger,
}: {
  theme: AppTheme;
  label: string;
  value: string;
  danger?: boolean;
}) {
  return (
    <View style={styles.bgMetricsLine}>
      <Text style={[styles.bgMetricsLabel, { color: theme.colors.textSubtle }]}>
        {label}
      </Text>
      <Text
        style={[
          styles.bgMetricsValue,
          { color: danger ? theme.colors.danger : theme.colors.textMuted },
        ]}
      >
        {value}
      </Text>
    </View>
  );
}

function RawRow({
  theme,
  label,
  hint,
  busy,
  busyLabel,
  disabled,
  onPress,
}: {
  theme: AppTheme;
  label: string;
  hint: string;
  busy?: boolean;
  /** Live stage label shown in place of the hint while `busy`. */
  busyLabel?: string;
  disabled?: boolean;
  onPress: () => void | Promise<void>;
}) {
  const isInert = disabled || busy;
  const subtitle = busy && busyLabel ? busyLabel : hint;
  return (
    <Pressable
      onPress={onPress}
      disabled={isInert}
      accessibilityRole="button"
      accessibilityLabel={`Copy ${label}`}
      accessibilityHint={hint}
      accessibilityState={{ disabled: !!disabled, busy: !!busy }}
      style={({ pressed }) => [
        styles.rawRow,
        pressed && !isInert ? { opacity: 0.6 } : null,
        disabled ? { opacity: 0.4 } : null,
      ]}
    >
      <View
        style={[
          styles.endpointIcon,
          { backgroundColor: theme.colors.surfaceSubtle },
        ]}
      >
        <Braces
          color={disabled ? theme.colors.textSubtle : theme.colors.textMuted}
          size={20}
        />
      </View>
      <View style={styles.endpointBody}>
        <Text
          style={[
            styles.endpointLabel,
            { color: disabled ? theme.colors.textSubtle : theme.colors.text },
          ]}
        >
          {label}
        </Text>
        <Text
          style={[styles.endpointSubtitle, { color: theme.colors.textSubtle }]}
          numberOfLines={2}
        >
          {subtitle}
        </Text>
      </View>
      <View style={styles.rawAction}>
        {busy ? (
          <ActivityIndicator color={theme.colors.textMuted} size="small" />
        ) : (
          <Copy color={theme.colors.textMuted} size={18} />
        )}
      </View>
    </Pressable>
  );
}

const METRICS_LABEL_WIDTH = 96;

const styles = StyleSheet.create({
  content: {
    padding: spacing[5],
    paddingBottom: 120,
  },
  header: {
    alignItems: "center",
    paddingVertical: spacing[6],
  },
  title: {
    fontSize: typography.size.xl,
    fontWeight: typography.weight.bold,
    marginTop: spacing[3],
  },
  subtitle: {
    fontSize: typography.size.sm,
    marginTop: spacing[2],
    textAlign: "center",
    lineHeight: typography.lineHeight.sm,
  },
  cardFlush: {
    borderRadius: radius.md,
    borderWidth: 1,
    overflow: "hidden",
  },
  sectionLabel: {
    fontSize: typography.size.xs,
    fontWeight: typography.weight.semibold,
    textTransform: "uppercase",
    letterSpacing: 1,
    marginTop: spacing[6],
    marginBottom: spacing[2],
    paddingHorizontal: spacing[1],
  },
  endpointRow: {
    flexDirection: "row",
    paddingVertical: spacing[4],
    paddingHorizontal: spacing[4],
    gap: spacing[3],
  },
  endpointIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  endpointBody: {
    flex: 1,
    minWidth: 0,
  },
  endpointHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
  },
  endpointLabel: {
    fontSize: typography.size.md,
    fontWeight: typography.weight.semibold,
  },
  endpointTag: {
    paddingHorizontal: spacing[2],
    paddingVertical: 2,
    borderRadius: radius.xs,
  },
  endpointTagText: {
    fontSize: 10,
    fontWeight: typography.weight.semibold,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  endpointSubtitle: {
    fontSize: typography.size.xs,
    marginTop: 2,
  },
  endpointUrlRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    marginTop: spacing[2],
  },
  endpointUrl: {
    flex: 1,
    fontSize: typography.size.xs,
    fontFamily: typography.fontFamily.mono,
  },
  detailsHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: spacing[4],
    paddingHorizontal: spacing[4],
  },
  detailsHeaderText: {
    fontSize: typography.size.md,
    fontWeight: typography.weight.medium,
  },
  detailRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: spacing[3],
    paddingVertical: spacing[3],
    paddingHorizontal: spacing[4],
  },
  detailLabel: {
    fontSize: typography.size.sm,
    fontWeight: typography.weight.medium,
  },
  detailValueWrap: {
    flex: 1,
    flexDirection: "row",
    justifyContent: "flex-end",
    alignItems: "center",
    gap: spacing[2],
    minWidth: 0,
  },
  // Lets the value/subtext column shrink so the mono value truncates instead
  // of overflowing past the left edge of the row.
  detailValueColumn: {
    flexShrink: 1,
    minWidth: 0,
  },
  detailValue: {
    flexShrink: 1,
    fontSize: typography.size.sm,
    textAlign: "right",
  },
  behaviorRow: {
    paddingVertical: spacing[4],
    paddingHorizontal: spacing[4],
  },
  behaviorHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing[3],
  },
  behaviorTitleWrap: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
  },
  behaviorLabel: {
    flexShrink: 1,
    fontSize: typography.size.md,
    fontWeight: typography.weight.semibold,
  },
  switchTrack: {
    width: 42,
    height: 24,
    padding: 2,
    borderRadius: radius.pill,
    borderWidth: 1,
    justifyContent: "center",
  },
  switchThumb: {
    width: 18,
    height: 18,
    borderRadius: 9,
  },
  behaviorHint: {
    fontSize: typography.size.xs,
    marginTop: spacing[2],
    lineHeight: typography.lineHeight.xs,
  },
  bgMetricsBlock: {
    paddingHorizontal: spacing[4],
    paddingBottom: spacing[4],
    paddingTop: spacing[3],
    borderTopWidth: 1,
    gap: spacing[2],
  },
  bgMetricsLine: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing[3],
  },
  bgMetricsLabel: {
    width: METRICS_LABEL_WIDTH,
    fontSize: typography.size.xs,
    fontWeight: typography.weight.medium,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  bgMetricsValue: {
    flex: 1,
    fontSize: typography.size.xs,
    lineHeight: typography.lineHeight.xs,
  },
  rawRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing[4],
    paddingHorizontal: spacing[4],
    gap: spacing[3],
  },
  rawAction: {
    width: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  detailsToggle: {
    marginLeft: METRICS_LABEL_WIDTH + spacing[3],
    paddingVertical: spacing[1],
  },
  detailsToggleText: {
    fontSize: typography.size.xs,
    fontWeight: typography.weight.semibold,
  },
  detailsBox: {
    marginLeft: METRICS_LABEL_WIDTH + spacing[3],
    marginTop: spacing[1],
    padding: spacing[2],
    borderRadius: radius.sm,
    borderWidth: 1,
  },
  detailsText: {
    // intentionally below xs (12) for dense monospace technical output
    fontSize: 10,
    lineHeight: 14,
  },
});
