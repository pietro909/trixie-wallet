import {
  type RouteProp,
  useNavigation,
  useRoute,
} from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { AlertTriangle, ArrowUpRight } from "lucide-react-native";
import * as React from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Button from "../../components/Button";
import { useToast } from "../../components/ToastProvider";
import { useFormatSats } from "../../hooks/useFormatSats";
import { useResolvedTheme } from "../../hooks/useResolvedTheme";
import type { RootStackParamList } from "../../navigation/RootStack";
import { paymentTypeLabel } from "../../services/paymentParser";
import { executeSend, unsupportedReasonFor } from "../../services/sendExecutor";
import { satsToFiat } from "../../store/mock";
import { useAppStore } from "../../store/useAppStore";
import { radius, spacing, typography } from "../../theme/theme";

type Nav = NativeStackNavigationProp<RootStackParamList, "SendReview">;
type Route = RouteProp<RootStackParamList, "SendReview">;

function Row({
  label,
  value,
  mono,
  emphasis,
}: {
  label: string;
  value: string;
  mono?: boolean;
  emphasis?: boolean;
}) {
  const theme = useResolvedTheme();
  return (
    <View style={[rowStyles.row, { borderBottomColor: theme.colors.divider }]}>
      <Text style={[rowStyles.label, { color: theme.colors.textMuted }]}>
        {label}
      </Text>
      <Text
        style={[
          rowStyles.value,
          {
            color: emphasis ? theme.colors.text : theme.colors.text,
            fontWeight: emphasis
              ? typography.weight.semibold
              : typography.weight.medium,
            fontFamily: mono ? typography.fontFamily.mono : undefined,
            fontSize: emphasis ? typography.size.md : typography.size.sm,
          },
        ]}
        numberOfLines={1}
      >
        {value}
      </Text>
    </View>
  );
}

const rowStyles = StyleSheet.create({
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: spacing[3],
    borderBottomWidth: 1,
    gap: spacing[3],
  },
  label: {
    fontSize: typography.size.xs,
    fontWeight: typography.weight.semibold,
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  value: {
    flexShrink: 1,
    textAlign: "right",
    fontVariant: ["tabular-nums"],
  },
});

export default function SendReviewScreen() {
  const theme = useResolvedTheme();
  const nav = useNavigation<Nav>();
  const { option, amountSats } = useRoute<Route>().params;
  const fiatCurrency = useAppStore((s) => s.preferences.fiatCurrency);
  const { format: formatSats, label: unitLabel } = useFormatSats();
  const { showToast } = useToast();

  const [sending, setSending] = React.useState(false);

  const unsupported = unsupportedReasonFor(option);

  async function handleConfirm() {
    setSending(true);
    try {
      const result = await executeSend(option, amountSats);
      if (result.ok) {
        nav.replace("SendResult", {
          status: "success",
          txId: result.txId,
          amountSats: result.amountSats,
          feeSats: result.feeSats,
          paymentType: option.type,
          destination: option.destination,
        });
      } else {
        showToast(result.error, "error");
        nav.replace("SendResult", {
          status: "error",
          message: result.error,
          amountSats,
          paymentType: option.type,
          destination: option.destination,
        });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      showToast(msg, "error");
      nav.replace("SendResult", {
        status: "error",
        message: msg,
        amountSats,
        paymentType: option.type,
        destination: option.destination,
      });
    } finally {
      setSending(false);
    }
  }

  return (
    <SafeAreaView
      edges={["bottom"]}
      style={[styles.container, { backgroundColor: theme.colors.background }]}
    >
      <ScrollView contentContainerStyle={styles.content}>
        <View
          style={[
            styles.headerCard,
            {
              backgroundColor: theme.colors.card,
              borderColor: theme.colors.border,
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
            <ArrowUpRight color={theme.colors.primary} size={24} />
          </View>
          <Text style={[styles.headerAmount, { color: theme.colors.text }]}>
            {formatSats(amountSats)} {unitLabel}
          </Text>
          <Text style={[styles.headerFiat, { color: theme.colors.textMuted }]}>
            ≈ {satsToFiat(amountSats, fiatCurrency)}
          </Text>
        </View>

        <View style={styles.card}>
          <Row label="Payment type" value={paymentTypeLabel(option.type)} />
          <Row label="Destination" value={option.destination} mono />
          {option.memo ? <Row label="Memo" value={option.memo} /> : null}
          <Row
            label="Amount"
            value={`${formatSats(amountSats)} ${unitLabel}`}
            emphasis
          />
          <Row label="Network fee" value="Calculated by Arkade" />
        </View>

        {unsupported ? (
          <View
            style={[
              styles.notice,
              { backgroundColor: `${theme.colors.danger}15` },
            ]}
          >
            <AlertTriangle color={theme.colors.danger} size={16} />
            <Text style={[styles.noticeText, { color: theme.colors.danger }]}>
              {unsupported}
            </Text>
          </View>
        ) : (
          <View
            style={[
              styles.notice,
              { backgroundColor: `${theme.colors.warning}15` },
            ]}
          >
            <AlertTriangle color={theme.colors.warning} size={16} />
            <Text style={[styles.noticeText, { color: theme.colors.warning }]}>
              Fee is determined by the Arkade SDK at send time.
            </Text>
          </View>
        )}
      </ScrollView>

      <View style={styles.footer}>
        <Button
          label={
            sending ? "Sending…" : `Send ${formatSats(amountSats)} ${unitLabel}`
          }
          theme={theme}
          loading={sending}
          disabled={sending || !!unsupported}
          onPress={handleConfirm}
        />
      </View>
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
  headerCard: {
    alignItems: "center",
    paddingVertical: spacing[5],
    borderRadius: radius.lg,
    borderWidth: 1,
  },
  iconWrap: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  headerAmount: {
    fontSize: 32,
    fontWeight: typography.weight.bold,
    fontVariant: ["tabular-nums"],
    marginTop: spacing[3],
  },
  headerFiat: {
    fontSize: typography.size.sm,
    marginTop: spacing[1],
    fontVariant: ["tabular-nums"],
  },
  card: {
    marginTop: spacing[5],
  },
  notice: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    padding: spacing[3],
    borderRadius: radius.sm,
    marginTop: spacing[5],
  },
  noticeText: {
    flex: 1,
    fontSize: typography.size.xs,
    fontWeight: typography.weight.medium,
  },
  footer: {
    padding: spacing[5],
  },
});
