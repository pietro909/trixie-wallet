import { type RouteProp, useFocusEffect } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import {
  ChevronDown,
  ChevronRight,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  Pencil,
  ShieldCheck,
} from "lucide-react-native";
import * as React from "react";
import {
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import AuthGate from "../../components/AuthGate";
import Button from "../../components/Button";
import { useToast } from "../../components/ToastProvider";
import { useResolvedTheme } from "../../hooks/useResolvedTheme";
import type { RootStackParamList } from "../../navigation/RootStack";
import { explorerUrl } from "../../services/activity-details/explorer";
import type { ContractSummary } from "../../services/arkade/contracts";
import { ArkadeError } from "../../services/arkade/errors";
import { useAppStore } from "../../store/useAppStore";
import { type AppTheme, radius, spacing, typography } from "../../theme/theme";

type Nav = NativeStackNavigationProp<RootStackParamList, "ContractDetail">;
type Route = RouteProp<RootStackParamList, "ContractDetail">;

const PARAM_LABELS: Record<string, string> = {
  pubKey: "Your Public Key",
  serverPubKey: "Server Public Key",
  delegatePubKey: "Delegate Public Key",
  csvTimelock: "CSV Timelock",
};

function paramLabel(key: string): string {
  if (PARAM_LABELS[key]) return PARAM_LABELS[key];
  const spaced = key.replace(/([A-Z])/g, " $1").trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(ts).toLocaleDateString();
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

function truncateScript(script: string): string {
  if (script.length <= 24) return script;
  return `${script.slice(0, 12)}…${script.slice(-12)}`;
}

export default function ContractDetailScreen(props: {
  route: Route;
  navigation: Nav;
}): React.ReactElement {
  const { script } = props.route.params;
  const theme = useResolvedTheme();
  const { showToast } = useToast();
  const network = useAppStore(
    (s) => s.network.detectedNetwork ?? s.wallet?.network ?? null,
  );
  const loadWalletContractSummaries = useAppStore(
    (s) => s.loadWalletContractSummaries,
  );
  const loadWalletContractParams = useAppStore(
    (s) => s.loadWalletContractParams,
  );
  const updateWalletContractLabel = useAppStore(
    (s) => s.updateWalletContractLabel,
  );

  const [summary, setSummary] = React.useState<ContractSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = React.useState(true);
  const [summaryError, setSummaryError] = React.useState<string | null>(null);

  const [authVisible, setAuthVisible] = React.useState(false);
  const [authAction, setAuthAction] = React.useState<{
    run: () => void | Promise<void>;
  } | null>(null);
  const [params, setParams] = React.useState<Record<string, string> | null>(
    null,
  );
  const [paramsLoading, setParamsLoading] = React.useState(false);

  const [editingLabel, setEditingLabel] = React.useState(false);
  const [labelDraft, setLabelDraft] = React.useState("");
  const [labelSaving, setLabelSaving] = React.useState(false);

  const [metadataExpanded, setMetadataExpanded] = React.useState(false);

  function requestAuth(onSuccess: () => void | Promise<void>) {
    setAuthAction({ run: onSuccess });
    setAuthVisible(true);
  }

  const refreshSummary = React.useCallback(async () => {
    setSummaryLoading(true);
    try {
      const rows = await loadWalletContractSummaries();
      const found = rows.find((r) => r.script === script);
      if (!found) {
        setSummary(null);
        setSummaryError("Contract not found");
        return;
      }
      setSummary(found);
      setSummaryError(null);
    } catch (e) {
      const msg =
        e instanceof ArkadeError
          ? e.message
          : e instanceof Error
            ? e.message
            : "Failed to load contract";
      setSummaryError(msg);
    } finally {
      setSummaryLoading(false);
    }
  }, [loadWalletContractSummaries, script]);

  useFocusEffect(
    React.useCallback(() => {
      void refreshSummary();
      // Clear the sensitive params + any edit-in-flight state on blur. Bytes
      // never outlive an active AuthGate session — re-revealing re-fetches
      // from the SDK.
      return () => {
        setParams(null);
        setParamsLoading(false);
      };
    }, [refreshSummary]),
  );

  async function handleCopy(text: string, label: string) {
    try {
      await Clipboard.setStringAsync(text);
      Haptics.selectionAsync().catch(() => {});
      showToast(`${label} copied`, "success");
    } catch {
      showToast("Could not copy", "error");
    }
  }

  async function handleOpenExplorer() {
    if (!summary) return;
    const url = explorerUrl("arkade_address", summary.address, network);
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
  }

  function handleReveal() {
    if (params) {
      setParams(null);
      return;
    }
    requestAuth(async () => {
      setParamsLoading(true);
      try {
        const fresh = await loadWalletContractParams(script);
        setParams(fresh);
      } catch (e) {
        const msg =
          e instanceof ArkadeError
            ? e.message
            : e instanceof Error
              ? e.message
              : "Could not load params";
        showToast(msg, "error");
      } finally {
        setParamsLoading(false);
      }
    });
  }

  function startEditLabel() {
    if (!summary) return;
    setLabelDraft(summary.label ?? "");
    setEditingLabel(true);
  }

  function cancelEditLabel() {
    setLabelDraft("");
    setEditingLabel(false);
  }

  async function saveLabel() {
    if (!summary) return;
    setLabelSaving(true);
    try {
      await updateWalletContractLabel(script, labelDraft);
      await refreshSummary();
      setEditingLabel(false);
      setLabelDraft("");
      showToast("Label saved", "success");
    } catch (e) {
      const msg =
        e instanceof ArkadeError
          ? e.message
          : e instanceof Error
            ? e.message
            : "Could not save label";
      showToast(msg, "error");
    } finally {
      setLabelSaving(false);
    }
  }

  if (summaryLoading && !summary && !summaryError) {
    return (
      <SafeAreaView
        edges={["bottom"]}
        style={[styles.empty, { backgroundColor: theme.colors.background }]}
      >
        <Text style={[styles.emptyText, { color: theme.colors.textMuted }]}>
          Loading contract…
        </Text>
      </SafeAreaView>
    );
  }

  if (summaryError && !summary) {
    return (
      <SafeAreaView
        edges={["bottom"]}
        style={[styles.errorBox, { backgroundColor: theme.colors.background }]}
      >
        <Text style={[styles.errorTitle, { color: theme.colors.text }]}>
          Couldn't load contract
        </Text>
        <Text style={[styles.errorBody, { color: theme.colors.textMuted }]}>
          {summaryError}
        </Text>
        <Button
          label="Retry"
          theme={theme}
          onPress={() => {
            void refreshSummary();
          }}
        />
      </SafeAreaView>
    );
  }

  if (!summary) return <View />;

  const tp = typePillVisual(summary.type, theme);
  const sp = statePillVisual(summary.state, theme);
  const hasMetadata =
    !!summary.metadata && Object.keys(summary.metadata).length > 0;

  return (
    <SafeAreaView
      edges={["bottom"]}
      style={[styles.container, { backgroundColor: theme.colors.background }]}
    >
      <ScrollView contentContainerStyle={styles.content}>
        {/* Header */}
        <View style={styles.pillRow}>
          <View style={[styles.pill, { backgroundColor: tp.bg }]}>
            <Text style={[styles.pillText, { color: tp.fg }]}>
              {typeLabel(summary.type)}
            </Text>
          </View>
          <View style={[styles.pill, { backgroundColor: sp.bg }]}>
            <Text style={[styles.pillText, { color: sp.fg }]}>
              {stateLabel(summary.state)}
            </Text>
          </View>
        </View>

        {/* Label */}
        <View style={styles.section}>
          <Text
            style={[styles.sectionTitle, { color: theme.colors.textMuted }]}
          >
            Label
          </Text>
          {editingLabel ? (
            <View style={styles.labelEdit}>
              <TextInput
                value={labelDraft}
                onChangeText={setLabelDraft}
                placeholder="Add a label"
                placeholderTextColor={theme.colors.placeholder}
                editable={!labelSaving}
                autoFocus
                style={[
                  styles.input,
                  {
                    color: theme.colors.text,
                    backgroundColor: theme.colors.surfaceSubtle,
                    borderColor: theme.colors.border,
                  },
                ]}
              />
              <View style={styles.labelActions}>
                <Button
                  label="Cancel"
                  variant="ghost"
                  theme={theme}
                  onPress={cancelEditLabel}
                  disabled={labelSaving}
                  style={styles.labelBtn}
                />
                <Button
                  label="Save"
                  theme={theme}
                  onPress={() => {
                    void saveLabel();
                  }}
                  loading={labelSaving}
                  disabled={labelSaving}
                  style={styles.labelBtn}
                />
              </View>
            </View>
          ) : (
            <Pressable
              onPress={startEditLabel}
              style={({ pressed }) => [
                styles.valueRow,
                {
                  backgroundColor: theme.colors.surfaceSubtle,
                  opacity: pressed ? 0.7 : 1,
                },
              ]}
              accessibilityRole="button"
              accessibilityLabel={summary.label ? "Edit label" : "Add label"}
            >
              <Text
                style={[
                  styles.labelValue,
                  {
                    color: summary.label
                      ? theme.colors.text
                      : theme.colors.textSubtle,
                    fontStyle: summary.label ? "normal" : "italic",
                  },
                ]}
                numberOfLines={1}
              >
                {summary.label ?? "Tap to add label"}
              </Text>
              <Pencil color={theme.colors.textMuted} size={16} />
            </Pressable>
          )}
        </View>

        {/* Address */}
        <View style={styles.section}>
          <Text
            style={[styles.sectionTitle, { color: theme.colors.textMuted }]}
          >
            Address
          </Text>
          <View
            style={[
              styles.valueRow,
              { backgroundColor: theme.colors.surfaceSubtle },
            ]}
          >
            <Text
              style={[styles.mono, { color: theme.colors.text }]}
              numberOfLines={1}
              ellipsizeMode="middle"
              selectable
            >
              {summary.address}
            </Text>
            <Pressable
              onPress={() => {
                void handleCopy(summary.address, "Address");
              }}
              hitSlop={8}
              style={styles.iconBtn}
              accessibilityLabel="Copy address"
              accessibilityRole="button"
            >
              <Copy color={theme.colors.textMuted} size={16} />
            </Pressable>
          </View>
        </View>

        {/* Script */}
        <View style={styles.section}>
          <Text
            style={[styles.sectionTitle, { color: theme.colors.textMuted }]}
          >
            Script
          </Text>
          <View
            style={[
              styles.valueRow,
              { backgroundColor: theme.colors.surfaceSubtle },
            ]}
          >
            <Text
              style={[styles.mono, { color: theme.colors.text }]}
              numberOfLines={1}
              selectable
            >
              {truncateScript(summary.script)}
            </Text>
            <Pressable
              onPress={() => {
                void handleCopy(summary.script, "Script");
              }}
              hitSlop={8}
              style={styles.iconBtn}
              accessibilityLabel="Copy script"
              accessibilityRole="button"
            >
              <Copy color={theme.colors.textMuted} size={16} />
            </Pressable>
          </View>
        </View>

        {/* Created at */}
        <View style={styles.section}>
          <Text
            style={[styles.sectionTitle, { color: theme.colors.textMuted }]}
          >
            Created
          </Text>
          <Text style={[styles.bodyText, { color: theme.colors.text }]}>
            {relativeTime(summary.createdAt)}
          </Text>
        </View>

        {/* Params */}
        <View style={styles.section}>
          <Text
            style={[styles.sectionTitle, { color: theme.colors.textMuted }]}
          >
            Parameters
          </Text>
          {params == null ? (
            <View
              style={[
                styles.lockedBox,
                { backgroundColor: theme.colors.surfaceSubtle },
              ]}
            >
              <ShieldCheck color={theme.colors.primary} size={20} />
              <Text
                style={[styles.lockedText, { color: theme.colors.textMuted }]}
              >
                Parameters include sensitive material. Authorize to view.
              </Text>
              <Button
                label="Reveal"
                theme={theme}
                onPress={handleReveal}
                loading={paramsLoading}
                disabled={paramsLoading}
                icon={<Eye color={theme.colors.onPrimary} size={16} />}
                style={styles.revealBtn}
              />
            </View>
          ) : (
            <View style={styles.paramsBox}>
              {Object.entries(params).map(([key, value]) => (
                <View key={key} style={styles.paramRow}>
                  <Text
                    style={[
                      styles.paramLabel,
                      { color: theme.colors.textMuted },
                    ]}
                  >
                    {paramLabel(key)}
                  </Text>
                  <View
                    style={[
                      styles.valueRow,
                      { backgroundColor: theme.colors.surfaceSubtle },
                    ]}
                  >
                    <Text
                      style={[styles.mono, { color: theme.colors.text }]}
                      numberOfLines={1}
                      ellipsizeMode="middle"
                      selectable
                    >
                      {value}
                    </Text>
                    <Pressable
                      onPress={() => {
                        void handleCopy(value, paramLabel(key));
                      }}
                      hitSlop={8}
                      style={styles.iconBtn}
                      accessibilityLabel={`Copy ${paramLabel(key)}`}
                      accessibilityRole="button"
                    >
                      <Copy color={theme.colors.textMuted} size={16} />
                    </Pressable>
                  </View>
                </View>
              ))}
              <Button
                label="Hide"
                variant="ghost"
                theme={theme}
                onPress={handleReveal}
                icon={<EyeOff color={theme.colors.text} size={16} />}
                style={styles.hideBtn}
              />
            </View>
          )}
        </View>

        {/* Metadata */}
        {hasMetadata ? (
          <View style={styles.section}>
            <Pressable
              onPress={() => setMetadataExpanded((v) => !v)}
              style={styles.metadataHeader}
              accessibilityRole="button"
              accessibilityState={{ expanded: metadataExpanded }}
            >
              {metadataExpanded ? (
                <ChevronDown color={theme.colors.textMuted} size={18} />
              ) : (
                <ChevronRight color={theme.colors.textMuted} size={18} />
              )}
              <Text
                style={[styles.sectionTitle, { color: theme.colors.textMuted }]}
              >
                Metadata
              </Text>
            </Pressable>
            {metadataExpanded ? (
              <View
                style={[
                  styles.metadataBox,
                  { backgroundColor: theme.colors.surfaceSubtle },
                ]}
              >
                <Text
                  style={[styles.mono, { color: theme.colors.text }]}
                  selectable
                >
                  {JSON.stringify(summary.metadata, null, 2)}
                </Text>
              </View>
            ) : null}
          </View>
        ) : null}

        {/* Explorer */}
        <Button
          label="View in Explorer"
          variant="secondary"
          theme={theme}
          onPress={() => {
            void handleOpenExplorer();
          }}
          icon={<ExternalLink color={theme.colors.text} size={16} />}
          style={styles.explorerBtn}
        />
      </ScrollView>

      <AuthGate
        visible={authVisible}
        title="Reveal Contract Parameters"
        message="Authorize to view this contract's sensitive parameters."
        onSuccess={() => {
          setAuthVisible(false);
          if (authAction) {
            void authAction.run();
          }
        }}
        onCancel={() => {
          setAuthVisible(false);
          setAuthAction(null);
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: spacing[5],
    paddingBottom: spacing[10],
    gap: spacing[4],
  },
  pillRow: {
    flexDirection: "row",
    gap: spacing[2],
  },
  section: {
    gap: spacing[2],
  },
  sectionTitle: {
    fontSize: typography.size.xs,
    fontWeight: typography.weight.semibold,
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  pill: {
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[1],
    borderRadius: radius.pill,
  },
  pillText: {
    fontSize: typography.size.xs,
    fontWeight: typography.weight.semibold,
  },
  valueRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[3],
    borderRadius: radius.sm,
  },
  mono: {
    flex: 1,
    fontFamily: typography.fontFamily.mono,
    fontSize: typography.size.sm,
  },
  labelValue: {
    flex: 1,
    fontSize: typography.size.md,
  },
  bodyText: {
    fontSize: typography.size.sm,
  },
  iconBtn: {
    width: 32,
    height: 32,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  labelEdit: {
    gap: spacing[2],
  },
  input: {
    fontSize: typography.size.md,
    paddingVertical: spacing[3],
    paddingHorizontal: spacing[4],
    borderRadius: radius.sm,
    borderWidth: 1,
  },
  labelActions: {
    flexDirection: "row",
    gap: spacing[2],
  },
  labelBtn: {
    flex: 1,
  },
  lockedBox: {
    padding: spacing[4],
    borderRadius: radius.md,
    alignItems: "center",
    gap: spacing[3],
  },
  lockedText: {
    fontSize: typography.size.sm,
    textAlign: "center",
    lineHeight: typography.lineHeight.sm,
  },
  revealBtn: {
    alignSelf: "stretch",
  },
  paramsBox: {
    gap: spacing[3],
  },
  paramRow: {
    gap: spacing[1],
  },
  paramLabel: {
    fontSize: typography.size.xs,
    fontWeight: typography.weight.medium,
  },
  hideBtn: {
    alignSelf: "stretch",
  },
  metadataHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
  },
  metadataBox: {
    padding: spacing[3],
    borderRadius: radius.sm,
  },
  explorerBtn: {
    alignSelf: "stretch",
    marginTop: spacing[2],
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
