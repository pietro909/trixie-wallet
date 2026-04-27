import * as React from "react";
import {
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Zap } from "lucide-react-native";
import { useResolvedTheme } from "../../hooks/useResolvedTheme";
import { useAppStore } from "../../store/useAppStore";
import { satsToFiat } from "../../store/mock";
import Button from "../../components/Button";
import type { RootStackParamList } from "../../navigation/RootStack";
import { radius, spacing, typography } from "../../theme/theme";

type Nav = NativeStackNavigationProp<RootStackParamList, "ReceiveLightningAmount">;

const MIN_SATS = 1;
const MAX_SATS = 4_294_967; // arbitrary cap for the mock

export default function ReceiveLightningAmountScreen() {
  const theme = useResolvedTheme();
  const nav = useNavigation<Nav>();
  const fiatCurrency = useAppStore((s) => s.preferences.fiatCurrency);

  const [value, setValue] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  const sats = Number.parseInt(value.replace(/[^0-9]/g, ""), 10);
  const valid = Number.isFinite(sats) && sats >= MIN_SATS && sats <= MAX_SATS;

  function handleChange(text: string) {
    const cleaned = text.replace(/[^0-9]/g, "");
    setValue(cleaned);
    setError(null);
  }

  function handleContinue() {
    if (!valid) {
      setError("Enter an amount between 1 and 4,294,967 sats");
      return;
    }
    nav.replace("ReceiveQR", { type: "lightning", amountSats: sats });
  }

  return (
    <SafeAreaView
      edges={["bottom"]}
      style={[styles.container, { backgroundColor: theme.colors.background }]}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.flex}
      >
        <View style={styles.content}>
          <View
            style={[
              styles.iconWrap,
              { backgroundColor: theme.colors.primarySoft },
            ]}
          >
            <Zap color={theme.colors.primary} size={28} />
          </View>
          <Text style={[styles.title, { color: theme.colors.text }]}>
            Lightning amount
          </Text>
          <Text style={[styles.subtitle, { color: theme.colors.textMuted }]}>
            Lightning invoices are amount-locked. Enter how many sats you want
            to receive.
          </Text>

          <View
            style={[
              styles.inputWrap,
              {
                backgroundColor: theme.colors.surfaceSubtle,
                borderColor: error ? theme.colors.danger : theme.colors.border,
              },
            ]}
          >
            <TextInput
              value={value}
              onChangeText={handleChange}
              placeholder="0"
              placeholderTextColor={theme.colors.placeholder}
              keyboardType="number-pad"
              inputMode="numeric"
              maxLength={9}
              style={[styles.input, { color: theme.colors.text }]}
              accessibilityLabel="Amount in sats"
              autoFocus
            />
            <Text style={[styles.unit, { color: theme.colors.textSubtle }]}>
              sats
            </Text>
          </View>

          {sats > 0 ? (
            <Text style={[styles.fiat, { color: theme.colors.textSubtle }]}>
              ≈ {satsToFiat(sats, fiatCurrency)}
            </Text>
          ) : null}
          {error ? (
            <Text style={[styles.error, { color: theme.colors.danger }]}>
              {error}
            </Text>
          ) : null}
        </View>

        <View style={styles.footer}>
          <Button
            label="Generate invoice"
            theme={theme}
            disabled={!valid}
            onPress={handleContinue}
          />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  flex: { flex: 1 },
  content: {
    flex: 1,
    paddingHorizontal: spacing[5],
    paddingTop: spacing[5],
  },
  iconWrap: {
    width: 56,
    height: 56,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    fontSize: typography.size.xl,
    fontWeight: typography.weight.bold,
    marginTop: spacing[4],
  },
  subtitle: {
    fontSize: typography.size.sm,
    lineHeight: typography.lineHeight.sm,
    marginTop: spacing[2],
    marginBottom: spacing[6],
  },
  inputWrap: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    borderRadius: radius.md,
    borderWidth: 1,
  },
  input: {
    flex: 1,
    fontSize: 32,
    fontWeight: typography.weight.semibold,
    fontVariant: ["tabular-nums"],
    paddingVertical: spacing[2],
  },
  unit: {
    fontSize: typography.size.md,
    fontWeight: typography.weight.semibold,
    marginLeft: spacing[2],
  },
  fiat: {
    fontSize: typography.size.sm,
    marginTop: spacing[3],
    fontVariant: ["tabular-nums"],
  },
  error: {
    fontSize: typography.size.xs,
    marginTop: spacing[3],
  },
  footer: {
    padding: spacing[5],
  },
});
