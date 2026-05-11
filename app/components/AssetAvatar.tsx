import { Image } from "expo-image";
import { StyleSheet, Text, View, type ViewStyle } from "react-native";
import { useResolvedTheme } from "../hooks/useResolvedTheme";
import { typography } from "../theme/theme";

type Props = {
  size?: number;
  icon?: string | null;
  approved?: boolean;
  /** Used for the letter fallback when icon is absent / not approved. */
  ticker?: string | null;
  name?: string | null;
  style?: ViewStyle;
};

function pickLetter(ticker?: string | null, name?: string | null): string {
  const source = ticker ?? name ?? "";
  return source.trim().charAt(0).toUpperCase() || "?";
}

export default function AssetAvatar({
  size = 32,
  icon,
  approved,
  ticker,
  name,
  style,
}: Props) {
  const theme = useResolvedTheme();
  const showIcon =
    approved === true && typeof icon === "string" && icon.length > 0;
  const base: ViewStyle = {
    width: size,
    height: size,
    borderRadius: size / 2,
    backgroundColor: theme.colors.primarySoft,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  };
  if (showIcon && icon) {
    return (
      <View style={[base, style]}>
        <Image
          source={{ uri: icon }}
          style={{ width: size, height: size }}
          contentFit="cover"
        />
      </View>
    );
  }
  const letter = pickLetter(ticker, name);
  return (
    <View style={[base, style]}>
      <Text
        style={[
          styles.letter,
          {
            color: theme.colors.primary,
            fontSize: Math.max(10, Math.round(size * 0.45)),
          },
        ]}
      >
        {letter}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  letter: {
    fontWeight: typography.weight.semibold,
  },
});
