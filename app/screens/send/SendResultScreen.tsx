import * as React from "react";
import {
  Animated,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  CommonActions,
  useNavigation,
  useRoute,
  type RouteProp,
} from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { CheckCircle2, Copy, XCircle } from "lucide-react-native";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { useResolvedTheme } from "../../hooks/useResolvedTheme";
import { useToast } from "../../components/ToastProvider";
import Button from "../../components/Button";
import { satsToFiat, formatSats } from "../../store/mock";
import { useAppStore } from "../../store/useAppStore";
import { paymentTypeLabel } from "../../services/paymentParser";
import type { RootStackParamList } from "../../navigation/RootStack";
import { radius, spacing, typography } from "../../theme/theme";

type Nav = NativeStackNavigationProp<RootStackParamList, "SendResult">;
type Route = RouteProp<RootStackParamList, "SendResult">;

export default function SendResultScreen() {
  const theme = useResolvedTheme();
  const nav = useNavigation<Nav>();
  const params = useRoute<Route>().params;
  const fiatCurrency = useAppStore((s) => s.preferences.fiatCurrency);
  const { showToast } = useToast();

  const ok = params.status === "success";
  const scale = React.useRef(new Animated.Value(0.7)).current;

  React.useEffect(() => {
    Animated.spring(scale, {
      toValue: 1,
      useNativeDriver: true,
      speed: 14,
      bounciness: 8,
    }).start();
    Haptics.notificationAsync(
      ok
        ? Haptics.NotificationFeedbackType.Success
        : Haptics.NotificationFeedbackType.Error,
    );
  }, [ok, scale]);

  function goHome() {
    nav.dispatch(
      CommonActions.reset({
        index: 0,
        routes: [{ name: "Main" }],
      }),
    );
  }

  function tryAgain() {
    nav.dispatch(
      CommonActions.reset({
        index: 1,
        routes: [{ name: "Main" }, { name: "SendEntry" }],
      }),
    );
  }

  async function copyTxId() {
    if (!params.txId) return;
    try {
      await Clipboard.setStringAsync(params.txId);
      showToast("Transaction ID copied", "success");
    } catch {
      showToast("Could not copy", "error");
    }
  }

  return (
    <SafeAreaView
      edges={["bottom"]}
      style={[styles.container, { backgroundColor: theme.colors.background }]}
    >
      <View style={styles.content}>
        <Animated.View style={{ transform: [{ scale }] }}>
          {ok ? (
            <CheckCircle2 color={theme.colors.success} size={96} />
          ) : (
            <XCircle color={theme.colors.danger} size={96} />
          )}
        </Animated.View>

        <Text style={[styles.title, { color: theme.colors.text }]}>
          {ok ? "Payment sent" : "Payment failed"}
        </Text>

        {ok ? (
          <>
            <Text style={[styles.amount, { color: theme.colors.text }]}>
              {formatSats(params.amountSats ?? 0)} sats
            </Text>
            <Text style={[styles.fiat, { color: theme.colors.textMuted }]}>
              ≈ {satsToFiat(params.amountSats ?? 0, fiatCurrency)}
            </Text>
            <Text style={[styles.subtitle, { color: theme.colors.textMuted }]}>
              {paymentTypeLabel(params.paymentType)} · {params.destination}
            </Text>
            {params.feeSats && params.feeSats > 0 ? (
              <Text style={[styles.subtitle, { color: theme.colors.textSubtle }]}>
                Network fee {formatSats(params.feeSats)} sats
              </Text>
            ) : null}
            {params.txId ? (
              <Pressable
                onPress={copyTxId}
                style={({ pressed }) => [
                  styles.txIdBox,
                  {
                    backgroundColor: theme.colors.surfaceSubtle,
                    borderColor: theme.colors.border,
                    opacity: pressed ? 0.7 : 1,
                  },
                ]}
              >
                <View style={styles.txIdHeader}>
                  <Text
                    style={[styles.txIdLabel, { color: theme.colors.textMuted }]}
                  >
                    Transaction ID
                  </Text>
                  <Copy color={theme.colors.textMuted} size={14} />
                </View>
                <Text
                  style={[styles.txIdValue, { color: theme.colors.text }]}
                  numberOfLines={1}
                >
                  {params.txId}
                </Text>
              </Pressable>
            ) : null}
          </>
        ) : (
          <>
            <Text style={[styles.errorBody, { color: theme.colors.textMuted }]}>
              {params.message ?? "Something went wrong."}
            </Text>
            <Text style={[styles.subtitle, { color: theme.colors.textSubtle }]}>
              {paymentTypeLabel(params.paymentType)} · {params.destination}
            </Text>
          </>
        )}
      </View>

      <View style={styles.footer}>
        {ok ? (
          <Button label="Done" theme={theme} onPress={goHome} />
        ) : (
          <>
            <Button
              label="Try again"
              theme={theme}
              onPress={tryAgain}
            />
            <Button
              label="Back to wallet"
              theme={theme}
              variant="ghost"
              onPress={goHome}
              style={styles.secondaryBtn}
            />
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing[6],
  },
  title: {
    fontSize: typography.size.xl,
    fontWeight: typography.weight.bold,
    marginTop: spacing[5],
  },
  amount: {
    fontSize: 32,
    fontWeight: typography.weight.bold,
    fontVariant: ["tabular-nums"],
    marginTop: spacing[3],
  },
  fiat: {
    fontSize: typography.size.sm,
    marginTop: spacing[1],
    fontVariant: ["tabular-nums"],
  },
  subtitle: {
    fontSize: typography.size.sm,
    marginTop: spacing[3],
    textAlign: "center",
  },
  errorBody: {
    fontSize: typography.size.md,
    marginTop: spacing[3],
    textAlign: "center",
  },
  txIdBox: {
    width: "100%",
    marginTop: spacing[5],
    padding: spacing[3],
    borderRadius: radius.sm,
    borderWidth: 1,
  },
  txIdHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: spacing[1],
  },
  txIdLabel: {
    fontSize: typography.size.xs,
    fontWeight: typography.weight.semibold,
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  txIdValue: {
    fontSize: typography.size.xs,
    fontFamily: typography.fontFamily.mono,
  },
  footer: {
    padding: spacing[5],
    gap: spacing[3],
  },
  secondaryBtn: {
    alignSelf: "center",
  },
});
