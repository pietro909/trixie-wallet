import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { AlertTriangle, ShieldCheck } from "lucide-react-native";
import * as React from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Button from "../components/Button";
import { useResolvedTheme } from "../hooks/useResolvedTheme";
import type { RootStackParamList } from "../navigation/RootStack";
import { type BackupHealth, useAppStore } from "../store/useAppStore";
import { radius, spacing, typography } from "../theme/theme";

type Nav = NativeStackNavigationProp<RootStackParamList, "ProfileReset">;

type Gate = "block_pending" | "warn_stale" | "permit";

function gateForState(pendingCount: number, health: BackupHealth | null): Gate {
  if (pendingCount > 0) return "block_pending";
  if (health?.isStale) return "warn_stale";
  return "permit";
}

function tokenForGate(gate: Gate): string {
  return gate === "block_pending" ? "RESET PENDING" : "RESET";
}

export default function ProfileReset() {
  const theme = useResolvedTheme();
  const nav = useNavigation<Nav>();
  const resetWallet = useAppStore((s) => s.resetWallet);
  const getPendingLightningSwapCount = useAppStore(
    (s) => s.getPendingLightningSwapCount,
  );
  const getBackupHealth = useAppStore((s) => s.getBackupHealth);
  const lastBackupAt = useAppStore((s) => s.security.lastBackupAt ?? null);
  const dirtyForBackup = useAppStore((s) => s.security.dirtyForBackup === true);

  const [input, setInput] = React.useState("");
  const [pendingCount, setPendingCount] = React.useState<number | null>(null);
  const [health, setHealth] = React.useState<BackupHealth | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: re-run on backup-state signals
  React.useEffect(() => {
    let cancelled = false;
    Promise.all([
      getPendingLightningSwapCount().catch(() => 0),
      getBackupHealth().catch(() => null),
    ]).then(([count, h]) => {
      if (cancelled) return;
      setPendingCount(count);
      setHealth(h);
    });
    return () => {
      cancelled = true;
    };
  }, [
    getPendingLightningSwapCount,
    getBackupHealth,
    lastBackupAt,
    dirtyForBackup,
  ]);

  const gate = gateForState(pendingCount ?? 0, health);
  const expected = tokenForGate(gate);
  const canReset = input === expected;

  async function handleReset() {
    await resetWallet();
    // Navigation auto-redirects to Landing because wallet becomes null.
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
            {"•"} All wallet keys will be deleted
          </Text>
          <Text style={[styles.listItem, { color: theme.colors.textMuted }]}>
            {"•"} Activity history will be lost
          </Text>
          <Text style={[styles.listItem, { color: theme.colors.textMuted }]}>
            {"•"} Preferences will be reset
          </Text>
          <Text style={[styles.listItem, { color: theme.colors.textMuted }]}>
            {"•"} This cannot be recovered
          </Text>
        </View>

        {gate === "block_pending" ? (
          <View
            style={[
              styles.banner,
              { backgroundColor: `${theme.colors.danger}20` },
            ]}
          >
            <AlertTriangle color={theme.colors.danger} size={18} />
            <Text style={[styles.bannerText, { color: theme.colors.text }]}>
              {pendingCount === 1
                ? "1 Lightning swap is still pending."
                : `${pendingCount} Lightning swaps are still pending.`}{" "}
              Resetting will lose claim/refund material for in-flight swaps.
              Type "RESET PENDING" to confirm.
            </Text>
          </View>
        ) : null}

        {gate === "warn_stale" ? (
          <View
            style={[
              styles.banner,
              { backgroundColor: `${theme.colors.warning}25` },
            ]}
          >
            <ShieldCheck color={theme.colors.warning} size={18} />
            <View style={styles.bannerBody}>
              <Text style={[styles.bannerText, { color: theme.colors.text }]}>
                {lastBackupAt == null
                  ? "You have swap history that hasn't been backed up. Reset will discard it."
                  : "Your backup is out of date. New swap activity since the last export will be lost."}
              </Text>
              <Pressable
                onPress={() => nav.navigate("ProfileBackup")}
                style={styles.bannerLink}
              >
                <Text
                  style={[
                    styles.bannerLinkText,
                    { color: theme.colors.primary },
                  ]}
                >
                  Back up first
                </Text>
              </Pressable>
            </View>
          </View>
        ) : null}

        <Text style={[styles.confirmLabel, { color: theme.colors.text }]}>
          Type {expected} to confirm
        </Text>
        <TextInput
          value={input}
          onChangeText={setInput}
          placeholder={expected}
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
  banner: {
    flexDirection: "row",
    gap: spacing[2],
    padding: spacing[3],
    borderRadius: radius.sm,
    marginTop: spacing[5],
    alignItems: "flex-start",
  },
  bannerBody: {
    flex: 1,
  },
  bannerText: {
    fontSize: typography.size.xs,
    lineHeight: typography.lineHeight.xs,
  },
  bannerLink: {
    marginTop: spacing[2],
    alignSelf: "flex-start",
  },
  bannerLinkText: {
    fontSize: typography.size.xs,
    fontWeight: typography.weight.semibold,
  },
});
