import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  Download,
  Eye,
  EyeOff,
  Share2,
  ShieldCheck,
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
import { SafeAreaView } from "react-native-safe-area-context";
import Button from "../components/Button";
import LoadingOverlay from "../components/LoadingOverlay";
import { useToast } from "../components/ToastProvider";
import { useResolvedTheme } from "../hooks/useResolvedTheme";
import { privateKeyHexToNsec } from "../services/arkade/identity";
import { readSecret, type StoredSecret } from "../services/arkade/secret-store";
import { BackupError } from "../services/backup/crypto";
import { saveBackupFile, shareBackupFile } from "../services/backup/storage";
import { type BackupHealth, useAppStore } from "../store/useAppStore";
import { radius, spacing, typography } from "../theme/theme";

type ExportPhase =
  | "idle"
  | "form"
  | "encrypting"
  | "dispatch"
  | "saving"
  | "sharing";

type PreparedBackup = { uri: string; filename: string; createdAt: number };

type HealthStatus = "never" | "stale" | "fresh" | "no-material";

function statusForHealth(health: BackupHealth | null): HealthStatus {
  if (!health) return "never";
  // `isStale` already encodes the "current material was modified since
  // last export" case; check it before `!hasBackupMaterial` so that
  // forgetting the last imported asset (which empties material but leaves
  // a stale prior backup) still surfaces the warning.
  if (health.isStale) return health.lastBackupAt == null ? "never" : "stale";
  if (!health.hasBackupMaterial && health.lastBackupAt == null) return "never";
  if (!health.hasBackupMaterial) return "no-material";
  return "fresh";
}

function formatLastBackup(ts: number | null): string {
  if (ts == null) return "Never";
  const diff = Date.now() - ts;
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(ts).toLocaleDateString();
}

function backupTextForSecret(secret: StoredSecret): string | null {
  if (secret.kind === "mnemonic") return secret.mnemonic;
  try {
    return privateKeyHexToNsec(secret.privateKeyHex);
  } catch {
    return null;
  }
}

