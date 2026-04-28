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
import { SafeAreaView } from "react-native-safe-area-context";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import {
  AlertCircle,
  Copy,
  Plus,
  Share2,
} from "lucide-react-native";
import * as Haptics from "expo-haptics";
import * as Clipboard from "expo-clipboard";
import QRCode from "react-native-qrcode-svg";
import { useResolvedTheme } from "../../hooks/useResolvedTheme";
import { useAppStore } from "../../store/useAppStore";
import { useToast } from "../../components/ToastProvider";
import { satsToFiat, formatSats } from "../../store/mock";
import {
  makeAllPayloads,
  makeReceivePayload,
  type ReceivePayload,
} from "../../services/receive";
import { paymentTypeLabel } from "../../services/paymentParser";
import type { RootStackParamList } from "../../navigation/RootStack";
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
                color: isPrimary ? theme.colors.primary : theme.colors.textMuted,
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
  const { type, amountSats } = route.params;
  const { showToast } = useToast();
  const fiatCurrency = useAppStore((s) => s.preferences.fiatCurrency);
  const wallet = useAppStore((s) => s.wallet);

  const setTitle = nav.setOptions;
  React.useEffect(() => {
    setTitle({ title: paymentTypeLabel(type) });
  }, [setTitle, type]);

  const [primary, all, error] = React.useMemo<
    [ReceivePayload | null, ReceivePayload[], string | null]
  >(() => {
    if (!wallet) return [null, [], "No wallet available"];
    try {
      const main = makeReceivePayload(wallet, type, { amountSats });
      const list = makeAllPayloads(wallet, type, { amountSats });
      return [main, list, null];
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not generate payload";
      return [null, [], msg];
    }
  }, [wallet, type, amountSats]);

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
          <View style={styles.qrInner}>
            <QRCode
              value={primary.payload}
              size={232}
              backgroundColor="#ffffff"
              color="#000000"
            />
          </View>
          <Text
            numberOfLines={1}
            style={[styles.destination, { color: theme.colors.text }]}
            selectable
          >
            {primary.destination}
          </Text>
          {primary.amountSats ? (
            <Text style={[styles.amount, { color: theme.colors.textSubtle }]}>
              {formatSats(primary.amountSats)} sats ·{" "}
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
            <Text style={[styles.addAmountText, { color: theme.colors.primary }]}>
              Need a fixed-amount Lightning invoice instead?
            </Text>
          </Pressable>
        ) : null}

        {others.length > 0 ? (
          <View style={styles.otherSection}>
            <Text style={[styles.otherTitle, { color: theme.colors.textMuted }]}>
              Other ways to receive
            </Text>
            <View style={styles.payloadList}>
              {others.map((p) => (
                <CopyRow key={`${p.type}:${p.payload}`} payload={p} onCopy={handleCopy} />
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
