import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Zap } from "lucide-react-native";
import * as React from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Button from "../../components/Button";
import { useToast } from "../../components/ToastProvider";
import { useResolvedTheme } from "../../hooks/useResolvedTheme";
import type { RootStackParamList } from "../../navigation/RootStack";
import { ArkadeError } from "../../services/arkade/errors";
import {
  createLightningInvoice,
  ensureLightning,
  getLightningFees,
  getLightningLimits,
  isLightningSupportedForNetwork,
} from "../../services/arkade/lightning";
import { recordSwapMetadata } from "../../services/arkade/swap-storage";
import { lightningInvoiceExpiresAt } from "../../services/paymentParser";
import { satsToFiat } from "../../store/mock";
import { useAppStore } from "../../store/useAppStore";
import { radius, spacing, typography } from "../../theme/theme";

type Nav = NativeStackNavigationProp<
  RootStackParamList,
  "ReceiveLightningAmount"
>;

type Limits = { min: number; max: number };
type ReverseFees = { percentage: number; minerFeesSats: number };

function estimateCreditedSats(
  amountSats: number,
  fees: ReverseFees | null,
): number | null {
  if (!fees) return null;
  const minerFee = fees.minerFeesSats;
  const boltzPercentFee = Math.ceil(amountSats * (fees.percentage / 100));
  const credited = amountSats - minerFee - boltzPercentFee;
  return credited > 0 ? credited : 0;
}