export default function ProfileBackup() {
  const theme = useResolvedTheme();
  const wallet = useAppStore((s) => s.wallet);
  const getBackupHealth = useAppStore((s) => s.getBackupHealth);
  const lastBackupAt = useAppStore((s) => s.security.lastBackupAt ?? null);
  const dirtyForBackup = useAppStore((s) => s.security.dirtyForBackup === true);
  const { showToast } = useToast();

  const [revealed, setRevealed] = React.useState(false);
  const [secret, setSecret] = React.useState<StoredSecret | null>(null);
  const [revealLoading, setRevealLoading] = React.useState(false);
  const [revealError, setRevealError] = React.useState<string | null>(null);

  const [exportPhase, setExportPhase] = React.useState<ExportPhase>("idle");
  const [password, setPassword] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [exportError, setExportError] = React.useState<string | null>(null);
  const [prepared, setPrepared] = React.useState<PreparedBackup | null>(null);

  const [health, setHealth] = React.useState<BackupHealth | null>(null);

  const exportBackup = useAppStore((s) => s.exportBackup);
  const markBackupCompleted = useAppStore((s) => s.markBackupCompleted);
  const discardBackupTempFile = useAppStore((s) => s.discardBackupTempFile);

  // Re-fetch health whenever the dirty flag flips, the timestamp changes, or
  // we navigate back to this screen after an export. Cheap query, runs off
  // SQLite locally.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-run on state change signals
  React.useEffect(() => {
    let cancelled = false;
    getBackupHealth()
      .then((h) => {
        if (!cancelled) setHealth(h);
      })
      .catch(() => {
        if (!cancelled) setHealth(null);
      });
    return () => {
      cancelled = true;
    };
  }, [getBackupHealth, lastBackupAt, dirtyForBackup, exportPhase]);

  async function handleReveal() {
    if (!wallet) return;
    if (revealed) {
      setRevealed(false);
      return;
    }
    setRevealLoading(true);
    setRevealError(null);
    try {
      const s = await readSecret(wallet.id);
      setSecret(s);
      setRevealed(true);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not read secret";
      setRevealError(msg);
      showToast(msg, "error");
    } finally {
      setRevealLoading(false);
    }
  }

  async function handleCopy(text: string, label: string) {
    try {
      await Clipboard.setStringAsync(text);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      showToast(`${label} copied`, "success");
    } catch {
      showToast("Could not copy", "error");
    }
  }

  function startExport() {
    setExportError(null);
    setPassword("");
    setConfirm("");
    setExportPhase("form");
  }

  function cancelExport() {
    if (prepared) {
      discardBackupTempFile(prepared.uri);
      setPrepared(null);
    }
    setExportPhase("idle");
    setPassword("");
    setConfirm("");
    setExportError(null);
  }

  async function submitExport() {
    if (password.length < 8) {
      setExportError("Password must be at least 8 characters");
      return;
    }
    if (password !== confirm) {
      setExportError("Passwords do not match");
      return;
    }
    setExportError(null);
    setExportPhase("encrypting");
    // Yield one event-loop tick so React paints the LoadingOverlay before
    // we kick off pbkdf2Async, which runs ~10ms of synchronous JS before
    // its first internal yield. Without this, the button looks frozen for
    // the entire encrypt cycle on slow devices and the emulator.
    await new Promise((r) => setTimeout(r, 0));
    try {
      const result = await exportBackup(password);
      setPrepared(result);
      setPassword("");
      setConfirm("");
      setExportPhase("dispatch");
    } catch (e) {
      const msg =
        e instanceof BackupError
          ? e.message
          : e instanceof Error
            ? e.message
            : "Failed to export backup";
      setExportError(msg);
      setExportPhase("form");
    }
  }

  async function handleSave() {
    if (!prepared) return;
    setExportPhase("saving");
    try {
      const result = await saveBackupFile({
        sourceUri: prepared.uri,
        filename: prepared.filename,
      });
      if (result.kind === "cancelled") {
        setExportPhase("dispatch");
        return;
      }
      await markBackupCompleted(prepared.createdAt);
      discardBackupTempFile(prepared.uri);
      setPrepared(null);
      setExportPhase("idle");
      showToast("Backup saved", "success");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not save backup";
      showToast(msg, "error");
      setExportPhase("dispatch");
    }
  }

  async function handleShare() {
    if (!prepared) return;
    setExportPhase("sharing");
    try {
      await shareBackupFile(prepared.uri);
      // The OS share-sheet doesn't tell us whether the user actually saved
      // anything, but resolving means the sheet was dismissed without an
      // error. Treat that as a successful dispatch — same trade-off the
      // existing share-only path took.
      await markBackupCompleted(prepared.createdAt);
      discardBackupTempFile(prepared.uri);
      setPrepared(null);
      setExportPhase("idle");
      showToast("Backup shared", "success");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not share backup";
      showToast(msg, "error");
      setExportPhase("dispatch");
    }
  }

  function discardPrepared() {
    if (prepared) {
      discardBackupTempFile(prepared.uri);
      setPrepared(null);
    }
    setExportPhase("idle");
  }

  const status = statusForHealth(health);
  const kindLabel =
    wallet?.identityKind === "mnemonic" ? "Seed phrase" : "Private key (nsec)";
  const backupText = secret ? backupTextForSecret(secret) : null;

  return (
    <SafeAreaView
      edges={["bottom"]}
      style={[styles.container, { backgroundColor: theme.colors.background }]}
    >
      <ScrollView contentContainerStyle={styles.content}>
        {/* — Encrypted backup file — */}
        <View style={styles.section}>
          <Text
            style={[styles.sectionTitle, { color: theme.colors.textMuted }]}
          >
            Encrypted backup file
          </Text>
          <View
            style={[
              styles.card,
              {
                backgroundColor: theme.colors.card,
                ...theme.shadow("card"),
              },
            ]}
          >
            <Text style={[styles.cardBody, { color: theme.colors.text }]}>
              Saves an encrypted backup of your wallet, swap state, and
              preferences. Restore it on another device with the password you
              choose here.
            </Text>

            <View style={styles.metaRow}>
              <Text
                style={[styles.metaLabel, { color: theme.colors.textMuted }]}
              >
                Last backup
              </Text>
              <Text style={[styles.metaValue, { color: theme.colors.text }]}>
                {formatLastBackup(lastBackupAt)}
              </Text>
            </View>

            <StatusPill status={status} theme={theme} />

            {exportPhase === "idle" ? (
              <Button
                label="Export backup"
                theme={theme}
                onPress={startExport}
                disabled={!wallet}
                style={styles.exportBtn}
              />
            ) : null}

            {exportPhase === "form" || exportPhase === "encrypting" ? (
              <View style={styles.form}>
                <Text style={[styles.formLabel, { color: theme.colors.text }]}>
                  Choose a password (min 8 characters)
                </Text>
                <Text
                  style={[styles.formHelp, { color: theme.colors.textMuted }]}
                >
                  Anyone with this file and password can access your funds.
                </Text>
                <View
                  style={[
                    styles.advisory,
                    { backgroundColor: `${theme.colors.warning}20` },
                  ]}
                >
                  <AlertTriangle color={theme.colors.warning} size={14} />
                  <Text
                    style={[styles.advisoryText, { color: theme.colors.text }]}
                  >
                    Encryption can take 5–15 seconds. Keep the app open until it
                    finishes.
                  </Text>
                </View>
                <TextInput
                  value={password}
                  onChangeText={(t) => {
                    setPassword(t);
                    setExportError(null);
                  }}
                  placeholder="Backup password"
                  placeholderTextColor={theme.colors.placeholder}
                  secureTextEntry
                  editable={exportPhase !== "encrypting"}
                  style={[
                    styles.input,
                    {
                      color: theme.colors.text,
                      backgroundColor: theme.colors.surfaceSubtle,
                      borderColor: exportError
                        ? theme.colors.danger
                        : theme.colors.border,
                    },
                  ]}
                />
                <TextInput
                  value={confirm}
                  onChangeText={(t) => {
                    setConfirm(t);
                    setExportError(null);
                  }}
                  placeholder="Confirm password"
                  placeholderTextColor={theme.colors.placeholder}
                  secureTextEntry
                  editable={exportPhase !== "encrypting"}
                  style={[
                    styles.input,
                    {
                      color: theme.colors.text,
                      backgroundColor: theme.colors.surfaceSubtle,
                      borderColor: exportError
                        ? theme.colors.danger
                        : theme.colors.border,
                      marginTop: spacing[2],
                    },
                  ]}
                />
                {exportError ? (
                  <Text style={[styles.error, { color: theme.colors.danger }]}>
                    {exportError}
                  </Text>
                ) : null}
                <View style={styles.formActions}>
                  <Button
                    label="Cancel"
                    variant="ghost"
                    theme={theme}
                    onPress={cancelExport}
                    disabled={exportPhase === "encrypting"}
                    style={styles.formActionBtn}
                  />
                  <Button
                    label="Encrypt"
                    theme={theme}
                    onPress={submitExport}
                    loading={exportPhase === "encrypting"}
                    disabled={exportPhase === "encrypting"}
                    style={styles.formActionBtn}
                  />
                </View>
              </View>
            ) : null}

            {exportPhase === "dispatch" ||
            exportPhase === "saving" ||
            exportPhase === "sharing" ? (
              <View style={styles.form}>
                <View
                  style={[
                    styles.preparedBanner,
                    { backgroundColor: `${theme.colors.success}20` },
                  ]}
                >
                  <CheckCircle2 color={theme.colors.success} size={16} />
                  <Text
                    style={[styles.preparedText, { color: theme.colors.text }]}
                  >
                    Backup encrypted. Save it to a folder on this device or
                    share it to another app.
                  </Text>
                </View>
                <View style={styles.dispatchActions}>
                  <Button
                    label="Save to device"
                    theme={theme}
                    onPress={handleSave}
                    loading={exportPhase === "saving"}
                    disabled={
                      exportPhase === "saving" || exportPhase === "sharing"
                    }
                    icon={<Download color={theme.colors.onPrimary} size={18} />}
                    style={styles.dispatchBtn}
                  />
                  <Button
                    label="Share"
                    variant="secondary"
                    theme={theme}
                    onPress={handleShare}
                    loading={exportPhase === "sharing"}
                    disabled={
                      exportPhase === "saving" || exportPhase === "sharing"
                    }
                    icon={<Share2 color={theme.colors.text} size={18} />}
                    style={styles.dispatchBtn}
                  />
                </View>
                <Pressable
                  onPress={discardPrepared}
                  disabled={
                    exportPhase === "saving" || exportPhase === "sharing"
                  }
                  style={styles.discardBtn}
                >
                  <Text
                    style={[
                      styles.discardText,
                      { color: theme.colors.textMuted },
                    ]}
                  >
                    Discard backup
                  </Text>
                </Pressable>
              </View>
            ) : null}
          </View>
        </View>

        {/* — Wallet keys (existing reveal-seed UI) — */}
        <View style={styles.section}>
          <Text
            style={[styles.sectionTitle, { color: theme.colors.textMuted }]}
          >
            Wallet keys
          </Text>
          <View
            style={[
              styles.warning,
              { backgroundColor: `${theme.colors.danger}15` },
            ]}
          >
            <AlertTriangle color={theme.colors.danger} size={20} />
            <Text style={[styles.warningText, { color: theme.colors.danger }]}>
              Keep this information secret. Anyone with these keys can access
              your funds.
            </Text>
          </View>

          <View style={styles.subSection}>
            <View style={styles.subSectionHeader}>
              <Text
                style={[
                  styles.subSectionTitle,
                  { color: theme.colors.textMuted },
                ]}
              >
                {kindLabel}
              </Text>
              <View style={styles.subSectionActions}>
                <Pressable onPress={handleReveal} disabled={revealLoading}>
                  {revealed ? (
                    <EyeOff color={theme.colors.textMuted} size={20} />
                  ) : (
                    <Eye color={theme.colors.textMuted} size={20} />
                  )}
                </Pressable>
                {revealed && secret ? (
                  <Pressable
                    onPress={() => handleCopy(backupText ?? "", kindLabel)}
                    disabled={!backupText}
                  >
                    <Copy color={theme.colors.textMuted} size={20} />
                  </Pressable>
                ) : null}
              </View>
            </View>
            <View
              style={[
                styles.valueBox,
                { backgroundColor: theme.colors.surfaceSubtle },
              ]}
            >
              {revealLoading ? (
                <ActivityIndicator color={theme.colors.primary} />
              ) : (
                <Text
                  style={[styles.valueText, { color: theme.colors.text }]}
                  selectable={revealed}
                >
                  {revealed && secret
                    ? (backupText ?? "Could not encode private key")
                    : "•".repeat(48)}
                </Text>
              )}
            </View>
            {revealError ? (
              <Text style={[styles.error, { color: theme.colors.danger }]}>
                {revealError}
              </Text>
            ) : null}
          </View>
        </View>

        {/* — Identifiers (existing) — */}
        {wallet ? (
          <View style={styles.section}>
            <Text
              style={[styles.sectionTitle, { color: theme.colors.textMuted }]}
            >
              Identifiers
            </Text>
            <View style={styles.subSection}>
              <Text
                style={[
                  styles.subSectionTitle,
                  { color: theme.colors.textMuted },
                ]}
              >
                Public key (compressed)
              </Text>
              <View
                style={[
                  styles.valueBox,
                  { backgroundColor: theme.colors.surfaceSubtle },
                ]}
              >
                <Text
                  style={[styles.valueText, { color: theme.colors.text }]}
                  selectable
                >
                  {wallet.publicKeyHex}
                </Text>
              </View>
            </View>
            <View style={styles.subSection}>
              <Text
                style={[
                  styles.subSectionTitle,
                  { color: theme.colors.textMuted },
                ]}
              >
                Arkade address
              </Text>
              <View
                style={[
                  styles.valueBox,
                  { backgroundColor: theme.colors.surfaceSubtle },
                ]}
              >
                <Text
                  style={[styles.valueText, { color: theme.colors.text }]}
                  selectable
                >
                  {wallet.arkAddress}
                </Text>
              </View>
            </View>
          </View>
        ) : null}
      </ScrollView>
      <LoadingOverlay
        visible={
          exportPhase === "encrypting" ||
          exportPhase === "saving" ||
          exportPhase === "sharing"
        }
        message={
          exportPhase === "encrypting"
            ? "Encrypting backup… keep the app open"
            : exportPhase === "saving"
              ? "Saving to device…"
              : "Opening share sheet…"
        }
        theme={theme}
      />
    </SafeAreaView>
  );
}

