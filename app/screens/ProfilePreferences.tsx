import { Pressable, StyleSheet, Switch, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useResolvedTheme } from "../hooks/useResolvedTheme";
import type { BitcoinUnit, FiatCurrency, ThemePref } from "../store/types";
import { useAppStore } from "../store/useAppStore";
import { radius, spacing, typography } from "../theme/theme";

const THEME_OPTIONS: { label: string; value: ThemePref }[] = [
  { label: "System", value: "system" },
  { label: "Light", value: "light" },
  { label: "Dark", value: "dark" },
];

const CURRENCY_OPTIONS: { label: string; value: FiatCurrency }[] = [
  { label: "EUR", value: "EUR" },
  { label: "USD", value: "USD" },
  { label: "GBP", value: "GBP" },
];

const BITCOIN_UNIT_OPTIONS: { label: string; value: BitcoinUnit }[] = [
  { label: "Satoshi (SAT)", value: "sats" },
  { label: "Bitcoin (₿)", value: "btc" },
  { label: "Automatic", value: "auto" },
];

export default function ProfilePreferences() {
  const theme = useResolvedTheme();
  const currentTheme = useAppStore((s) => s.preferences.theme);
  const currentCurrency = useAppStore((s) => s.preferences.fiatCurrency);
  const currentBitcoinUnit = useAppStore((s) => s.preferences.bitcoinUnit);
  const notificationPrefs = useAppStore((s) => s.preferences.notifications);
  const setThemePref = useAppStore((s) => s.setTheme);
  const setFiatCurrency = useAppStore((s) => s.setFiatCurrency);
  const setBitcoinUnit = useAppStore((s) => s.setBitcoinUnit);
  const setNotificationPrefs = useAppStore((s) => s.setNotificationPreferences);

  return (
    <SafeAreaView
      edges={["bottom"]}
      style={[styles.container, { backgroundColor: theme.colors.background }]}
    >
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: theme.colors.textMuted }]}>
          Theme
        </Text>
        <View
          style={[
            styles.optionGroup,
            { backgroundColor: theme.colors.card, ...theme.shadow("card") },
          ]}
        >
          {THEME_OPTIONS.map((opt) => (
            <Pressable
              key={opt.value}
              onPress={() => setThemePref(opt.value)}
              style={[
                styles.option,
                currentTheme === opt.value && {
                  backgroundColor: theme.colors.primarySoft,
                },
              ]}
            >
              <Text
                style={[
                  styles.optionLabel,
                  {
                    color:
                      currentTheme === opt.value
                        ? theme.colors.primary
                        : theme.colors.text,
                    fontWeight:
                      currentTheme === opt.value
                        ? typography.weight.semibold
                        : typography.weight.regular,
                  },
                ]}
              >
                {opt.label}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: theme.colors.textMuted }]}>
          Fiat Currency
        </Text>
        <View
          style={[
            styles.optionGroup,
            { backgroundColor: theme.colors.card, ...theme.shadow("card") },
          ]}
        >
          {CURRENCY_OPTIONS.map((opt) => (
            <Pressable
              key={opt.value}
              onPress={() => setFiatCurrency(opt.value)}
              style={[
                styles.option,
                currentCurrency === opt.value && {
                  backgroundColor: theme.colors.primarySoft,
                },
              ]}
            >
              <Text
                style={[
                  styles.optionLabel,
                  {
                    color:
                      currentCurrency === opt.value
                        ? theme.colors.primary
                        : theme.colors.text,
                    fontWeight:
                      currentCurrency === opt.value
                        ? typography.weight.semibold
                        : typography.weight.regular,
                  },
                ]}
              >
                {opt.label}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: theme.colors.textMuted }]}>
          Bitcoin Unit
        </Text>
        <View
          style={[
            styles.optionGroup,
            { backgroundColor: theme.colors.card, ...theme.shadow("card") },
          ]}
        >
          {BITCOIN_UNIT_OPTIONS.map((opt) => (
            <Pressable
              key={opt.value}
              onPress={() => setBitcoinUnit(opt.value)}
              style={[
                styles.option,
                currentBitcoinUnit === opt.value && {
                  backgroundColor: theme.colors.primarySoft,
                },
              ]}
            >
              <Text
                style={[
                  styles.optionLabel,
                  {
                    color:
                      currentBitcoinUnit === opt.value
                        ? theme.colors.primary
                        : theme.colors.text,
                    fontWeight:
                      currentBitcoinUnit === opt.value
                        ? typography.weight.semibold
                        : typography.weight.regular,
                  },
                ]}
              >
                {opt.label}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: theme.colors.textMuted }]}>
          Notifications
        </Text>
        <View
          style={[
            styles.optionGroup,
            { backgroundColor: theme.colors.card, ...theme.shadow("card") },
          ]}
        >
          <View style={styles.switchRow}>
            <Text style={[styles.optionLabel, { color: theme.colors.text }]}>
              Enable Notifications
            </Text>
            <Switch
              value={notificationPrefs.enabled}
              onValueChange={(enabled) => setNotificationPrefs({ enabled })}
              trackColor={{ true: theme.colors.primary }}
            />
          </View>

          {notificationPrefs.enabled && (
            <>
              <View
                style={[
                  styles.divider,
                  { backgroundColor: theme.colors.border },
                ]}
              />
              <View style={styles.switchRow}>
                <Text
                  style={[styles.optionLabel, { color: theme.colors.text }]}
                >
                  Swaps
                </Text>
                <Switch
                  value={notificationPrefs.swaps}
                  onValueChange={(swaps) => setNotificationPrefs({ swaps })}
                  trackColor={{ true: theme.colors.primary }}
                />
              </View>
              <View
                style={[
                  styles.divider,
                  { backgroundColor: theme.colors.border },
                ]}
              />
              <View style={styles.switchRow}>
                <Text
                  style={[styles.optionLabel, { color: theme.colors.text }]}
                >
                  Payments
                </Text>
                <Switch
                  value={notificationPrefs.payments}
                  onValueChange={(payments) =>
                    setNotificationPrefs({ payments })
                  }
                  trackColor={{ true: theme.colors.primary }}
                />
              </View>
            </>
          )}
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: spacing[5],
  },
  section: {
    marginTop: spacing[6],
  },
  sectionTitle: {
    fontSize: typography.size.xs,
    fontWeight: typography.weight.semibold,
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: spacing[2],
    paddingHorizontal: spacing[1],
  },
  optionGroup: {
    borderRadius: radius.lg,
    overflow: "hidden",
  },
  option: {
    paddingVertical: spacing[4],
    paddingHorizontal: spacing[4],
  },
  optionLabel: {
    fontSize: typography.size.md,
  },
  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: spacing[3],
    paddingHorizontal: spacing[4],
  },
  divider: {
    height: 1,
    marginHorizontal: spacing[4],
  },
});
