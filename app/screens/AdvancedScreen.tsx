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
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import Button from "../components/Button";
import { useToast } from "../components/ToastProvider";
import { useResolvedTheme } from "../hooks/useResolvedTheme";
import { normalizeServerUrl } from "../services/arkade/network";
import { fetchRawServerInfo, probeServer } from "../services/arkade/runtime";
import type { ArkadeServerInfo, ServerStatus } from "../store/types";
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
  const setArkServerUrl = useAppStore((s) => s.setArkServerUrl);
  const refreshServer = useAppStore((s) => s.refreshServer);

  const [draft, setDraft] = React.useState(networkState.arkServerUrl);
  const [detailsOpen, setDetailsOpen] = React.useState(false);
  const [busyKey, setBusyKey] = React.useState<string | null>(null);
  const normalizedDraft = normalizeServerUrl(draft);
  const isDirty =
    normalizedDraft !== "" && normalizedDraft !== networkState.arkServerUrl;
  const previewMismatch =
    normalizedDraft !== "" && normalizedDraft !== draft.trim();
  const isConnecting = networkState.status === "connecting";
  const isTesting = busyKey === "test";
  const serverInfo = networkState.serverInfo;
  const detectedNetwork = networkState.detectedNetwork;

  React.useEffect(() => {
    if (networkState.status === "idle") {
      refreshServer();
    }
  }, [networkState.status, refreshServer]);

  async function handleApply() {
    if (wallet) {
      showToast("Reset the wallet before changing the server", "error");
      setDraft(networkState.arkServerUrl);
      return;
    }
    if (!normalizedDraft) {
      showToast("Enter a server URL", "error");
      return;
    }
    if (!isDirty) return;
    setDraft(normalizedDraft);
    await setArkServerUrl(normalizedDraft);
    await refreshServer();
  }

  async function handleTest() {
    const target = normalizedDraft || networkState.arkServerUrl;
    if (!target) return;
    if (target === networkState.arkServerUrl) {
      await refreshServer();
      const status = useAppStore.getState().network.status;
      if (status === "online") {
        showToast("Server reachable", "success");
      } else if (status === "offline") {
        showToast(
          useAppStore.getState().network.lastError ?? "Server unreachable",
          "error",
        );
      }
      return;
    }
    setBusyKey("test");
    try {
      await probeServer(target);
      showToast("Server reachable", "success");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Server unreachable";
      showToast(msg, "error");
    } finally {
      setBusyKey(null);
    }
  }

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

  async function copyServerInfoJson() {
    setBusyKey("server");
    try {
      const raw = await fetchRawServerInfo(networkState.arkServerUrl);
      await Clipboard.setStringAsync(JSON.stringify(raw, null, 2));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      showToast("Server info copied", "success");
    } catch (e) {
      showToast(
        e instanceof Error ? e.message : "Could not fetch server info",
        "error",
      );
    } finally {
      setBusyKey(null);
    }
  }

  async function copyWalletMetadataJson() {
    if (!wallet) {
      showToast("No wallet to copy", "error");
      return;
    }
    try {
      await Clipboard.setStringAsync(JSON.stringify(wallet, null, 2));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      showToast("Wallet metadata copied", "success");
    } catch {
      showToast("Could not copy", "error");
    }
  }

  async function copyAppStateJson() {
    const s = useAppStore.getState();
    const sanitized = {
      schemaVersion: s.schemaVersion,
      wallet: s.wallet,
      network: s.network,
      preferences: s.preferences,
      security: {
        isLocked: s.security.isLocked,
        biometricsEnabled: s.security.biometricsEnabled,
        passwordHash: s.security.passwordHash ? "[redacted]" : undefined,
      },
    };
    try {
      await Clipboard.setStringAsync(JSON.stringify(sanitized, null, 2));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      showToast("App state copied", "success");
    } catch {
      showToast("Could not copy", "error");
    }
  }

  const arkUrl = networkState.arkServerUrl;
  const indexerUrl = arkUrl;
  const esploraOverride = wallet?.esploraUrl ?? null;
  const esploraDefault = defaultEsploraUrl(detectedNetwork);
  const esploraUrl = esploraOverride ?? esploraDefault;

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
          Inspect the wallet runtime, switch servers, and copy raw
          configuration.
        </Text>
      </View>

      <View
        style={[
          styles.card,
          {
            backgroundColor: theme.colors.card,
            borderColor: theme.colors.border,
            ...theme.shadow("card"),
          },
        ]}
      >
        <Text style={[styles.label, { color: theme.colors.textMuted }]}>
          Server URL
        </Text>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="url"
          inputMode="url"
          placeholder="mutinynet.arkade.sh"
          placeholderTextColor={theme.colors.placeholder}
          returnKeyType="done"
          onSubmitEditing={isDirty ? handleApply : handleTest}
          editable={!isConnecting && !isTesting && !wallet}
          style={[
            styles.input,
            {
              color: theme.colors.text,
              backgroundColor: theme.colors.surfaceSubtle,
              borderColor: theme.colors.border,
            },
          ]}
        />
        {previewMismatch ? (
          <Text style={[styles.hint, { color: theme.colors.textSubtle }]}>
            Will use {normalizedDraft}
          </Text>
        ) : null}
        {wallet ? (
          <Text style={[styles.hint, { color: theme.colors.textSubtle }]}>
            Server is locked once a wallet exists. Reset to switch.
          </Text>
        ) : null}
        <View style={styles.pillRow}>
          <StatusPill
            status={networkState.status}
            serverInfo={serverInfo}
            theme={theme}
          />
        </View>
        {networkState.lastError ? (
          <Text style={[styles.errorText, { color: theme.colors.danger }]}>
            {networkState.lastError}
          </Text>
        ) : null}
      </View>

      <View style={styles.actions}>
        {isDirty ? (
          <Button
            label="Apply server"
            theme={theme}
            onPress={handleApply}
            loading={isConnecting}
            disabled={isConnecting || isTesting || !!wallet}
          />
        ) : null}
        <Button
          label="Test connection"
          variant="secondary"
          theme={theme}
          onPress={handleTest}
          loading={isConnecting || isTesting}
          disabled={isConnecting || isTesting}
          style={isDirty ? styles.testBtn : undefined}
        />
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
          subtitle="Renews virtual coins on your behalf"
          url="Not configured"
          tag="Off"
          inert
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
                  value={`${serverInfo.dustSats.toLocaleString()} sats`}
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
        Wallet behaviour
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
        <RuntimeRow
          theme={theme}
          label="Vtxo auto-renewal"
          value="Off"
          tone="muted"
          hint="Vtxos must be settled manually before they expire."
        />
        <Divider theme={theme} />
        <RuntimeRow
          theme={theme}
          label="Delegated renewal"
          value="Off"
          tone="muted"
          hint="Renewals stay on this device — no third-party delegate is involved."
        />
      </View>

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
          label="Server info"
          hint="Fresh snapshot from the Arkade server"
          busy={busyKey === "server"}
          onPress={copyServerInfoJson}
        />
        <Divider theme={theme} />
        <RawRow
          theme={theme}
          label="Wallet record"
          hint={wallet ? "On-device wallet data (no secrets)" : "No wallet"}
          disabled={!wallet}
          onPress={copyWalletMetadataJson}
        />
        <Divider theme={theme} />
        <RawRow
          theme={theme}
          label="App state"
          hint="Everything Trixie persists — passwords are redacted"
          onPress={copyAppStateJson}
        />
      </View>
    </ScrollView>
  );
}