export default function ReceiveLightningAmountScreen() {
  const theme = useResolvedTheme();
  const nav = useNavigation<Nav>();
  const wallet = useAppStore((s) => s.wallet);
  const walletBehavior = useAppStore((s) => s.walletBehavior);
  const fiatCurrency = useAppStore((s) => s.preferences.fiatCurrency);
  const { showToast } = useToast();

  const [value, setValue] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [limits, setLimits] = React.useState<Limits | null>(null);
  const [fees, setFees] = React.useState<ReverseFees | null>(null);
  const [limitsLoading, setLimitsLoading] = React.useState(true);
  const [submitting, setSubmitting] = React.useState(false);

  const network = wallet?.network ?? null;
  const lightningSupported = isLightningSupportedForNetwork(network);

  React.useEffect(() => {
    if (!wallet || !lightningSupported) {
      setLimitsLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        await ensureLightning({ metadata: wallet, behavior: walletBehavior });
        const [l, f] = await Promise.all([
          getLightningLimits(wallet.network),
          getLightningFees(wallet.network).catch(() => null),
        ]);
        if (cancelled) return;
        setLimits(l);
        if (f) {
          setFees({
            percentage: f.reverse.percentage,
            minerFeesSats:
              f.reverse.minerFees.lockup + f.reverse.minerFees.claim,
          });
        }
      } catch (e) {
        if (cancelled) return;
        const message =
          e instanceof Error ? e.message : "Could not load Boltz limits";
        setError(message);
      } finally {
        if (!cancelled) setLimitsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [wallet, walletBehavior, lightningSupported]);

  const sats = Number.parseInt(value.replace(/[^0-9]/g, ""), 10);
  const sanitizedSats = Number.isFinite(sats) ? sats : 0;
  const creditedEstimate = estimateCreditedSats(sanitizedSats, fees);
  const validRange =
    limits != null &&
    sanitizedSats >= limits.min &&
    sanitizedSats <= limits.max;
  const canContinue =
    !submitting && !limitsLoading && limits != null && validRange;

  function handleChange(text: string) {
    const cleaned = text.replace(/[^0-9]/g, "");
    setValue(cleaned);
    setError(null);
  }

  async function handleContinue() {
    if (!wallet) return;
    if (!limits) return;
    if (sanitizedSats < limits.min) {
      setError(
        `Minimum is ${limits.min.toLocaleString()} sats — below this Boltz fees would exceed the amount`,
      );
      return;
    }
    if (sanitizedSats > limits.max) {
      setError(`Maximum is ${limits.max.toLocaleString()} sats`);
      return;
    }
    setSubmitting(true);
    try {
      const response = await createLightningInvoice({
        amount: sanitizedSats,
        description: `Trixie ${sanitizedSats} sats`,
      });
      await recordSwapMetadata({
        swapId: response.pendingSwap.id,
        walletId: wallet.id,
        direction: "in",
        createdForFlow: "receive",
        invoiceAmountSats: sanitizedSats,
        arkadeAmountSats: response.amount,
        paymentHash: response.paymentHash,
      });
      nav.replace("ReceiveQR", {
        type: "lightning",
        amountSats: sanitizedSats,
        lightningInvoice: response.invoice,
        lightningCreditedSats: response.amount,
        lightningExpiresAt: lightningInvoiceExpiresAt(response.invoice),
        lightningSwapId: response.pendingSwap.id,
      });
    } catch (e) {
      const message =
        e instanceof ArkadeError
          ? e.message
          : e instanceof Error
            ? e.message
            : "Could not create invoice";
      setError(message);
      showToast("Invoice creation failed", "error");
    } finally {
      setSubmitting(false);
    }
  }

  if (!lightningSupported) {
    return (
      <SafeAreaView
        edges={["bottom"]}
        style={[styles.container, { backgroundColor: theme.colors.background }]}
      >
        <View style={styles.content}>
          <Text style={[styles.title, { color: theme.colors.text }]}>
            Lightning unavailable
          </Text>
          <Text style={[styles.subtitle, { color: theme.colors.textMuted }]}>
            Boltz is not configured for {network ?? "this network"}.
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
            Lightning invoices are amount-locked. Enter how many sats the payer
            should send.
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
              editable={!limitsLoading && !submitting}
            />
            <Text style={[styles.unit, { color: theme.colors.textSubtle }]}>
              sats
            </Text>
          </View>

          {sanitizedSats > 0 ? (
            <Text style={[styles.fiat, { color: theme.colors.textSubtle }]}>
              ≈ {satsToFiat(sanitizedSats, fiatCurrency)}
            </Text>
          ) : null}

          <View style={styles.helperBlock}>
            {limitsLoading ? (
              <View style={styles.helperRow}>
                <ActivityIndicator
                  size="small"
                  color={theme.colors.textSubtle}
                />
                <Text
                  style={[
                    styles.helperText,
                    { color: theme.colors.textSubtle },
                  ]}
                >
                  Loading Boltz limits…
                </Text>
              </View>
            ) : limits ? (
              <Text
                style={[styles.helperText, { color: theme.colors.textSubtle }]}
              >
                Boltz limits: {limits.min.toLocaleString()} –{" "}
                {limits.max.toLocaleString()} sats
              </Text>
            ) : null}
            {creditedEstimate != null && validRange ? (
              <Text
                style={[styles.helperText, { color: theme.colors.textSubtle }]}
              >
                You'll receive ≈ {creditedEstimate.toLocaleString()} sats after
                Boltz fees
              </Text>
            ) : !fees && validRange ? (
              <Text
                style={[styles.helperText, { color: theme.colors.textSubtle }]}
              >
                Final fees calculated when the invoice is created
              </Text>
            ) : null}
          </View>

          {error ? (
            <Text style={[styles.error, { color: theme.colors.danger }]}>
              {error}
            </Text>
          ) : null}
        </View>

        <View style={styles.footer}>
          <Button
            label={submitting ? "Creating invoice…" : "Generate invoice"}
            theme={theme}
            disabled={!canContinue}
            loading={submitting}
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
  helperBlock: {
    marginTop: spacing[4],
    gap: spacing[1],
  },
  helperRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
  },
  helperText: {
    fontSize: typography.size.xs,
    lineHeight: typography.lineHeight.xs,
  },
  error: {
    fontSize: typography.size.xs,
    marginTop: spacing[3],
  },
  footer: {
    padding: spacing[5],
  },
});
