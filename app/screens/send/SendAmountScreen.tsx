import * as React from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Lock } from "lucide-react-native";
import { useResolvedTheme } from "../../hooks/useResolvedTheme";
import { useAppStore } from "../../store/useAppStore";
import { satsToFiat, formatSats } from "../../store/mock";
import Button from "../../components/Button";
import { paymentTypeLabel } from "../../services/paymentParser";
import type { RootStackParamList } from "../../navigation/RootStack";
import { radius, spacing, typography } from "../../theme/theme";

type Nav = NativeStackNavigationProp<RootStackParamList, "SendAmount">;
type Route = RouteProp<RootStackParamList, "SendAmount">;

const PRESETS = [1_000, 10_000, 100_000];

export default function SendAmountScreen() {
  const theme = useResolvedTheme();
  const nav = useNavigation<Nav>();
  const { option } = useRoute<Route>().params;
  const fiatCurrency = useAppStore((s) => s.preferences.fiatCurrency);
  const wallet = useAppStore((s) =>
    s.walletContainer?.wallets.find(
      (w) => w.id === s.walletContainer?.activeWalletId,
    ),
  );

  // Lightning invoices with an embedded amount are amount-locked.
  const isLocked = option.type === "lightning" && !!option.amountSats;

  const [value, setValue] = React.useState<string>(
    option.amountSats ? String(option.amountSats) : "",
  );
  const [error, setError] = React.useState<string | null>(null);

  const sats = Number.parseInt(value.replace(/[^0-9]/g, ""), 10);
  const balance = wallet?.balanceSats ?? 0;
  const valid = Number.isFinite(sats) && sats > 0;
  const insufficient = valid && sats > balance;

  function handleContinue() {
    if (!valid) {
      setError("Enter an amount in sats");
      return;
    }
    if (insufficient) {
      setError("Amount exceeds wallet balance");
      return;
    }
    nav.navigate("SendReview", { option, amountSats: sats });
  }

  function handleChange(text: string) {
    if (isLocked) return;
    setValue(text.replace(/[^0-9]/g, ""));
    setError(null);
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
              styles.summary,
              {
                backgroundColor: theme.colors.surfaceSubtle,
                borderColor: theme.colors.border,
              },
            ]}
          >
            <Text style={[styles.summaryLabel, { color: theme.colors.textMuted }]}>
              Sending via
            </Text>
            <Text style={[styles.summaryType, { color: theme.colors.text }]}>
              {paymentTypeLabel(option.type)}
            </Text>
            <Text
              style={[styles.summaryDest, { color: theme.colors.textSubtle }]}
              numberOfLines={1}
            >
              {option.destination}
            </Text>
            {option.memo ? (
              <Text style={[styles.summaryMemo, { color: theme.colors.textSubtle }]}>
                “{option.memo}”
              </Text>
            ) : null}
          </View>

          <View style={styles.amountSection}>
            <View style={styles.amountHeader}>
              <Text style={[styles.amountTitle, { color: theme.colors.textMuted }]}>
                Amount
              </Text>
              {isLocked ? (
                <View style={styles.lockedTag}>
                  <Lock color={theme.colors.textSubtle} size={12} />
                  <Text
                    style={[styles.lockedTagText, { color: theme.colors.textSubtle }]}
                  >
                    Fixed
                  </Text>
                </View>
              ) : null}
            </View>
            <View
              style={[
                styles.inputWrap,
                {
                  backgroundColor: theme.colors.surfaceSubtle,
                  borderColor: error
                    ? theme.colors.danger
                    : theme.colors.border,
                  opacity: isLocked ? 0.85 : 1,
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
                editable={!isLocked}
                autoFocus={!isLocked}
                style={[styles.input, { color: theme.colors.text }]}
                accessibilityLabel="Amount in sats"
              />
              <Text style={[styles.unit, { color: theme.colors.textSubtle }]}>
                sats
              </Text>
            </View>

            <View style={styles.metaRow}>
              <Text style={[styles.metaText, { color: theme.colors.textSubtle }]}>
                {sats > 0 ? `≈ ${satsToFiat(sats, fiatCurrency)}` : " "}
              </Text>
              <Text style={[styles.metaText, { color: theme.colors.textSubtle }]}>
                Balance: {formatSats(balance)} sats
              </Text>
            </View>

            {!isLocked ? (
              <View style={styles.presets}>
                {PRESETS.map((p) => (
                  <Pressable
                    key={p}
                    onPress={() => {
                      setValue(String(p));
                      setError(null);
                    }}
                    style={({ pressed }) => [
                      styles.preset,
                      {
                        borderColor: theme.colors.border,
                        backgroundColor: theme.colors.surfaceSubtle,
                        opacity: pressed ? 0.7 : 1,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.presetLabel,
                        { color: theme.colors.text },
                      ]}
                    >
                      {formatSats(p)}
                    </Text>
                  </Pressable>
                ))}
                <Pressable
                  onPress={() => {
                    setValue(String(balance));
                    setError(null);
                  }}
                  style={({ pressed }) => [
                    styles.preset,
                    {
                      borderColor: theme.colors.primary,
                      backgroundColor: theme.colors.primarySoft,
                      opacity: pressed ? 0.7 : 1,
                    },
                  ]}
                >
                  <Text
                    style={[styles.presetLabel, { color: theme.colors.primary }]}
                  >
                    Max
                  </Text>
                </Pressable>
              </View>
            ) : null}

            {error ? (
              <Text style={[styles.error, { color: theme.colors.danger }]}>
                {error}
              </Text>
            ) : null}
          </View>
        </View>

        <View style={styles.footer}>
          <Button
            label="Review"
            theme={theme}
            disabled={!valid || insufficient}
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
    paddingTop: spacing[3],
  },
  summary: {
    padding: spacing[4],
    borderRadius: radius.md,
    borderWidth: 1,
  },
  summaryLabel: {
    fontSize: typography.size.xs,
    fontWeight: typography.weight.semibold,
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  summaryType: {
    fontSize: typography.size.lg,
    fontWeight: typography.weight.semibold,
    marginTop: spacing[1],
  },
  summaryDest: {
    fontSize: typography.size.sm,
    fontFamily: typography.fontFamily.mono,
    marginTop: spacing[1],
  },
  summaryMemo: {
    fontSize: typography.size.xs,
    marginTop: spacing[2],
    fontStyle: "italic",
  },
  amountSection: {
    marginTop: spacing[6],
  },
  amountHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    marginBottom: spacing[2],
  },
  amountTitle: {
    fontSize: typography.size.xs,
    fontWeight: typography.weight.semibold,
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  lockedTag: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  lockedTagText: {
    fontSize: typography.size.xs,
    fontWeight: typography.weight.medium,
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
  },
  unit: {
    fontSize: typography.size.md,
    fontWeight: typography.weight.semibold,
    marginLeft: spacing[2],
  },
  metaRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: spacing[3],
  },
  metaText: {
    fontSize: typography.size.xs,
    fontVariant: ["tabular-nums"],
  },
  presets: {
    flexDirection: "row",
    gap: spacing[2],
    marginTop: spacing[4],
  },
  preset: {
    paddingVertical: spacing[2],
    paddingHorizontal: spacing[3],
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  presetLabel: {
    fontSize: typography.size.xs,
    fontWeight: typography.weight.semibold,
  },
  error: {
    fontSize: typography.size.xs,
    marginTop: spacing[3],
  },
  footer: {
    padding: spacing[5],
  },
});
