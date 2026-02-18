import * as React from "react";
import { StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { ShieldCheck } from "lucide-react-native";
import { useResolvedTheme } from "../hooks/useResolvedTheme";
import { useLoading } from "../hooks/useLoading";
import { useAppStore } from "../store/useAppStore";
import Button from "../components/Button";
import LoadingOverlay from "../components/LoadingOverlay";
import type { RootStackParamList } from "../navigation/RootStack";
import { spacing, typography } from "../theme/theme";

type Nav = NativeStackNavigationProp<RootStackParamList, "Landing">;

const STAGES = [
  "Generating keys...",
  "Setting up wallet...",
  "Almost ready...",
];

export default function LandingNoWallet() {
  const theme = useResolvedTheme();
  const nav = useNavigation<Nav>();
  const createWallet = useAppStore((s) => s.createWallet);
  const { isLoading, message, show, hide } = useLoading();

  async function handleCreate() {
    show(STAGES[0]);
    for (let i = 1; i < STAGES.length; i++) {
      await new Promise((r) => setTimeout(r, 800));
      show(STAGES[i]);
    }
    await new Promise((r) => setTimeout(r, 600));
    await createWallet();
    hide();
  }

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: theme.colors.background }]}
    >
      <View style={styles.top}>
        <ShieldCheck color={theme.colors.primary} size={80} />
        <Text style={[styles.title, { color: theme.colors.text }]}>
          Welcome to Trixie
        </Text>
        <Text style={[styles.subtitle, { color: theme.colors.textMuted }]}>
          Your self-custodial Ark wallet
        </Text>
      </View>

      <View style={styles.actions}>
        <Button
          label="Learn more"
          variant="ghost"
          theme={theme}
          onPress={() => nav.navigate("IntroCarousel")}
          style={styles.learnMore}
        />

        <Button
          label="Create new wallet"
          theme={theme}
          onPress={handleCreate}
          loading={isLoading}
        />

        <Button
          label="Restore wallet"
          variant="secondary"
          theme={theme}
          onPress={() => nav.navigate("RestoreWallet")}
          style={styles.restoreBtn}
        />
      </View>

      <LoadingOverlay visible={isLoading} message={message} theme={theme} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: spacing[6],
  },
  top: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  title: {
    fontSize: typography.size["2xl"],
    fontWeight: typography.weight.bold,
    marginTop: spacing[5],
  },
  subtitle: {
    fontSize: typography.size.md,
    marginTop: spacing[2],
  },
  actions: {
    paddingBottom: spacing[8],
  },
  learnMore: {
    marginBottom: spacing[6],
    alignSelf: "center",
  },
  restoreBtn: {
    marginTop: spacing[3],
  },
});
