import * as React from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { AlertTriangle, Copy, Eye, EyeOff } from "lucide-react-native";
import * as Haptics from "expo-haptics";
import * as Clipboard from "expo-clipboard";
import { useResolvedTheme } from "../hooks/useResolvedTheme";
import { useAppStore } from "../store/useAppStore";
import { useToast } from "../components/ToastProvider";
import { readSecret } from "../services/arkade/secret-store";
import type { StoredSecret } from "../services/arkade/secret-store";
import { spacing, typography, radius } from "../theme/theme";

export default function ProfileBackup() {
  const theme = useResolvedTheme();
  const wallet = useAppStore((s) => s.wallet);
  const { showToast } = useToast();
  const [revealed, setRevealed] = React.useState(false);
  const [secret, setSecret] = React.useState<StoredSecret | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function handleReveal() {
    if (!wallet) return;
    if (revealed) {
      setRevealed(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const s = await readSecret(wallet.id);
      setSecret(s);
      setRevealed(true);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not read secret";
      setError(msg);
      showToast(msg, "error");
    } finally {
      setLoading(false);
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

  const kindLabel =
    wallet?.identityKind === "mnemonic" ? "Seed phrase" : "Private key (hex)";

  return (
    <SafeAreaView
      edges={["bottom"]}
      style={[styles.container, { backgroundColor: theme.colors.background }]}
    >
      <View
        style={[styles.warning, { backgroundColor: `${theme.colors.danger}15` }]}
      >
        <AlertTriangle color={theme.colors.danger} size={20} />
        <Text style={[styles.warningText, { color: theme.colors.danger }]}>
          Keep this information secret. Anyone with these keys can access your
          funds.
        </Text>
      </View>

      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, { color: theme.colors.textMuted }]}>
            {kindLabel}
          </Text>
          <View style={styles.sectionActions}>
            <Pressable onPress={handleReveal} disabled={loading}>
              {revealed ? (
                <EyeOff color={theme.colors.textMuted} size={20} />
              ) : (
                <Eye color={theme.colors.textMuted} size={20} />
              )}
            </Pressable>
            {revealed && secret ? (
              <Pressable
                onPress={() =>
                  handleCopy(
                    secret.kind === "mnemonic"
                      ? secret.mnemonic
                      : secret.privateKeyHex,
                    kindLabel,
                  )
                }
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
          {loading ? (
            <ActivityIndicator color={theme.colors.primary} />
          ) : (
            <Text
              style={[styles.valueText, { color: theme.colors.text }]}
              selectable={revealed}
            >
              {revealed && secret
                ? secret.kind === "mnemonic"
                  ? secret.mnemonic
                  : secret.privateKeyHex
                : "•".repeat(48)}
            </Text>
          )}
        </View>
        {error ? (
          <Text style={[styles.error, { color: theme.colors.danger }]}>
            {error}
          </Text>
        ) : null}
      </View>

      {wallet ? (
        <>
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: theme.colors.textMuted }]}>
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
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: theme.colors.textMuted }]}>
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
        </>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: spacing[5],
  },
  warning: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing[2],
    padding: spacing[4],
    borderRadius: radius.sm,
    marginTop: spacing[4],
  },
  warningText: {
    flex: 1,
    fontSize: typography.size.sm,
    fontWeight: typography.weight.medium,
    lineHeight: typography.lineHeight.sm,
  },
  section: {
    marginTop: spacing[5],
  },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: spacing[2],
  },
  sectionTitle: {
    fontSize: typography.size.xs,
    fontWeight: typography.weight.semibold,
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: spacing[2],
  },
  sectionActions: {
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
