import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { ChevronRight, FileLock2, Info } from "lucide-react-native";
import * as React from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import AddressModeSelector from "../components/AddressModeSelector";
import Button from "../components/Button";
import LoadingOverlay from "../components/LoadingOverlay";
import NetworkSelector from "../components/NetworkSelector";
import { useToast } from "../components/ToastProvider";
import { useLoading } from "../hooks/useLoading";
import { useResolvedTheme } from "../hooks/useResolvedTheme";
import type { RootStackParamList } from "../navigation/RootStack";
import {
  isValidMnemonic,
  isValidNsec,
  isValidPrivateKeyHex,
} from "../services/arkade/identity";
import { BackupFileError, pickBackupFile } from "../services/backup/storage";
import { restoreLoadingMessage } from "../store/restoreProgress";
import { useAppStore } from "../store/useAppStore";
import { radius, spacing, typography } from "../theme/theme";

type Nav = NativeStackNavigationProp<RootStackParamList, "RestoreWallet">;

type ValidationKind = "mnemonic" | "nsec" | "hex" | null;

function classifyInput(value: string): ValidationKind {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (isValidNsec(trimmed)) return "nsec";
  if (isValidPrivateKeyHex(trimmed)) return "hex";
  if (isValidMnemonic(trimmed)) return "mnemonic";
  return null;
}

