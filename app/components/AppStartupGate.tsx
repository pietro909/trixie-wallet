import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from "@expo-google-fonts/inter";
import { AlertTriangle, WalletMinimal } from "lucide-react-native";
import * as React from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { useResolvedTheme } from "../hooks/useResolvedTheme";
import { useAppStore } from "../store/useAppStore";
import { spacing, typography } from "../theme/theme";
import Button from "./Button";

export default function AppStartupGate({
  children,
}: {
  children: React.ReactNode;
}) {
  const theme = useResolvedTheme();
  const hydrated = useAppStore((s) => s._hydrated);
  const schemaMismatch = useAppStore((s) => s._schemaMismatch);
  const hydrate = useAppStore((s) => s.hydrate);
  const acknowledgeSchemaMismatchAndWipe = useAppStore(
    (s) => s.acknowledgeSchemaMismatchAndWipe,
  );

  const [fontsLoaded] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });
  const [wiping, setWiping] = React.useState(false);

  React.useEffect(() => {
    hydrate();
  }, [hydrate]);

  if (schemaMismatch) {
    return (
      <View
        style={[
          styles.mismatchContainer,
          { backgroundColor: theme.colors.background },
        ]}
      >
        <View style={styles.mismatchCard}>
          <AlertTriangle color={theme.colors.danger} size={56} />
          <Text style={[styles.mismatchTitle, { color: theme.colors.text }]}>
            Incompatible saved data
          </Text>
          <Text
            style={[styles.mismatchBody, { color: theme.colors.textMuted }]}
          >
            The data on this device was saved by an incompatible version of
            Trixie and can't be loaded. Continuing will permanently delete the
            saved wallet, settings, and activity history — you'll need to set up
            the wallet again.
            {"\n\n"}
            If you'd prefer to attempt manual recovery first, close the app
            instead.
          </Text>
          <Button
            label="Wipe and continue"
            theme={theme}
            variant="danger"
            loading={wiping}
            onPress={async () => {
              if (wiping) return;
              setWiping(true);
              try {
                await acknowledgeSchemaMismatchAndWipe();
              } finally {
                setWiping(false);
              }
            }}
            style={styles.mismatchButton}
          />
        </View>
      </View>
    );
  }

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
  mismatchContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: spacing[6],
  },
  mismatchCard: {
    alignItems: "center",
    maxWidth: 480,
  },
  mismatchTitle: {
    fontSize: typography.size.xl,
    fontWeight: typography.weight.bold,
    marginTop: spacing[5],
    textAlign: "center",
  },
  mismatchBody: {
    fontSize: typography.size.md,
    lineHeight: 22,
    marginTop: spacing[3],
    textAlign: "center",
  },
  mismatchButton: {
    marginTop: spacing[6],
    alignSelf: "stretch",
  },
});
