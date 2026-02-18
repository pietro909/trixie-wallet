import * as React from "react";
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { AlertTriangle, Copy, Eye, EyeOff } from "lucide-react-native";
import * as Haptics from "expo-haptics";
import { useResolvedTheme } from "../hooks/useResolvedTheme";
import { useAppStore } from "../store/useAppStore";
import { useToast } from "../components/ToastProvider";
import { spacing, typography, radius } from "../theme/theme";


export default function ProfileBackup() {
  const theme = useResolvedTheme();
  const walletContainer = useAppStore((s) => s.walletContainer);
  const { showToast } = useToast();
  const [showKey, setShowKey] = React.useState(false);
  const [showMnemonic, setShowMnemonic] = React.useState(false);

  const wallet = walletContainer?.wallets.find(
    (w) => w.id === walletContainer.activeWalletId,
  );

  const privateKeyHex = wallet?.backup.privateKeyHex ?? "";
  const privateKeyNsec = wallet?.backup.privateKeyNsec ?? "";
  const mnemonic = wallet?.backup.mnemonic;

  async function handleCopy(text: string, label: string) {
    try {
      if (Platform.OS === "web") {
        await navigator.clipboard.writeText(text);
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      showToast(`${label} copied`, "success");
    } catch {
      showToast("Could not copy", "error");
    }
  }

  return (
    <SafeAreaView
      edges={["bottom"]}
      style={[styles.container, { backgroundColor: theme.colors.background }]}
    >
      {/* Warning */}
      <View
        style={[styles.warning, { backgroundColor: theme.colors.danger + "15" }]}
      >
        <AlertTriangle color={theme.colors.danger} size={20} />
        <Text style={[styles.warningText, { color: theme.colors.danger }]}>
          Keep this information secret. Anyone with these keys can access your
          funds.
        </Text>
      </View>

      {/* Private Key Hex */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, { color: theme.colors.textMuted }]}>
            Private Key (Hex)
          </Text>
          <View style={styles.sectionActions}>
            <Pressable onPress={() => setShowKey(!showKey)}>
              {showKey ? (
                <EyeOff color={theme.colors.textMuted} size={20} />
              ) : (
                <Eye color={theme.colors.textMuted} size={20} />
              )}
            </Pressable>
            <Pressable onPress={() => handleCopy(privateKeyHex, "Private key")}>
              <Copy color={theme.colors.textMuted} size={20} />
            </Pressable>
          </View>
        </View>
        <View
          style={[
            styles.valueBox,
            { backgroundColor: theme.colors.surfaceSubtle },
          ]}
        >
          <Text
            style={[
              styles.valueText,
              { color: theme.colors.text },
            ]}
            selectable={showKey}
          >
            {showKey ? privateKeyHex : "\u2022".repeat(32)}
          </Text>
        </View>
      </View>

      {/* Private Key NSEC */}
      {privateKeyNsec ? (
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionTitle, { color: theme.colors.textMuted }]}>
              Private Key (NSEC)
            </Text>
            <Pressable onPress={() => handleCopy(privateKeyNsec, "NSEC key")}>
              <Copy color={theme.colors.textMuted} size={20} />
            </Pressable>
          </View>
          <View
            style={[
              styles.valueBox,
              { backgroundColor: theme.colors.surfaceSubtle },
            ]}
          >
            <Text
              style={[styles.valueText, { color: theme.colors.text }]}
              selectable={showKey}
            >
              {showKey ? privateKeyNsec : "\u2022".repeat(32)}
            </Text>
          </View>
        </View>
      ) : null}

      {/* Mnemonic */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, { color: theme.colors.textMuted }]}>
            Seed Phrase
          </Text>
          <View style={styles.sectionActions}>
            <Pressable onPress={() => setShowMnemonic(!showMnemonic)}>
              {showMnemonic ? (
                <EyeOff color={theme.colors.textMuted} size={20} />
              ) : (
                <Eye color={theme.colors.textMuted} size={20} />
              )}
            </Pressable>
            {mnemonic && (
              <Pressable onPress={() => handleCopy(mnemonic, "Seed phrase")}>
                <Copy color={theme.colors.textMuted} size={20} />
              </Pressable>
            )}
          </View>
        </View>
        <View
          style={[
            styles.valueBox,
            { backgroundColor: theme.colors.surfaceSubtle },
          ]}
        >
          <Text
            style={[styles.valueText, { color: theme.colors.text }]}
            selectable={showMnemonic}
          >
            {mnemonic
              ? showMnemonic
                ? mnemonic
                : "\u2022".repeat(48)
              : "Not available"}
          </Text>
        </View>
      </View>
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
  },
  sectionActions: {
    flexDirection: "row",
    gap: spacing[3],
  },
  valueBox: {
    padding: spacing[4],
    borderRadius: radius.sm,
  },
  valueText: {
    fontSize: typography.size.sm,
    fontFamily: typography.fontFamily.mono,
    lineHeight: typography.lineHeight.sm,
  },
});
