import {
  ChevronDown,
  ChevronRight,
  KeyRound,
  KeySquare,
} from "lucide-react-native";
import { useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import AddressModeSelector from "../components/AddressModeSelector";
import Button from "../components/Button";
import LoadingOverlay from "../components/LoadingOverlay";
import { useToast } from "../components/ToastProvider";
import { useLoading } from "../hooks/useLoading";
import { useResolvedTheme } from "../hooks/useResolvedTheme";
import { type CreateWalletKind, useAppStore } from "../store/useAppStore";
import { radius, spacing, typography } from "../theme/theme";

const STAGES = [
  "Connecting to Arkade…",
  "Generating wallet…",
  "Creating addresses…",
  "Syncing balance…",
];

export default function CreateWallet() {
  const theme = useResolvedTheme();
  const createWallet = useAppStore((s) => s.createWallet);
  const { showToast } = useToast();
  const { isLoading, message, show, hide } = useLoading();
  const [walletMode, setWalletMode] = useState<"static" | "hd">("static");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const activeRef = useRef(true);

  async function handleCreate(kind: CreateWalletKind) {
    activeRef.current = true;
    show(STAGES[0]);
    try {
      const stagePromise = (async () => {
        for (let i = 1; i < STAGES.length; i++) {
          await new Promise((r) => setTimeout(r, 700));
          if (activeRef.current) show(STAGES[i]);
        }
      })();
      try {
        // singleKey identities always use a static address; walletMode only
        // applies to the mnemonic path.
        await createWallet(kind, kind === "mnemonic" ? walletMode : "static");
        await stagePromise;
      } finally {
        activeRef.current = false;
      }
      // RootStack swaps to the wallet-exists branch when the store updates,
      // so this screen unmounts on its own — no explicit navigation needed.
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Wallet creation failed";
      showToast(msg, "error");
    } finally {
      hide();
    }
  }

  return (
    <SafeAreaView
      edges={["bottom"]}
      style={[styles.container, { backgroundColor: theme.colors.background }]}
    >
      <View style={styles.content}>
        <View
          style={[
            styles.typeCard,
            { backgroundColor: theme.colors.card, ...theme.shadow("card") },
          ]}
        >
          <View
            style={[
              styles.iconWrap,
              { backgroundColor: theme.colors.primarySoft },
            ]}
          >
            <KeyRound color={theme.colors.primary} size={22} />
          </View>
          <View style={styles.typeCardText}>
            <Text style={[styles.typeCardTitle, { color: theme.colors.text }]}>
              Seed phrase wallet
            </Text>
            <Text
              style={[
                styles.typeCardSubtitle,
                { color: theme.colors.textMuted },
              ]}
            >
              A secret recovery phrase you can write down to back up and restore
              your wallet anywhere. Recommended for most people.
            </Text>
          </View>
        </View>

        <View style={styles.modeSelector}>
          <AddressModeSelector
            theme={theme}
            value={walletMode}
            onChange={setWalletMode}
            disabled={isLoading}
          />
        </View>

        <Button
          label="Create wallet"
          theme={theme}
          onPress={() => handleCreate("mnemonic")}
          loading={isLoading}
          style={styles.createBtn}
        />

        <Pressable
          onPress={() => setShowAdvanced((v) => !v)}
          disabled={isLoading}
          accessibilityRole="button"
          accessibilityState={{ expanded: showAdvanced }}
          accessibilityLabel="Advanced wallet options"
          hitSlop={8}
          style={({ pressed }) => [
            styles.advancedToggle,
            pressed && !isLoading ? { opacity: 0.6 } : null,
          ]}
        >
          {showAdvanced ? (
            <ChevronDown color={theme.colors.textMuted} size={18} />
          ) : (
            <ChevronRight color={theme.colors.textMuted} size={18} />
          )}
          <Text
            style={[styles.advancedLabel, { color: theme.colors.textMuted }]}
          >
            Advanced
          </Text>
        </Pressable>

        {showAdvanced ? (
          <View
            style={[
              styles.advancedBody,
              { backgroundColor: theme.colors.surfaceSubtle },
            ]}
          >
            <View style={styles.advancedHeader}>
              <KeySquare color={theme.colors.textMuted} size={18} />
              <Text
                style={[styles.advancedTitle, { color: theme.colors.text }]}
              >
                Single key wallet
              </Text>
            </View>
            <Text
              style={[styles.advancedDesc, { color: theme.colors.textSubtle }]}
            >
              Backed by a single private key with no seed-phrase backup — you
              keep the key yourself. Always uses a static address.
            </Text>
            <Button
              label="Create single key wallet"
              variant="secondary"
              theme={theme}
              onPress={() => handleCreate("singleKey")}
              disabled={isLoading}
              style={styles.singleKeyBtn}
            />
          </View>
        ) : null}
      </View>

      <LoadingOverlay visible={isLoading} message={message} theme={theme} />
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
    paddingTop: spacing[5],
  },
  typeCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing[3],
    padding: spacing[4],
    borderRadius: radius.lg,
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  typeCardText: {
    flex: 1,
  },
  typeCardTitle: {
    fontSize: typography.size.md,
    fontWeight: typography.weight.semibold,
  },
  typeCardSubtitle: {
    fontSize: typography.size.xs,
    marginTop: spacing[1],
    lineHeight: typography.lineHeight.xs,
  },
  modeSelector: {
    marginTop: spacing[5],
  },
  createBtn: {
    marginTop: spacing[6],
  },
  advancedToggle: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing[1],
    marginTop: spacing[6],
    paddingVertical: spacing[2],
  },
  advancedLabel: {
    fontSize: typography.size.sm,
    fontWeight: typography.weight.semibold,
  },
  advancedBody: {
    marginTop: spacing[2],
    padding: spacing[4],
    borderRadius: radius.lg,
  },
  advancedHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
  },
  advancedTitle: {
    fontSize: typography.size.md,
    fontWeight: typography.weight.semibold,
  },
  advancedDesc: {
    fontSize: typography.size.xs,
    lineHeight: typography.lineHeight.xs,
    marginTop: spacing[2],
  },
  singleKeyBtn: {
    marginTop: spacing[4],
  },
});
