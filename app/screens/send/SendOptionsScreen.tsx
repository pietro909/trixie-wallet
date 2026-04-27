import * as React from "react";
import {
  Animated,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import {
  AlertCircle,
  AlertTriangle,
  Bitcoin,
  ChevronRight,
  Globe,
  Layers,
  Zap,
} from "lucide-react-native";
import * as Haptics from "expo-haptics";
import { useResolvedTheme } from "../../hooks/useResolvedTheme";
import { useAppStore } from "../../store/useAppStore";
import { satsToFiat, formatSats } from "../../store/mock";
import {
  parsePaymentInput,
  paymentTypeLabel,
  type ParsedPaymentOption,
  type PaymentType,
} from "../../services/paymentParser";
import type { RootStackParamList } from "../../navigation/RootStack";
import { motion, radius, spacing, typography } from "../../theme/theme";

type Nav = NativeStackNavigationProp<RootStackParamList, "SendOptions">;
type Route = RouteProp<RootStackParamList, "SendOptions">;

const ICONS: Record<PaymentType, React.ComponentType<{ color?: string; size?: number }>> = {
  arkade: Layers,
  bitcoin: Bitcoin,
  lightning: Zap,
  lnurl: Globe,
};

function OptionRow({
  option,
  fiatCurrency,
  onPress,
}: {
  option: ParsedPaymentOption;
  fiatCurrency: "EUR" | "USD" | "GBP";
  onPress: () => void;
}) {
  const theme = useResolvedTheme();
  const scale = React.useRef(new Animated.Value(1)).current;
  const Icon = ICONS[option.type];
  const disabled = !option.isPayable;

  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${paymentTypeLabel(option.type)} ${option.destination}`}
        accessibilityState={{ disabled }}
        disabled={disabled}
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
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          onPress();
        }}
        style={[
          styles.row,
          {
            backgroundColor: theme.colors.card,
            borderColor: disabled ? theme.colors.warning : theme.colors.border,
            opacity: disabled ? 0.7 : 1,
            ...theme.shadow("card"),
          },
        ]}
      >
        <View
          style={[
            styles.iconWrap,
            { backgroundColor: theme.colors.primarySoft },
          ]}
        >
          <Icon color={theme.colors.primary} size={22} />
        </View>
        <View style={styles.body}>
          <Text style={[styles.title, { color: theme.colors.text }]}>
            {paymentTypeLabel(option.type)}
          </Text>
          <Text
            numberOfLines={1}
            style={[styles.destination, { color: theme.colors.textMuted }]}
          >
            {option.destination}
          </Text>
          {option.amountSats ? (
            <Text style={[styles.meta, { color: theme.colors.textSubtle }]}>
              {formatSats(option.amountSats)} sats ·{" "}
              {satsToFiat(option.amountSats, fiatCurrency)}
            </Text>
          ) : null}
          {option.memo ? (
            <Text
              numberOfLines={2}
              style={[styles.meta, { color: theme.colors.textSubtle }]}
            >
              “{option.memo}”
            </Text>
          ) : null}
          {option.warning ? (
            <View style={styles.warnRow}>
              <AlertTriangle color={theme.colors.warning} size={14} />
              <Text style={[styles.warning, { color: theme.colors.warning }]}>
                {option.warning}
              </Text>
            </View>
          ) : null}
        </View>
        {!disabled ? (
          <ChevronRight color={theme.colors.textSubtle} size={18} />
        ) : null}
      </Pressable>
    </Animated.View>
  );
}

export default function SendOptionsScreen() {
  const theme = useResolvedTheme();
  const nav = useNavigation<Nav>();
  const route = useRoute<Route>();
  const fiatCurrency = useAppStore((s) => s.preferences.fiatCurrency);

  const parsed = React.useMemo(
    () => parsePaymentInput(route.params.rawInput),
    [route.params.rawInput],
  );

  function handleSelect(option: ParsedPaymentOption) {
    nav.navigate("SendAmount", { option });
  }

  if (parsed.options.length === 0) {
    return (
      <SafeAreaView
        edges={["bottom"]}
        style={[styles.container, { backgroundColor: theme.colors.background }]}
      >
        <View style={styles.errorWrap}>
          <AlertCircle color={theme.colors.danger} size={48} />
          <Text style={[styles.errorTitle, { color: theme.colors.text }]}>
            No payable options
          </Text>
          <Text style={[styles.errorBody, { color: theme.colors.textMuted }]}>
            {parsed.error ?? "The input did not contain a recognised payment."}
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView
      edges={["bottom"]}
      style={[styles.container, { backgroundColor: theme.colors.background }]}
    >
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={[styles.intro, { color: theme.colors.textMuted }]}>
          {parsed.options.length === 1
            ? "Recognised payment option."
            : "Multiple payment options were recognised. Pick one."}
        </Text>
        <View style={styles.list}>
          {parsed.options.map((opt) => (
            <OptionRow
              key={opt.id}
              option={opt}
              fiatCurrency={fiatCurrency}
              onPress={() => handleSelect(opt)}
            />
          ))}
        </View>
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
  intro: {
    fontSize: typography.size.sm,
    marginBottom: spacing[4],
  },
  list: { gap: spacing[3] },
  row: {
    flexDirection: "row",
    alignItems: "center",
    padding: spacing[4],
    borderRadius: radius.md,
    borderWidth: 1,
    gap: spacing[3],
  },
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  body: { flex: 1 },
  title: {
    fontSize: typography.size.md,
    fontWeight: typography.weight.semibold,
  },
  destination: {
    fontSize: typography.size.xs,
    fontFamily: typography.fontFamily.mono,
    marginTop: 2,
  },
  meta: {
    fontSize: typography.size.xs,
    marginTop: 2,
  },
  warnRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: spacing[1],
  },
  warning: {
    fontSize: typography.size.xs,
    fontWeight: typography.weight.medium,
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
