import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { Copy, ExternalLink } from "lucide-react-native";
import * as React from "react";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { useResolvedTheme } from "../hooks/useResolvedTheme";
import { radius, spacing, typography } from "../theme/theme";
import { useToast } from "./ToastProvider";

export type CopyableFieldProps = {
  label: string;
  value: string;
  /** Render the value in a monospace-ish style with tabular nums. */
  mono?: boolean;
  /** Allow the value to wrap onto multiple lines (invoices, long strings). */
  multiline?: boolean;
  /** Optional explorer URL — when present, render an external-link button. */
  explorerUrl?: string | null;
  /** What to copy when tapping the copy button. Defaults to `value`. */
  copyValue?: string;
  /** Toast message on copy. Defaults to "Copied". */
  copyToast?: string;
};

export default function CopyableField({
  label,
  value,
  mono,
  multiline,
  explorerUrl,
  copyValue,
  copyToast = "Copied",
}: CopyableFieldProps) {
  const theme = useResolvedTheme();
  const { showToast } = useToast();

  const handleCopy = React.useCallback(async () => {
    try {
      await Clipboard.setStringAsync(copyValue ?? value);
      Haptics.selectionAsync().catch(() => {});
      showToast(copyToast, "success");
    } catch {
      showToast("Could not copy", "error");
    }
  }, [copyValue, value, copyToast, showToast]);

  const handleOpenExplorer = React.useCallback(async () => {
    if (!explorerUrl) return;
    try {
      const supported = await Linking.canOpenURL(explorerUrl);
      if (supported) {
        await Linking.openURL(explorerUrl);
      } else {
        showToast("Cannot open link", "error");
      }
    } catch {
      showToast("Cannot open link", "error");
    }
  }, [explorerUrl, showToast]);

  return (
    <View style={styles.row}>
      <Text style={[styles.label, { color: theme.colors.textSubtle }]}>
        {label}
      </Text>
      <View style={styles.valueRow}>
        <Text
          style={[
            styles.value,
            mono ? styles.mono : null,
            { color: theme.colors.text },
          ]}
          numberOfLines={multiline ? 6 : 1}
          ellipsizeMode={multiline ? "tail" : "middle"}
        >
          {value}
        </Text>
        <View style={styles.actions}>
          {explorerUrl ? (
            <Pressable
              onPress={handleOpenExplorer}
              hitSlop={8}
              style={({ pressed }) => [
                styles.btn,
                {
                  backgroundColor: theme.colors.surfaceSubtle,
                  opacity: pressed ? 0.6 : 1,
                },
              ]}
              accessibilityLabel={`Open ${label} in explorer`}
              accessibilityRole="button"
            >
              <ExternalLink color={theme.colors.textMuted} size={16} />
            </Pressable>
          ) : null}
          <Pressable
            onPress={handleCopy}
            hitSlop={8}
            style={({ pressed }) => [
              styles.btn,
              {
                backgroundColor: theme.colors.surfaceSubtle,
                opacity: pressed ? 0.6 : 1,
              },
            ]}
            accessibilityLabel={`Copy ${label}`}
            accessibilityRole="button"
          >
            <Copy color={theme.colors.textMuted} size={16} />
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    paddingVertical: spacing[2],
  },
  label: {
    fontSize: typography.size.xs,
    fontWeight: typography.weight.medium,
    marginBottom: 2,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  valueRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing[2],
  },
  value: {
    flex: 1,
    fontSize: typography.size.sm,
  },
  mono: {
    fontVariant: ["tabular-nums"],
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[1],
  },
  btn: {
    width: 32,
    height: 32,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
});