function StatusPill({
  status,
  theme,
}: {
  status: HealthStatus;
  theme: ReturnType<typeof useResolvedTheme>;
}) {
  if (status === "no-material") {
    return (
      <View
        style={[
          styles.pill,
          { backgroundColor: `${theme.colors.textMuted}20` },
        ]}
      >
        <Text style={[styles.pillText, { color: theme.colors.textMuted }]}>
          Nothing to back up yet
        </Text>
      </View>
    );
  }
  if (status === "fresh") {
    return (
      <View
        style={[styles.pill, { backgroundColor: `${theme.colors.success}25` }]}
      >
        <CheckCircle2 color={theme.colors.success} size={14} />
        <Text style={[styles.pillText, { color: theme.colors.success }]}>
          Up to date
        </Text>
      </View>
    );
  }
  if (status === "stale") {
    return (
      <View
        style={[styles.pill, { backgroundColor: `${theme.colors.warning}25` }]}
      >
        <AlertTriangle color={theme.colors.warning} size={14} />
        <Text style={[styles.pillText, { color: theme.colors.warning }]}>
          Outdated
        </Text>
      </View>
    );
  }
  return (
    <View
      style={[styles.pill, { backgroundColor: `${theme.colors.warning}25` }]}
    >
      <ShieldCheck color={theme.colors.warning} size={14} />
      <Text style={[styles.pillText, { color: theme.colors.warning }]}>
        Never backed up
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: spacing[5],
    paddingBottom: spacing[10],
    gap: spacing[5],
  },
  section: {
    gap: spacing[3],
  },
  sectionTitle: {
    fontSize: typography.size.xs,
    fontWeight: typography.weight.semibold,
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  card: {
    padding: spacing[4],
    borderRadius: radius.lg,
    gap: spacing[3],
  },
  cardBody: {
    fontSize: typography.size.sm,
    lineHeight: typography.lineHeight.sm,
  },
  metaRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  metaLabel: {
    fontSize: typography.size.xs,
  },
  metaValue: {
    fontSize: typography.size.sm,
    fontWeight: typography.weight.medium,
  },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: spacing[1],
    paddingVertical: spacing[1],
    paddingHorizontal: spacing[3],
    borderRadius: radius.pill,
  },
  pillText: {
    fontSize: typography.size.xs,
    fontWeight: typography.weight.semibold,
  },
  exportBtn: {
    marginTop: spacing[2],
  },
  form: {
    marginTop: spacing[2],
    gap: spacing[1],
  },
  formLabel: {
    fontSize: typography.size.sm,
    fontWeight: typography.weight.semibold,
    marginTop: spacing[2],
  },
  formHelp: {
    fontSize: typography.size.xs,
    marginBottom: spacing[2],
    lineHeight: typography.lineHeight.xs,
  },
  input: {
    fontSize: typography.size.md,
    paddingVertical: spacing[3],
    paddingHorizontal: spacing[4],
    borderRadius: radius.sm,
    borderWidth: 1,
  },
  formActions: {
    flexDirection: "row",
    gap: spacing[2],
    marginTop: spacing[3],
  },
  formActionBtn: {
    flex: 1,
  },
  advisory: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing[2],
    padding: spacing[3],
    borderRadius: radius.sm,
    marginBottom: spacing[2],
  },
  advisoryText: {
    flex: 1,
    fontSize: typography.size.xs,
    lineHeight: typography.lineHeight.xs,
  },
  preparedBanner: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing[2],
    padding: spacing[3],
    borderRadius: radius.sm,
    marginTop: spacing[2],
  },
  preparedText: {
    flex: 1,
    fontSize: typography.size.sm,
    lineHeight: typography.lineHeight.sm,
  },
  dispatchActions: {
    gap: spacing[2],
    marginTop: spacing[3],
  },
  dispatchBtn: {
    width: "100%",
  },
  discardBtn: {
    alignSelf: "center",
    marginTop: spacing[2],
    padding: spacing[2],
  },
  discardText: {
    fontSize: typography.size.xs,
  },
  warning: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing[2],
    padding: spacing[4],
    borderRadius: radius.sm,
  },
  warningText: {
    flex: 1,
    fontSize: typography.size.sm,
    fontWeight: typography.weight.medium,
    lineHeight: typography.lineHeight.sm,
  },
  subSection: {
    gap: spacing[2],
  },
  subSectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  subSectionTitle: {
    fontSize: typography.size.xs,
    fontWeight: typography.weight.semibold,
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  subSectionActions: {
    flexDirection: "row",
    gap: spacing[3],
  },
  valueBox: {
    padding: spacing[4],
    borderRadius: radius.sm,
    minHeight: 56,
    justifyContent: "center",
  },
  valueText: {
    fontSize: typography.size.sm,
    fontFamily: typography.fontFamily.mono,
    lineHeight: typography.lineHeight.sm,
  },
  error: {
    fontSize: typography.size.xs,
    marginTop: spacing[2],
  },
});