export default function RestoreWallet() {
  const theme = useResolvedTheme();
  const nav = useNavigation<Nav>();
  const { showToast } = useToast();
  const restore = useAppStore((s) => s.restoreWallet);
  const restoreProgress = useAppStore((s) => s.restoreProgress);
  const { isLoading, message, show, hide } = useLoading();

  const [value, setValue] = React.useState("");
  const kind = classifyInput(value);
  const showError = value.trim().length > 0 && kind === null;
  const [pickingBackup, setPickingBackup] = React.useState(false);
  const [walletMode, setWalletMode] = React.useState<"static" | "hd">("static");

  const loadingMessage = restoreLoadingMessage(restoreProgress, message);

  async function handlePickBackup() {
    if (pickingBackup) return;
    setPickingBackup(true);
    try {
      const envelope = await pickBackupFile();
      if (!envelope) return; // user cancelled
      nav.navigate("RestoreBackupPassword", { envelope });
    } catch (e) {
      const msg =
        e instanceof BackupFileError
          ? e.message
          : e instanceof Error
            ? e.message
            : "Could not read backup file";
      showToast(msg, "error");
    } finally {
      setPickingBackup(false);
    }
  }

  async function handleRestore() {
    if (!kind) return;
    show("Restoring wallet…");
    try {
      const input =
        kind === "mnemonic"
          ? ({ kind: "mnemonic", mnemonic: value.trim() } as const)
          : kind === "nsec"
            ? ({ kind: "nsec", nsec: value.trim() } as const)
            : ({ kind: "hex", privateKeyHex: value.trim() } as const);
      await restore(input, kind === "mnemonic" ? walletMode : "static");
      // RootStack swaps to the wallet-exists branch automatically when
      // the store updates, so this screen unmounts on its own.
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Restore failed";
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
        <NetworkSelector theme={theme} disabled={isLoading || pickingBackup} />
        <Text
          style={[styles.selectorHelper, { color: theme.colors.textSubtle }]}
        >
          This selection applies only to seed phrase or private-key restore.
          Backup files restore using the network saved inside the backup.
        </Text>

        <Pressable
          onPress={handlePickBackup}
          disabled={isLoading || pickingBackup}
          style={({ pressed }) => [
            styles.backupCard,
            {
              backgroundColor: theme.colors.card,
              ...theme.shadow("card"),
            },
            pressed && { opacity: 0.7 },
          ]}
        >
          <View
            style={[
              styles.backupIconWrap,
              { backgroundColor: theme.colors.primarySoft },
            ]}
          >
            <FileLock2 color={theme.colors.primary} size={22} />
          </View>
          <View style={styles.backupCardText}>
            <Text
              style={[styles.backupCardTitle, { color: theme.colors.text }]}
            >
              Restore from backup file
            </Text>
            <Text
              style={[
                styles.backupCardSubtitle,
                { color: theme.colors.textMuted },
              ]}
            >
              Use a `.trixiebackup` file you exported earlier.
            </Text>
          </View>
          <ChevronRight color={theme.colors.textSubtle} size={18} />
        </Pressable>

        <View style={styles.divider}>
          <View
            style={[
              styles.dividerLine,
              { backgroundColor: theme.colors.divider },
            ]}
          />
          <Text
            style={[styles.dividerText, { color: theme.colors.textSubtle }]}
          >
            or use a seed phrase
          </Text>
          <View
            style={[
              styles.dividerLine,
              { backgroundColor: theme.colors.divider },
            ]}
          />
        </View>

        <Text style={[styles.label, { color: theme.colors.text }]}>
          Seed phrase or private key
        </Text>
        <TextInput
          value={value}
          onChangeText={setValue}
          placeholder="12/24 words, nsec, or 64-char hex"
          placeholderTextColor={theme.colors.placeholder}
          autoCapitalize="none"
          autoCorrect={false}
          multiline
          style={[
            styles.input,
            {
              color: theme.colors.text,
              backgroundColor: theme.colors.surfaceSubtle,
              borderColor: showError
                ? theme.colors.danger
                : kind
                  ? theme.colors.success
                  : theme.colors.border,
            },
          ]}
        />
        {value.length > 0 ? (
          <Text
            style={[
              styles.validation,
              {
                color: showError ? theme.colors.danger : theme.colors.success,
              },
            ]}
          >
            {kind === "mnemonic"
              ? "Valid BIP-39 seed phrase"
              : kind === "nsec"
                ? "Valid nsec private key"
                : kind === "hex"
                  ? "Valid 64-char hex private key"
                  : "Not a valid mnemonic, nsec, or hex private key"}
          </Text>
        ) : null}

        {kind === "mnemonic" && (
          <View style={styles.modeSelector}>
            <AddressModeSelector
              theme={theme}
              value={walletMode}
              onChange={setWalletMode}
              disabled={isLoading}
            />
          </View>
        )}

        <View
          style={[styles.banner, { backgroundColor: theme.colors.primarySoft }]}
        >
          <Info color={theme.colors.primary} size={18} />
          <Text style={[styles.bannerText, { color: theme.colors.primary }]}>
            Restore connects to the selected network and rebuilds your Arkade
            addresses.
          </Text>
        </View>

        <Button
          label="Restore"
          theme={theme}
          onPress={handleRestore}
          disabled={!kind || isLoading}
          loading={isLoading}
          style={styles.submitBtn}
        />
      </View>

      <LoadingOverlay
        visible={isLoading}
        message={loadingMessage}
        theme={theme}
      />
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
  selectorHelper: {
    fontSize: typography.size.xs,
    marginTop: spacing[3],
    marginBottom: spacing[5],
    lineHeight: typography.lineHeight.xs,
    textAlign: "center",
  },
  backupCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    padding: spacing[4],
    borderRadius: radius.lg,
  },
  backupIconWrap: {
    width: 40,
    height: 40,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  backupCardText: {
    flex: 1,
  },
  backupCardTitle: {
    fontSize: typography.size.md,
    fontWeight: typography.weight.semibold,
  },
  backupCardSubtitle: {
    fontSize: typography.size.xs,
    marginTop: spacing[1],
    lineHeight: typography.lineHeight.xs,
  },
  divider: {
    flexDirection: "row",
    alignItems: "center",
    marginVertical: spacing[5],
    gap: spacing[3],
  },
  dividerLine: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
  },
  dividerText: {
    fontSize: typography.size.xs,
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  label: {
    fontSize: typography.size.sm,
    fontWeight: typography.weight.semibold,
    marginBottom: spacing[2],
  },
  input: {
    fontSize: typography.size.md,
    paddingVertical: spacing[3],
    paddingHorizontal: spacing[4],
    borderRadius: radius.sm,
    borderWidth: 1,
    minHeight: 96,
    textAlignVertical: "top",
  },
  validation: {
    fontSize: typography.size.xs,
    marginTop: spacing[1],
  },
  modeSelector: {
    marginTop: spacing[4],
  },
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    paddingVertical: spacing[3],
    paddingHorizontal: spacing[4],
    borderRadius: radius.sm,
    marginTop: spacing[5],
  },
  bannerText: {
    flex: 1,
    fontSize: typography.size.sm,
    fontWeight: typography.weight.medium,
  },
  submitBtn: {
    marginTop: spacing[5],
  },
});
