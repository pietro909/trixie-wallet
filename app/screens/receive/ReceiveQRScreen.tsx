import {
  type RouteProp,
  useNavigation,
  useRoute,
} from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import {
  AlertCircle,
  CheckCircle2,
  Copy,
  Plus,
  Share2,
  XCircle,
} from "lucide-react-native";
import * as React from "react";
import {
  Animated,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from "react-native";
import QRCode from "react-native-qrcode-svg";
import { SafeAreaView } from "react-native-safe-area-context";
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
import {
  makeAllPayloads,
  makeReceivePayload,
  type ReceivePayload,
} from "../../services/receive";
import { satsToFiat } from "../../store/mock";
import { useAppStore } from "../../store/useAppStore";
import { motion, radius, spacing, typography } from "../../theme/theme";

type Nav = NativeStackNavigationProp<RootStackParamList, "ReceiveQR">;
type Route = RouteProp<RootStackParamList, "ReceiveQR">;

function CopyRow({
  payload,
  isPrimary,
  onCopy,
}: {
  payload: ReceivePayload;
  isPrimary?: boolean;
  onCopy: (p: ReceivePayload) => void;
}) {
  const theme = useResolvedTheme();
  const scale = React.useRef(new Animated.Value(1)).current;
  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <Pressable
        accessibilityLabel={`Copy ${payload.label}`}
        onPress={() => onCopy(payload)}
        onPressIn={() =>
          Animated.spring(scale, {
            toValue: motion.press.scaleDown,
            useNativeDriver: true,
            speed: 22,
            bounciness: 0,
          }).start()
        }
        onPressOut={() =>
          Animated.spring(scale, {
            toValue: 1,
            useNativeDriver: true,
            speed: 18,
            bounciness: 6,
          }).start()
        }
        style={[
          styles.payloadRow,
          {
            backgroundColor: isPrimary
              ? theme.colors.primarySoft
              : theme.colors.surfaceSubtle,
          },
        ]}
      >
        <View style={styles.payloadInfo}>
          <Text
            style={[
              styles.payloadLabel,
              {
                color: isPrimary
                  ? theme.colors.primary
                  : theme.colors.textMuted,
              },
            ]}
          >
            {payload.label}
            {isPrimary ? " · current" : ""}
          </Text>
          <Text
            numberOfLines={1}
            style={[styles.payloadDestination, { color: theme.colors.text }]}
          >
            {payload.destination}
          </Text>
        </View>
        <Copy
          color={isPrimary ? theme.colors.primary : theme.colors.textMuted}
          size={18}
        />
      </Pressable>
    </Animated.View>
  );
}

