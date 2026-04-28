import { StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { ShieldCheck } from "lucide-react-native";
import { useResolvedTheme } from "../hooks/useResolvedTheme";
import { useLoading } from "../hooks/useLoading";
import { useAppStore, type CreateWalletKind } from "../store/useAppStore";
import { useToast } from "../components/ToastProvider";
import Button from "../components/Button";
import LoadingOverlay from "../components/LoadingOverlay";
import type { RootStackParamList } from "../navigation/RootStack";
import { spacing, typography } from "../theme/theme";

type Nav = NativeStackNavigationProp<RootStackParamList, "Landing">;

const STAGES = [
  "Connecting to Arkade…",
  "Generating wallet…",
  "Creating addresses…",
  "Syncing balance…",
];

export default function LandingNoWallet() {
  const theme = useResolvedTheme();
  const nav = useNavigation<Nav>();
  const createWallet = useAppStore((s) => s.createWallet);
  const arkServerUrl = useAppStore((s) => s.network.arkServerUrl);
  const { showToast } = useToast();
  const { isLoading, message, show, hide } = useLoading();

  async function handleCreate(kind: CreateWalletKind) {
    show(STAGES[0]);
    try {
      const stagePromise = (async () => {
        for (let i = 1; i < STAGES.length; i++) {
          await new Promise((r) => setTimeout(r, 700));
          show(STAGES[i]);
        }
      })();
      await createWallet(kind);
      await stagePromise;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Wallet creation failed";
      showToast(msg, "error");
    } finally {
      hide();
    }
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
          Your self-custodial Arkade wallet
        </Text>
        <Text style={[styles.serverHint, { color: theme.colors.textSubtle }]}>
          Server: {arkServerUrl}
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
          label="Create seed phrase wallet"
          theme={theme}
          onPress={() => handleCreate("mnemonic")}
          loading={isLoading}
        />

        <Button
          label="Create single key wallet"
          variant="secondary"
          theme={theme}
          onPress={() => handleCreate("singleKey")}
          style={styles.singleKeyBtn}
          disabled={isLoading}
        />

        <Button
          label="Restore wallet"
          variant="ghost"
          theme={theme}
          onPress={() => nav.navigate("RestoreWallet")}
          style={styles.restoreBtn}
          disabled={isLoading}
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
  serverHint: {
    fontSize: typography.size.xs,
    marginTop: spacing[3],
    fontFamily: typography.fontFamily.mono,
  },
  actions: {
    paddingBottom: spacing[8],
  },
  learnMore: {
    marginBottom: spacing[5],
    alignSelf: "center",
  },
  singleKeyBtn: {
    marginTop: spacing[3],
  },
  restoreBtn: {
    marginTop: spacing[4],
    alignSelf: "center",
  },
});
