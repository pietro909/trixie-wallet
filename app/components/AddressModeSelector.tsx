import * as Haptics from "expo-haptics";
import { Lock, Shuffle } from "lucide-react-native";
import * as React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { type AppTheme, radius, spacing, typography } from "../theme/theme";

type WalletMode = "static" | "hd";

type Props = {
  theme: AppTheme;
  value: WalletMode;
  onChange: (mode: WalletMode) => void;
  disabled?: boolean;
};

const OPTIONS: ReadonlyArray<{
  value: WalletMode;
  label: string;
  Icon: React.ComponentType<{ color?: string; size?: number }>;
  description: string;
}> = [
  {
    value: "static",
    label: "Static",
    Icon: Lock,
    description:
      "One fixed address for every payment. Simpler to share, but anyone you pay or receive from can link your transactions and watch your balance.",
  },
  {
    value: "hd",
    label: "Rotating",
    Icon: Shuffle,
    description:
      "Derives a fresh address for each receive (BIP-32 HD). Avoids address reuse so your balance and payment history stay private.",
  },
];

/**
 * Segmented Static / Rotating (HD) picker for the address-rotation choice made
 * at wallet creation and restore. Mirrors NetworkSelector's segmented idiom and
 * surfaces a live explanation of the selected mode. Mnemonic-only — callers gate
 * rendering on the identity kind. The choice is immutable once persisted.
 */
export default function AddressModeSelector({
  theme,
  value,
  onChange,
  disabled,
}: Props) {
  const current = OPTIONS.find((o) => o.value === value) ?? OPTIONS[0];

  const handleSelect = React.useCallback(
    (next: WalletMode) => {
      if (disabled || next === value) return;
      Haptics.selectionAsync();
      onChange(next);
    },
    [disabled, value, onChange],
  );

  return (
    <View>
      <Text style={[styles.title, { color: theme.colors.text }]}>
        Address privacy
      </Text>
      <View
        style={[
          styles.segmented,
          {
            backgroundColor: theme.colors.surfaceSubtle,
            borderColor: theme.colors.border,
          },
        ]}
      >
        {OPTIONS.map((opt) => {
          const selected = opt.value === value;
          return (
            <Pressable
              key={opt.value}
              onPress={() => handleSelect(opt.value)}
              disabled={disabled}
              accessibilityRole="button"
              accessibilityState={{ selected, disabled: !!disabled }}
              accessibilityLabel={`${opt.label} addresses`}
              style={({ pressed }) => [
                styles.segment,
                {
                  backgroundColor: selected
                    ? theme.colors.primary
                    : "transparent",
                },
                pressed && !selected && !disabled ? { opacity: 0.6 } : null,
              ]}
            >
              <opt.Icon
                size={15}
                color={
                  selected ? theme.colors.onPrimary : theme.colors.textMuted
                }
              />
              <Text
                style={[
                  styles.segmentLabel,
                  {
                    color: selected
                      ? theme.colors.onPrimary
                      : theme.colors.text,
                  },
                ]}
                numberOfLines={1}
              >
                {opt.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={[styles.description, { color: theme.colors.textSubtle }]}>
        {current.description}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  title: {
    fontSize: typography.size.sm,
    fontWeight: typography.weight.semibold,
    marginBottom: spacing[2],
  },
  segmented: {
    flexDirection: "row",
    borderRadius: radius.sm,
    borderWidth: 1,
    padding: 4,
    gap: 4,
  },
  segment: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing[2],
    paddingVertical: spacing[2],
    paddingHorizontal: spacing[3],
    borderRadius: radius.xs,
  },
  segmentLabel: {
    fontSize: typography.size.sm,
    fontWeight: typography.weight.semibold,
  },
  description: {
    fontSize: typography.size.xs,
    lineHeight: typography.lineHeight.xs,
    marginTop: spacing[2],
  },
});
