import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { ShieldCheck } from "lucide-react-native";
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import AddressModeSelector from "../components/AddressModeSelector";
import Button from "../components/Button";
import LoadingOverlay from "../components/LoadingOverlay";
import NetworkSelector from "../components/NetworkSelector";
import { useToast } from "../components/ToastProvider";
import { useLoading } from "../hooks/useLoading";
import { useResolvedTheme } from "../hooks/useResolvedTheme";
import type { RootStackParamList } from "../navigation/RootStack";
import { type CreateWalletKind, useAppStore } from "../store/useAppStore";
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
  const { showToast } = useToast();
  const { isLoading, message, show, hide } = useLoading();
  const [walletMode, setWalletMode] = useState<"static" | "hd">("static");

  async function handleCreate(kind: CreateWalletKind) {
    show(STAGES[0]);
    try {
      const stagePromise = (async () => {
        for (let i = 1; i < STAGES.length; i++) {
          await new Promise((r) => setTimeout(r, 700));
          show(STAGES[i]);
        }
      })();
      await createWallet(kind, kind === "mnemonic" ? walletMode : "static");
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
        <View style={styles.selector}>
          <NetworkSelector theme={theme} disabled={isLoading} />
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

        <View style={styles.mnemonicSection}>
          <Button
            label="Create seed phrase wallet"
            theme={theme}
            onPress={() => handleCreate("mnemonic")}
            loading={isLoading}
          />
          <AddressModeSelector
            theme={theme}
            value={walletMode}
            onChange={setWalletMode}
            disabled={isLoading}
          />
        </View>

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
  selector: {
    width: "100%",
    marginTop: spacing[6],
  },
  actions: {
    paddingBottom: spacing[8],
  },
  learnMore: {
    marginBottom: spacing[5],
    alignSelf: "center",
  },
  mnemonicSection: {
    gap: spacing[4],
  },
  singleKeyBtn: {
    marginTop: spacing[3],
  },
  restoreBtn: {
    marginTop: spacing[4],
    alignSelf: "center",
  },
});