export default function ReceiveQRScreen() {
  const theme = useResolvedTheme();
  const nav = useNavigation<Nav>();
  const route = useRoute<Route>();
  const { type, amountSats, assetId, assetAmountBase } = route.params;
  const { showToast } = useToast();
  const fiatCurrency = useAppStore((s) => s.preferences.fiatCurrency);
  const wallet = useAppStore((s) => s.wallet);
  const network = useAppStore(
    (s) => s.network.detectedNetwork ?? s.wallet?.network ?? null,
  );
  const { format: formatSats, label: unitLabel } = useFormatSats();

  const [assetDetails, setAssetDetails] =
    React.useState<CachedAssetDetails | null>(null);

  React.useEffect(() => {
    if (!assetId || !network) return;
    let cancelled = false;
    void (async () => {
      try {
        const d = await fetchAssetDetailsCached(network, assetId, "cache");
        if (!cancelled) setAssetDetails(d);
      } catch {
        // best-effort; bare id still works
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [assetId, network]);

  const setTitle = nav.setOptions;
  React.useEffect(() => {
    if (assetId) {
      const ticker =
        assetDetails?.metadata?.ticker ?? truncatedAssetId(assetId);
      setTitle({ title: `Receive ${ticker}` });
    } else {
      setTitle({ title: paymentTypeLabel(type) });
    }
  }, [setTitle, type, assetId, assetDetails]);

  const lightningInvoice = route.params.lightningInvoice;
  const lightningCreditedSats = route.params.lightningCreditedSats;
  const lightningExpiresAt = route.params.lightningExpiresAt;
  const lightningSwapId = route.params.lightningSwapId;

  // Track our swap's status from the store-side activity list. The global swap
  // listener in useAppStore refreshes activities on every SwapManager event,
  // so we just react to its state to surface success/failure on this screen.
  const swapActivity = useAppStore((s) => {
    if (type !== "lightning" || !lightningSwapId) return null;
    return (
      s.wallet?.activities.find(
        (a) =>
          a.source.type === "boltz_swap" && a.source.swapId === lightningSwapId,
      ) ?? null
    );
  });
  const swapStatus = swapActivity?.status;

  // For non-Lightning receive flows (arkade onchain/offchain), watch the
  // wallet activity list — driven by the global incoming-funds listener — and
  // celebrate the first new incoming payment that arrives after this screen
  // mounted.
  const baselineRef = React.useRef<Set<string> | null>(null);
  const arkadeActivities = useAppStore((s) => s.wallet?.activities ?? null);
  if (baselineRef.current == null && arkadeActivities) {
    baselineRef.current = new Set(arkadeActivities.map((a) => a.id));
  }
  const arkadeReceived = React.useMemo(() => {
    if (type === "lightning") return null;
    if (!arkadeActivities) return null;
    const baseline = baselineRef.current;
    if (!baseline) return null;
    return (
      arkadeActivities.find(
        (a) =>
          !baseline.has(a.id) &&
          a.kind === "payment" &&
          a.direction === "in" &&
          a.rail === "arkade",
      ) ?? null
    );
  }, [type, arkadeActivities]);

  const [primary, all, error] = React.useMemo<
    [ReceivePayload | null, ReceivePayload[], string | null]
  >(() => {
    if (!wallet) return [null, [], "No wallet available"];
    if (type === "lightning") {
      if (!lightningInvoice) {
        return [null, [], "Missing Lightning invoice"];
      }
      const invoiceLabel =
        amountSats != null
          ? `Lightning · ${amountSats.toLocaleString()} sats`
          : "Lightning invoice";
      const main: ReceivePayload = {
        type: "lightning",
        label: invoiceLabel,
        payload: lightningInvoice,
        destination: lightningInvoice,
        amountSats,
      };
      return [main, [main], null];
    }
    try {
      const opts = {
        amountSats,
        assetId,
        assetAmountBase,
        assetTicker: assetDetails?.metadata?.ticker,
      };
      const main = makeReceivePayload(wallet, type, opts);
      const list = makeAllPayloads(wallet, type, opts);
      return [main, list, null];
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not generate payload";
      return [null, [], msg];
    }
  }, [
    wallet,
    type,
    amountSats,
    lightningInvoice,
    assetId,
    assetAmountBase,
    assetDetails,
  ]);

  const [now, setNow] = React.useState<number>(() => Date.now());
  React.useEffect(() => {
    if (type !== "lightning" || !lightningExpiresAt) return;
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, [type, lightningExpiresAt]);
  const expired =
    type === "lightning" &&
    lightningExpiresAt != null &&
    lightningExpiresAt <= now;

  async function handleCopy(p: ReceivePayload) {
    try {
      await Clipboard.setStringAsync(p.payload);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      showToast(`${p.label} copied`, "success");
    } catch {
      showToast("Could not copy to clipboard", "error");
    }
  }

  async function handleShare() {
    if (!primary) return;
    try {
      await Share.share({
        message: primary.payload,
        title: `${primary.label} payment request`,
      });
    } catch {
      showToast("Could not open share sheet", "error");
    }
  }

  if (error || !primary) {
    return (
      <SafeAreaView
        edges={["bottom"]}
        style={[styles.container, { backgroundColor: theme.colors.background }]}
      >
        <View style={styles.errorWrap}>
          <AlertCircle color={theme.colors.danger} size={48} />
          <Text style={[styles.errorTitle, { color: theme.colors.text }]}>
            Could not generate QR
          </Text>
          <Text style={[styles.errorBody, { color: theme.colors.textMuted }]}>
            {error ?? "Unknown error"}
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  const others = all.filter((p) => p.payload !== primary.payload);
  const showAddAmount = type !== "lnurl" && type !== "lightning" && !amountSats;
  const lightningSettled = swapStatus === "confirmed";
  const lightningFailed = swapStatus === "failed" || swapStatus === "refunded";
  const received = lightningSettled || arkadeReceived != null;
  const receivedAmountSats = lightningSettled
    ? (swapActivity?.amountSats ?? lightningCreditedSats ?? primary.amountSats)
    : (arkadeReceived?.amountSats ?? primary.amountSats);
  // Only boarding deposits actually need to wait for an onchain confirmation;
  // arkade offchain receives are usable immediately. The activity id prefix
  // is the cheapest way to discriminate without inspecting raw metadata.
  const receivedIsBoarding =
    arkadeReceived?.id.startsWith("arkade:boarding:") === true;
  const receivedPending =
    receivedIsBoarding && arkadeReceived?.status === "pending";
  const receivedTitle = receivedPending
    ? "Payment detected"
    : "Payment received";
  const receivedHint = lightningSettled
    ? "Funds claimed and added to your wallet."
    : receivedPending
      ? "Detected onchain — waiting for confirmation."
      : "Funds added to your wallet.";

  return (
    <SafeAreaView
      edges={["bottom"]}
      style={[styles.container, { backgroundColor: theme.colors.background }]}
    >
      <ScrollView contentContainerStyle={styles.content}>
        <View
          style={[
            styles.qrCard,
            {
              backgroundColor: theme.colors.card,
              borderColor: theme.colors.border,
              ...theme.shadow("card"),
            },
          ]}
        >
          {received ? (
            <View style={styles.lightningSettledWrap}>
              <CheckCircle2 color={theme.colors.success} size={72} />
              <Text style={[styles.settledTitle, { color: theme.colors.text }]}>
                {receivedTitle}
              </Text>
              {receivedAmountSats != null ? (
                <Text
                  style={[
                    styles.settledAmount,
                    { color: theme.colors.success },
                  ]}
                >
                  +{formatSats(receivedAmountSats)} {unitLabel}
                </Text>
              ) : null}
              <Text
                style={[styles.settledHint, { color: theme.colors.textSubtle }]}
              >
                {receivedHint}
              </Text>
            </View>
          ) : lightningFailed ? (
            <View style={styles.lightningSettledWrap}>
              <XCircle color={theme.colors.danger} size={72} />
              <Text style={[styles.settledTitle, { color: theme.colors.text }]}>
                Payment failed
              </Text>
              <Text
                style={[styles.settledHint, { color: theme.colors.textSubtle }]}
              >
                The swap reached a terminal failure state. Generate a new
                invoice to try again.
              </Text>
            </View>
          ) : (
            <View style={styles.qrInner}>
              <QRCode
                value={primary.payload}
                size={232}
                backgroundColor="#ffffff"
                color="#000000"
              />
            </View>
          )}
          {!received && !lightningFailed ? (
            <Text
              numberOfLines={1}
              style={[styles.destination, { color: theme.colors.text }]}
              selectable
            >
              {primary.destination}
            </Text>
          ) : null}
          {received || lightningFailed ? null : type === "lightning" &&
            primary.amountSats ? (
            <View style={styles.lightningAmounts}>
              <Text style={[styles.amount, { color: theme.colors.textSubtle }]}>
                Payer pays {formatSats(primary.amountSats)} {unitLabel}
                {" · "}
                {satsToFiat(primary.amountSats, fiatCurrency)}
              </Text>
              {lightningCreditedSats != null ? (
                <Text
                  style={[styles.amount, { color: theme.colors.textSubtle }]}
                >
                  You receive ≈ {formatSats(lightningCreditedSats)} {unitLabel}{" "}
                  after Boltz fees
                </Text>
              ) : null}
              {lightningExpiresAt != null ? (
                <Text
                  style={[
                    styles.amount,
                    {
                      color: expired
                        ? theme.colors.danger
                        : theme.colors.textSubtle,
                    },
                  ]}
                >
                  {expired
                    ? "Invoice expired — generate a new one"
                    : `Expires ${new Date(
                        lightningExpiresAt,
                      ).toLocaleTimeString(undefined, {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}`}
                </Text>
              ) : null}
            </View>
          ) : assetId ? (
            <Text style={[styles.amount, { color: theme.colors.textSubtle }]}>
              {assetAmountBase
                ? `${prettyAssetAmount(
                    BigInt(assetAmountBase),
                    typeof assetDetails?.metadata?.decimals === "number"
                      ? assetDetails.metadata.decimals
                      : 0,
                  )} ${assetDetails?.metadata?.ticker ?? truncatedAssetId(assetId)}`
                : `Receive ${assetDetails?.metadata?.ticker ?? truncatedAssetId(assetId)} — sender enters amount`}
            </Text>
          ) : primary.amountSats ? (
            <Text style={[styles.amount, { color: theme.colors.textSubtle }]}>
              {formatSats(primary.amountSats)} {unitLabel} ·{" "}
              {satsToFiat(primary.amountSats, fiatCurrency)}
            </Text>
          ) : type === "lnurl" ? (
            <Text style={[styles.amount, { color: theme.colors.textSubtle }]}>
              Sender chooses the amount
            </Text>
          ) : (
            <Text style={[styles.amount, { color: theme.colors.textSubtle }]}>
              No fixed amount
            </Text>
          )}
        </View>

        {received || lightningFailed ? (
          <View style={styles.actions}>
            <Pressable
              accessibilityLabel="Back to wallet"
              onPress={() => nav.popToTop()}
              style={({ pressed }) => [
                styles.actionBtn,
                {
                  backgroundColor: theme.colors.primary,
                  borderColor: theme.colors.primary,
                  opacity: pressed ? 0.9 : 1,
                },
              ]}
            >
              <Text
                style={[styles.actionLabel, { color: theme.colors.onPrimary }]}
              >
                Back to wallet
              </Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.actions}>
            <Pressable
              accessibilityLabel="Copy payload"
              onPress={() => handleCopy(primary)}
              style={({ pressed }) => [
                styles.actionBtn,
                {
                  backgroundColor: theme.colors.surfaceSubtle,
                  borderColor: theme.colors.border,
                  opacity: pressed ? 0.85 : 1,
                },
              ]}
            >
              <Copy color={theme.colors.text} size={18} />
              <Text style={[styles.actionLabel, { color: theme.colors.text }]}>
                Copy
              </Text>
            </Pressable>
            <Pressable
              accessibilityLabel="Share payload"
              onPress={handleShare}
              style={({ pressed }) => [
                styles.actionBtn,
                {
                  backgroundColor: theme.colors.primary,
                  borderColor: theme.colors.primary,
                  opacity: pressed ? 0.9 : 1,
                },
              ]}
            >
              <Share2 color={theme.colors.onPrimary} size={18} />
              <Text
                style={[styles.actionLabel, { color: theme.colors.onPrimary }]}
              >
                Share
              </Text>
            </Pressable>
          </View>
        )}

        {showAddAmount ? (
          <Pressable
            onPress={() => nav.navigate("ReceiveLightningAmount")}
            style={({ pressed }) => [
              styles.addAmount,
              {
                borderColor: theme.colors.border,
                opacity: pressed ? 0.7 : 1,
              },
            ]}
          >
            <Plus color={theme.colors.primary} size={16} />
            <Text
              style={[styles.addAmountText, { color: theme.colors.primary }]}
            >
              Need a fixed-amount Lightning invoice instead?
            </Text>
          </Pressable>
        ) : null}

        {others.length > 0 ? (
          <View style={styles.otherSection}>
            <Text
              style={[styles.otherTitle, { color: theme.colors.textMuted }]}
            >
              Other ways to receive
            </Text>
            <View style={styles.payloadList}>
              {others.map((p) => (
                <CopyRow
                  key={`${p.type}:${p.payload}`}
                  payload={p}
                  onCopy={handleCopy}
                />
              ))}
            </View>
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: {
    paddingHorizontal: spacing[5],
    paddingTop: spacing[3],
    paddingBottom: spacing[8],
  },
  qrCard: {
    alignItems: "center",
    paddingVertical: spacing[5],
    paddingHorizontal: spacing[4],
    borderRadius: radius.lg,
    borderWidth: 1,
  },
  qrInner: {
    padding: spacing[4],
    backgroundColor: "#ffffff",
    borderRadius: radius.md,
  },
  destination: {
    marginTop: spacing[4],
    fontSize: typography.size.sm,
    fontFamily: typography.fontFamily.mono,
  },
  amount: {
    marginTop: spacing[2],
    fontSize: typography.size.xs,
  },
  lightningAmounts: {
    marginTop: spacing[2],
    gap: spacing[1],
    alignItems: "center",
  },
  lightningSettledWrap: {
    alignItems: "center",
    paddingVertical: spacing[5],
    paddingHorizontal: spacing[4],
    gap: spacing[2],
  },
  settledTitle: {
    marginTop: spacing[3],
    fontSize: typography.size.lg,
    fontWeight: typography.weight.semibold,
  },
  settledAmount: {
    fontSize: typography.size.xl,
    fontWeight: typography.weight.bold,
    fontVariant: ["tabular-nums"],
  },
  settledHint: {
    marginTop: spacing[2],
    fontSize: typography.size.sm,
    textAlign: "center",
    lineHeight: typography.lineHeight.sm,
  },
  actions: {
    flexDirection: "row",
    gap: spacing[3],
    marginTop: spacing[4],
  },
  actionBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: spacing[3],
    paddingHorizontal: spacing[4],
    borderRadius: radius.md,
    borderWidth: 1,
    gap: spacing[2],
    minHeight: 48,
  },
  actionLabel: {
    fontSize: typography.size.md,
    fontWeight: typography.weight.semibold,
  },
  addAmount: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    marginTop: spacing[4],
    paddingVertical: spacing[3],
    paddingHorizontal: spacing[4],
    borderRadius: radius.md,
    borderWidth: 1,
    borderStyle: "dashed",
  },
  addAmountText: {
    fontSize: typography.size.sm,
    fontWeight: typography.weight.medium,
  },
  otherSection: { marginTop: spacing[6] },
  otherTitle: {
    fontSize: typography.size.xs,
    fontWeight: typography.weight.semibold,
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: spacing[3],
  },
  payloadList: { gap: spacing[2] },
  payloadRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing[3],
    paddingHorizontal: spacing[4],
    borderRadius: radius.md,
    gap: spacing[3],
  },
  payloadInfo: { flex: 1 },
  payloadLabel: {
    fontSize: typography.size.xs,
    fontWeight: typography.weight.semibold,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  payloadDestination: {
    fontSize: typography.size.sm,
    fontFamily: typography.fontFamily.mono,
    marginTop: 2,
  },
  errorWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing[6],
  },
  errorTitle: {
    fontSize: typography.size.lg,
    fontWeight: typography.weight.semibold,
    marginTop: spacing[4],
  },
  errorBody: {
    fontSize: typography.size.sm,
    marginTop: spacing[2],
    textAlign: "center",
  },
});
