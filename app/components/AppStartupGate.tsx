import * as React from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import {
  useFonts,
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
} from "@expo-google-fonts/inter";
import { WalletMinimal } from "lucide-react-native";
import { useAppStore } from "../store/useAppStore";
import { useResolvedTheme } from "../hooks/useResolvedTheme";
import { spacing, typography } from "../theme/theme";

export default function AppStartupGate({
  children,
}: {
  children: React.ReactNode;
}) {
  const theme = useResolvedTheme();
  const hydrated = useAppStore((s) => s._hydrated);
  const hydrate = useAppStore((s) => s.hydrate);

  const [fontsLoaded] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  React.useEffect(() => {
    hydrate();
  }, [hydrate]);

  if (!hydrated || !fontsLoaded) {
    return (
      <View
        style={[styles.container, { backgroundColor: theme.colors.background }]}
      >
        <WalletMinimal color={theme.colors.primary} size={64} />
        <Text style={[styles.title, { color: theme.colors.text }]}>Trixie</Text>
        <ActivityIndicator
          color={theme.colors.primary}
          size="small"
          style={styles.spinner}
        />
      </View>
    );
  }

  return <>{children}</>;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  title: {
    fontSize: typography.size["2xl"],
    fontWeight: typography.weight.bold,
    marginTop: spacing[4],
  },
  spinner: {
    marginTop: spacing[6],
  },
});