function StatusPill({
  status,
  serverInfo,
  theme,
}: {
  status: ServerStatus;
  serverInfo: ArkadeServerInfo | null;
  theme: AppTheme;
}) {
  const tone =
    status === "online"
      ? theme.colors.success
      : status === "offline"
        ? theme.colors.danger
        : status === "connecting"
          ? theme.colors.primary
          : theme.colors.textSubtle;

  let text: string;
  if (status === "online" && serverInfo) {
    const parts = ["Online", serverInfo.network];
    if (serverInfo.version) parts.push(`v${serverInfo.version}`);
    text = parts.join(" · ");
  } else if (status === "online") {
    text = "Online";
  } else if (status === "connecting") {
    text = "Connecting…";
  } else if (status === "offline") {
    text = "Offline";
  } else {
    text = "Not checked";
  }

  return (
    <View style={[styles.pill, { backgroundColor: `${tone}15` }]}>
      <View style={[styles.pillDot, { backgroundColor: tone }]} />
      <Text style={[styles.pillText, { color: tone }]} numberOfLines={1}>
        {text}
      </Text>
    </View>
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
  onCopy,
}: {
  theme: AppTheme;
  label: string;
  value: string;
  mono?: boolean;
  truncate?: boolean;
  last?: boolean;
  onCopy?: () => void;
}) {
  return (
    <>
      <View style={styles.detailRow}>
        <Text style={[styles.detailLabel, { color: theme.colors.textMuted }]}>
          {label}
        </Text>
        <View style={styles.detailValueWrap}>
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

function RuntimeRow({
  theme,
  label,
  value,
  tone = "default",
  hint,
}: {
  theme: AppTheme;
  label: string;
  value: string;
  tone?: "default" | "muted" | "danger";
  hint?: string;
}) {
  const valueColor =
    tone === "danger"
      ? theme.colors.danger
      : tone === "muted"
        ? theme.colors.textSubtle
        : theme.colors.text;
  return (
    <View style={styles.runtimeRow}>
      <View style={styles.runtimeHead}>
        <Text style={[styles.runtimeLabel, { color: theme.colors.text }]}>
          {label}
        </Text>
        <View
          style={[
            styles.runtimeValueWrap,
            { backgroundColor: theme.colors.surfaceSubtle },
          ]}
        >
          <Text style={[styles.runtimeValue, { color: valueColor }]}>
            {value}
          </Text>
        </View>
      </View>
      {hint ? (
        <Text style={[styles.runtimeHint, { color: theme.colors.textSubtle }]}>
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

function RawRow({
  theme,
  label,
  hint,
  busy,
  disabled,
  onPress,
}: {
  theme: AppTheme;
  label: string;
  hint: string;
  busy?: boolean;
  disabled?: boolean;
  onPress: () => void | Promise<void>;
}) {
  const isInert = disabled || busy;
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
          {hint}
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
  card: {
    padding: spacing[4],
    borderRadius: radius.md,
    borderWidth: 1,
  },
  cardFlush: {
    borderRadius: radius.md,
    borderWidth: 1,
    overflow: "hidden",
  },
  label: {
    fontSize: typography.size.xs,
    fontWeight: typography.weight.semibold,
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  input: {
    fontSize: typography.size.md,
    paddingVertical: spacing[3],
    paddingHorizontal: spacing[4],
    borderRadius: radius.sm,
    borderWidth: 1,
    marginTop: spacing[2],
  },
  hint: {
    fontSize: typography.size.xs,
    marginTop: spacing[2],
  },
  pillRow: {
    flexDirection: "row",
    marginTop: spacing[4],
  },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    borderRadius: radius.pill,
    maxWidth: "100%",
  },
  pillDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  pillText: {
    fontSize: typography.size.xs,
    fontWeight: typography.weight.semibold,
    letterSpacing: 0.2,
  },
  errorText: {
    fontSize: typography.size.xs,
    marginTop: spacing[3],
  },
  actions: {
    marginTop: spacing[5],
  },
  testBtn: {
    marginTop: spacing[3],
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
  detailValue: {
    flexShrink: 1,
    fontSize: typography.size.sm,
    textAlign: "right",
  },
  runtimeRow: {
    paddingVertical: spacing[4],
    paddingHorizontal: spacing[4],
  },
  runtimeHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing[3],
  },
  runtimeLabel: {
    fontSize: typography.size.md,
    fontWeight: typography.weight.semibold,
  },
  runtimeValueWrap: {
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[1],
    borderRadius: radius.pill,
  },
  runtimeValue: {
    fontSize: typography.size.xs,
    fontWeight: typography.weight.semibold,
    letterSpacing: 0.3,
    textTransform: "uppercase",
  },
  runtimeHint: {
    fontSize: typography.size.xs,
    marginTop: spacing[2],
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
});
