import {
  CommonActions,
  type RouteProp,
  useNavigation,
  useRoute,
} from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { CheckCircle2, Copy, XCircle } from "lucide-react-native";
import * as React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import Button from "../../components/Button";
import { useToast } from "../../components/ToastProvider";
import { useFormatSats } from "../../hooks/useFormatSats";
import { useResolvedTheme } from "../../hooks/useResolvedTheme";
import type { RootStackParamList } from "../../navigation/RootStack";
import {
  prettyAssetAmount,
  truncatedAssetId,
} from "../../services/arkade/asset-format";
import {
  type CachedAssetDetails,
  fetchAssetDetailsCached,
} from "../../services/arkade/asset-metadata";
import { paymentTypeLabel } from "../../services/paymentParser";
import { satsToFiat } from "../../store/mock";
import { useAppStore } from "../../store/useAppStore";
import { radius, spacing, typography } from "../../theme/theme";

type Nav = NativeStackNavigationProp<RootStackParamList, "SendResult">;
type Route = RouteProp<RootStackParamList, "SendResult">;

export default function SendResultScreen() {
  const theme = useResolvedTheme();
  const nav = useNavigation<Nav>();
  const params = useRoute<Route>().params;
  const fiatCurrency = useAppStore((s) => s.preferences.fiatCurrency);
  const network = useAppStore(
    (s) => s.network.detectedNetwork ?? s.wallet?.network ?? null,
  );
  const { format: formatSats, label: unitLabel } = useFormatSats();
  const { showToast } = useToast();

  const ok = params.status === "success";
  const isAssetSend =
    typeof params.assetId === "string" && !!params.assetAmountBase;
  const paymentTypeDisplay =
    params.flow === "lnurl_send"
      ? "LNURL"
      : paymentTypeLabel(params.paymentType);
  let assetAmountBaseParsed: bigint | null = null;
  if (isAssetSend && params.assetAmountBase) {
    try {
      assetAmountBaseParsed = BigInt(params.assetAmountBase);
    } catch {
      assetAmountBaseParsed = null;
    }
  }
  const [assetDetails, setAssetDetails] =
    React.useState<CachedAssetDetails | null>(null);
  React.useEffect(() => {
    const assetId = params.assetId;
    if (!isAssetSend || !assetId || !network) return;
    let cancelled = false;
    void (async () => {
      try {
        const d = await fetchAssetDetailsCached(network, assetId, "cache");
        if (!cancelled) setAssetDetails(d);
      } catch {
        // bare id fallback is fine
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isAssetSend, params.assetId, network]);
  // Route-provided values are canonical (SendAmount only navigates after
  // metadata resolved). Async fetch above only hydrates name/icon/supply.
  const assetDecimals =
    typeof params.assetDecimals === "number"
      ? params.assetDecimals
      : typeof assetDetails?.metadata?.decimals === "number"
        ? assetDetails.metadata.decimals
        : 0;
  const assetTicker =
    params.assetTicker ??
    assetDetails?.metadata?.ticker ??
    (params.assetId ? truncatedAssetId(params.assetId) : "");

  const scale = useSharedValue(0.7);
  const iconStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  React.useEffect(() => {
    // Bouncy overshoot pop. The success/error haptic fires on a short delay so
    // it lands at the apex of the spring rather than at t=0; ~150ms matches the
    // overshoot peak for damping 8 / stiffness 100 — re-tune if those change.
    scale.value = withSpring(1, { damping: 8, stiffness: 100 });
    const apex = setTimeout(() => {
      Haptics.notificationAsync(
        ok
          ? Haptics.NotificationFeedbackType.Success
          : Haptics.NotificationFeedbackType.Error,
      );
    }, 150);
    return () => clearTimeout(apex);
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
        <Animated.View style={iconStyle}>
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
            {isAssetSend && assetAmountBaseParsed != null ? (
              <>
                <Text style={[styles.amount, { color: theme.colors.text }]}>
                  {prettyAssetAmount(assetAmountBaseParsed, assetDecimals)}{" "}
                  {assetTicker}
                </Text>
                {params.amountSats && params.amountSats > 0 ? (
                  <Text
                    style={[styles.fiat, { color: theme.colors.textMuted }]}
                  >
                    + {formatSats(params.amountSats)} {unitLabel} network anchor
                  </Text>
                ) : null}
              </>
            ) : (
              <>
                <Text style={[styles.amount, { color: theme.colors.text }]}>
                  {formatSats(params.amountSats ?? 0)} {unitLabel}
                </Text>
                <Text style={[styles.fiat, { color: theme.colors.textMuted }]}>
                  ≈ {satsToFiat(params.amountSats ?? 0, fiatCurrency)}
                </Text>
              </>
            )}
            <Text style={[styles.subtitle, { color: theme.colors.textMuted }]}>
              {paymentTypeDisplay}
              {isAssetSend ? " · Asset" : ""} · {params.destination}
            </Text>
            {!isAssetSend && params.feeSats && params.feeSats > 0 ? (
              <Text
                style={[styles.subtitle, { color: theme.colors.textSubtle }]}
              >
                Network fee {formatSats(params.feeSats)} {unitLabel}
              </Text>
            ) : null}
            {params.paymentType === "bitcoin" ? (
              <Text
                style={[styles.subtitle, { color: theme.colors.textSubtle }]}
              >
                {params.bitcoinRail === "chainswap"
                  ? "Submitted. Boltz will broadcast a Bitcoin transaction once the offchain leg confirms (~10 min)."
                  : "Submitted. The on-chain transaction will appear once Arkade closes the next batch round."}
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
                    style={[
                      styles.txIdLabel,
                      { color: theme.colors.textMuted },
                    ]}
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
              {paymentTypeDisplay} · {params.destination}
            </Text>
          </>
        )}
      </View>

      <View style={styles.footer}>
        {ok ? (
          <Button label="Done" theme={theme} onPress={goHome} />
        ) : (
          <>
            <Button label="Try again" theme={theme} onPress={tryAgain} />
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
