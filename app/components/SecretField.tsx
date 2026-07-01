import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { Copy, Eye, EyeOff } from "lucide-react-native";
import * as React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useResolvedTheme } from "../hooks/useResolvedTheme";
import { radius, spacing, typography } from "../theme/theme";
import { useToast } from "./ToastProvider";

export type SecretFieldProps = {
  label: string;
  value: string;
  /** Shown under the label, e.g. "Proof of payment — do not share". */
  warning?: string;
};

const MASK = "••••••••••••••••••••••••";

export default function SecretField({
  label,
  value,
  warning,
}: SecretFieldProps) {
  const theme = useResolvedTheme();
  const { showToast } = useToast();
  const [revealed, setRevealed] = React.useState(false);

  const handleToggle = React.useCallback(() => {
    setRevealed((r) => !r);
  }, []);

  const handleCopy = React.useCallback(async () => {
    try {
      await Clipboard.setStringAsync(value);
      Haptics.selectionAsync().catch(() => {});
      showToast("Copied", "success");
    } catch {
      showToast("Could not copy", "error");
    }
  }, [value, showToast]);

  return (
    <View style={styles.row}>
      <Text style={[styles.label, { color: theme.colors.textSubtle }]}>
        {label}
      </Text>
      {warning ? (
        <Text style={[styles.warning, { color: theme.colors.warning }]}>
          {warning}
        </Text>
      ) : null}
      <View style={styles.valueRow}>
        <Text
          style={[styles.value, { color: theme.colors.text }]}
          numberOfLines={revealed ? 6 : 1}
          ellipsizeMode="tail"
          selectable={revealed}
        >
          {revealed ? value : MASK}
        </Text>
        <View style={styles.actions}>
          <Pressable
            onPress={handleToggle}
            hitSlop={8}
            style={({ pressed }) => [
              styles.btn,
              {
                backgroundColor: theme.colors.surfaceSubtle,
                opacity: pressed ? 0.6 : 1,
              },
            ]}
            accessibilityLabel={revealed ? `Hide ${label}` : `Reveal ${label}`}
            accessibilityRole="button"
          >
            {revealed ? (
              <EyeOff color={theme.colors.textMuted} size={16} />
            ) : (
              <Eye color={theme.colors.textMuted} size={16} />
            )}
          </Pressable>
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
  warning: {
    fontSize: typography.size.xs,
    marginBottom: spacing[1],
  },
  valueRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing[2],
  },
  value: {
    flex: 1,
    fontSize: typography.size.sm,
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
