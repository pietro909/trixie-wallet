import * as React from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Info } from "lucide-react-native";
import { useResolvedTheme } from "../hooks/useResolvedTheme";
import { useLoading } from "../hooks/useLoading";
import { useAppStore } from "../store/useAppStore";
import { useToast } from "../components/ToastProvider";
import Button from "../components/Button";
import LoadingOverlay from "../components/LoadingOverlay";
import {
  isValidMnemonic,
  isValidPrivateKeyHex,
} from "../services/arkade/identity";
import { spacing, typography, radius } from "../theme/theme";

type ValidationKind = "mnemonic" | "hex" | null;

function classifyInput(value: string): ValidationKind {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (isValidPrivateKeyHex(trimmed)) return "hex";
  if (isValidMnemonic(trimmed)) return "mnemonic";
  return null;
}

const STAGES = [
  "Connecting to Arkade…",
  "Restoring wallet…",
  "Syncing balance…",
];

export default function RestoreWallet() {
  const theme = useResolvedTheme();
  const { showToast } = useToast();
  const restore = useAppStore((s) => s.restoreWallet);
  const arkServerUrl = useAppStore((s) => s.network.arkServerUrl);
  const { isLoading, message, show, hide } = useLoading();

  const [value, setValue] = React.useState("");
  const kind = classifyInput(value);
  const showError = value.trim().length > 0 && kind === null;

  async function handleRestore() {
    if (!kind) return;
    show(STAGES[0]);
    try {
      const input =
        kind === "mnemonic"
          ? ({ kind: "mnemonic", mnemonic: value.trim() } as const)
          : ({ kind: "hex", privateKeyHex: value.trim() } as const);
      const stagePromise = (async () => {
        for (let i = 1; i < STAGES.length; i++) {
          await new Promise((r) => setTimeout(r, 600));
          show(STAGES[i]);
        }
      })();
      await restore(input);
      await stagePromise;
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
        <Text style={[styles.label, { color: theme.colors.text }]}>
          Seed phrase or private key
        </Text>
        <TextInput
          value={value}
          onChangeText={setValue}
          placeholder="12/24 words, or 64-char hex"
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
              : kind === "hex"
                ? "Valid 64-char hex private key"
                : "Not a valid mnemonic or hex private key"}
          </Text>
        ) : null}

        <View
          style={[styles.banner, { backgroundColor: theme.colors.primarySoft }]}
        >
          <Info color={theme.colors.primary} size={18} />
          <Text style={[styles.bannerText, { color: theme.colors.primary }]}>
            Restore connects to {arkServerUrl} and rebuilds your Arkade addresses.
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
