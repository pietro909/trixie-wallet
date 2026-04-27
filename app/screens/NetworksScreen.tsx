
import { StyleSheet, Text, View } from "react-native";
import { Network } from "lucide-react-native";
import { useResolvedTheme } from "../hooks/useResolvedTheme";
import { spacing, typography } from "../theme/theme";

export default function NetworksScreen() {
  const theme = useResolvedTheme();

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <Network color={theme.colors.textSubtle} size={64} />
      <Text style={[styles.title, { color: theme.colors.text }]}>
        Coming Soon
      </Text>
      <Text style={[styles.body, { color: theme.colors.textMuted }]}>
        Connect to multiple Ark service providers and manage your network
        connections from here.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: spacing[8],
  },
  title: {
    fontSize: typography.size.xl,
    fontWeight: typography.weight.bold,
    marginTop: spacing[5],
  },
  body: {
    fontSize: typography.size.md,
    marginTop: spacing[3],
    textAlign: "center",
    lineHeight: typography.lineHeight.md,
  },
});
