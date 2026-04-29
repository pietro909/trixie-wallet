import { AlertTriangle } from "lucide-react-native";
import * as React from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Button from "../components/Button";
import { useResolvedTheme } from "../hooks/useResolvedTheme";
import { useAppStore } from "../store/useAppStore";
import { radius, spacing, typography } from "../theme/theme";

export default function ProfileReset() {
  const theme = useResolvedTheme();
  const resetWallet = useAppStore((s) => s.resetWallet);
  const getPendingLightningSwapCount = useAppStore(
    (s) => s.getPendingLightningSwapCount,
  );
  const [input, setInput] = React.useState("");
  const [pendingCount, setPendingCount] = React.useState<number | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    getPendingLightningSwapCount()
      .then((count) => {
        if (!cancelled) setPendingCount(count);
      })
      .catch(() => {
        if (!cancelled) setPendingCount(0);
      });
    return () => {
      cancelled = true;
    };
  }, [getPendingLightningSwapCount]);

  const requireExtraConfirmation = (pendingCount ?? 0) > 0;
  const canReset = requireExtraConfirmation
    ? input === "RESET PENDING"
    : input === "RESET";

  async function handleReset() {
    await resetWallet();
    // Navigation auto-redirects to Landing because wallet becomes null
  }

  return (
    <SafeAreaView
      edges={["bottom"]}
      style={[styles.container, { backgroundColor: theme.colors.background }]}
    >
      <View style={styles.content}>
        <View style={styles.iconWrap}>
          <AlertTriangle color={theme.colors.danger} size={56} />
        </View>

        <Text style={[styles.title, { color: theme.colors.danger }]}>
          Reset Wallet
        </Text>

        <Text style={[styles.warning, { color: theme.colors.text }]}>
          This will permanently delete your wallet and all data. This action
          cannot be undone.
        </Text>

        <View
          style={[styles.list, { backgroundColor: theme.colors.surfaceSubtle }]}
        >
          <Text style={[styles.listItem, { color: theme.colors.textMuted }]}>
            {"\u2022"} All wallet keys will be deleted
          </Text>
          <Text style={[styles.listItem, { color: theme.colors.textMuted }]}>
            {"\u2022"} Activity history will be lost
          </Text>
          <Text style={[styles.listItem, { color: theme.colors.textMuted }]}>
            {"\u2022"} Preferences will be reset
          </Text>
          <Text style={[styles.listItem, { color: theme.colors.textMuted }]}>
            {"\u2022"} This cannot be recovered
          </Text>
        </View>

        {requireExtraConfirmation ? (
          <View
            style={[
              styles.pendingWarning,
              { backgroundColor: `${theme.colors.warning}20` },
            ]}
          >
            <AlertTriangle color={theme.colors.warning} size={18} />
            <Text
              style={[styles.pendingWarningText, { color: theme.colors.text }]}
            >
              {pendingCount === 1
                ? "1 Lightning swap is still pending."
                : `${pendingCount} Lightning swaps are still pending.`}{" "}
              Resetting will lose claim/refund material for in-flight swaps.
              Type "RESET PENDING" to confirm.
            </Text>
          </View>
        ) : null}

        <Text style={[styles.confirmLabel, { color: theme.colors.text }]}>
          Type {requireExtraConfirmation ? "RESET PENDING" : "RESET"} to confirm
        </Text>
        <TextInput
          value={input}
          onChangeText={setInput}
          placeholder={requireExtraConfirmation ? "RESET PENDING" : "RESET"}
          placeholderTextColor={theme.colors.placeholder}
          autoCapitalize="characters"
          style={[
            styles.input,
            {
              color: theme.colors.text,
              backgroundColor: theme.colors.surfaceSubtle,
              borderColor: canReset ? theme.colors.danger : theme.colors.border,
            },
          ]}
        />

        <Button
          label="Reset Wallet"
          variant="danger"
          theme={theme}
          onPress={handleReset}
          disabled={!canReset}
          style={styles.resetBtn}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
    paddingHorizontal: spacing[5],
    paddingTop: spacing[6],
  },
  iconWrap: {
    alignItems: "center",
  },
  title: {
    fontSize: typography.size.xl,
    fontWeight: typography.weight.bold,
    textAlign: "center",
    marginTop: spacing[4],
  },
  warning: {
    fontSize: typography.size.md,
    textAlign: "center",
    marginTop: spacing[3],
    lineHeight: typography.lineHeight.md,
  },
  list: {
    marginTop: spacing[5],
    padding: spacing[4],
    borderRadius: radius.sm,
  },
  listItem: {
    fontSize: typography.size.sm,
    marginBottom: spacing[1],
    lineHeight: typography.lineHeight.sm,
  },
  confirmLabel: {
    fontSize: typography.size.sm,
    fontWeight: typography.weight.semibold,
    marginTop: spacing[6],
    marginBottom: spacing[2],
  },
  input: {
    fontSize: typography.size.md,
    paddingVertical: spacing[3],
    paddingHorizontal: spacing[4],
    borderRadius: radius.sm,
    borderWidth: 1,
    textAlign: "center",
    letterSpacing: 4,
    fontWeight: typography.weight.bold,
  },
  resetBtn: {
    marginTop: spacing[5],
  },
  pendingWarning: {
    flexDirection: "row",
    gap: spacing[2],
    padding: spacing[3],
    borderRadius: radius.sm,
    marginTop: spacing[5],
    alignItems: "flex-start",
  },
  pendingWarningText: {
    flex: 1,
    fontSize: typography.size.xs,
    lineHeight: typography.lineHeight.xs,
  },
});
