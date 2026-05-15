import * as Haptics from "expo-haptics";
import * as React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  MAINNET_ARK_SERVER_URL,
  MUTINYNET_ARK_SERVER_URL,
} from "../services/arkade/network";
import { useAppStore } from "../store/useAppStore";
import { type AppTheme, radius, spacing, typography } from "../theme/theme";

type ArkadeNetwork = "bitcoin" | "mutinynet";

type Props = {
  theme: AppTheme;
  disabled?: boolean;
};

const OPTIONS: ReadonlyArray<{
  value: ArkadeNetwork;
  label: string;
  url: string;
}> = [
  { value: "bitcoin", label: "Mainnet", url: MAINNET_ARK_SERVER_URL },
  { value: "mutinynet", label: "Mutinynet", url: MUTINYNET_ARK_SERVER_URL },
];

export default function NetworkSelector({ theme, disabled }: Props) {
  const arkServerUrl = useAppStore((s) => s.network.arkServerUrl);
  const setArkadeNetwork = useAppStore((s) => s.setArkadeNetwork);

  const current: ArkadeNetwork =
    arkServerUrl === MAINNET_ARK_SERVER_URL ? "bitcoin" : "mutinynet";
  const currentOption = OPTIONS.find((o) => o.value === current) ?? OPTIONS[1];

  const handleSelect = React.useCallback(
    (value: ArkadeNetwork) => {
      if (disabled || value === current) return;
      Haptics.selectionAsync();
      void setArkadeNetwork(value);
    },
    [current, disabled, setArkadeNetwork],
  );

  return (
    <View>
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
          const selected = opt.value === current;
          const isMainnet = opt.value === "bitcoin";
          const selectedBg = isMainnet
            ? theme.colors.primary
            : theme.colors.warning;
          return (
            <Pressable
              key={opt.value}
              onPress={() => handleSelect(opt.value)}
              disabled={disabled}
              accessibilityRole="button"
              accessibilityState={{ selected, disabled: !!disabled }}
              accessibilityLabel={`Select ${opt.label} network`}
              style={({ pressed }) => [
                styles.segment,
                {
                  backgroundColor: selected ? selectedBg : "transparent",
                },
                pressed && !selected && !disabled ? { opacity: 0.7 } : null,
              ]}
            >
              <Text
                style={[
                  styles.segmentLabel,
                  {
                    color: selected
                      ? isMainnet
                        ? theme.colors.onPrimary
                        : theme.colors.onWarning
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
      <Text style={[styles.subLabel, { color: theme.colors.textSubtle }]}>
        {currentOption.url}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  segmented: {
    flexDirection: "row",
    borderRadius: radius.sm,
    borderWidth: 1,
    padding: 4,
    gap: 4,
  },
  segment: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: spacing[2],
    paddingHorizontal: spacing[3],
    borderRadius: radius.xs,
  },
  segmentLabel: {
    fontSize: typography.size.sm,
    fontWeight: typography.weight.semibold,
  },
  subLabel: {
    fontSize: typography.size.xs,
    marginTop: spacing[2],
    fontFamily: typography.fontFamily.mono,
    textAlign: "center",
  },
});
