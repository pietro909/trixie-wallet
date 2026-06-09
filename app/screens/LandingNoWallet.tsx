import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { ShieldCheck } from "lucide-react-native";
import { StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Button from "../components/Button";
import NetworkSelector from "../components/NetworkSelector";
import { useResolvedTheme } from "../hooks/useResolvedTheme";
import type { RootStackParamList } from "../navigation/RootStack";
import { spacing, typography } from "../theme/theme";

type Nav = NativeStackNavigationProp<RootStackParamList, "Landing">;

export default function LandingNoWallet() {
  const theme = useResolvedTheme();
  const nav = useNavigation<Nav>();

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
          Your self-custodial Arkade wallet
        </Text>
        <View style={styles.selector}>
          <NetworkSelector theme={theme} />
        </View>
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
          label="Create wallet"
          theme={theme}
          onPress={() => nav.navigate("CreateWallet")}
        />
        <Button
          label="Restore wallet"
          variant="secondary"
          theme={theme}
          onPress={() => nav.navigate("RestoreWallet")}
          style={styles.restoreBtn}
        />
      </View>
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
  selector: {
    width: "100%",
    marginTop: spacing[6],
  },
  actions: {
    paddingBottom: spacing[8],
  },
  learnMore: {
    marginBottom: spacing[3],
    alignSelf: "center",
  },
  restoreBtn: {
    marginTop: spacing[3],
  },
});
