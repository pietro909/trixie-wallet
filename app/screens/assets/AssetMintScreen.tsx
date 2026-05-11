import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import * as React from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import Button from "../../components/Button";
import { useToast } from "../../components/ToastProvider";
import { useResolvedTheme } from "../../hooks/useResolvedTheme";
import type { RootStackParamList } from "../../navigation/RootStack";
import {
  isValidAssetId,
  parseAssetAmount,
  prettyAssetAmount,
  truncatedAssetId,
} from "../../services/arkade/asset-format";
import { useAppStore } from "../../store/useAppStore";
import { radius, spacing, typography } from "../../theme/theme";

type Nav = NativeStackNavigationProp<RootStackParamList>;

const CONTROL_MODES = ["none", "existing", "new"] as const;
type ControlMode = (typeof CONTROL_MODES)[number];

function controlModeLabel(mode: ControlMode): string {
  switch (mode) {
    case "none":
      return "None";
    case "existing":
      return "Existing";
    case "new":
      return "New";
  }
}

export default function AssetMintScreen() {
  const theme = useResolvedTheme();
  const nav = useNavigation<Nav>();
  const { showToast } = useToast();
  const issueAsset = useAppStore((s) => s.issueAsset);

  const [name, setName] = React.useState("");
  const [ticker, setTicker] = React.useState("");
  const [amount, setAmount] = React.useState("");
  const [decimals, setDecimals] = React.useState("0");
  const [iconUrl, setIconUrl] = React.useState("");
  const [controlMode, setControlMode] = React.useState<ControlMode>("none");
  const [existingControlId, setExistingControlId] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const parsedDecimals = Number.parseInt(decimals, 10);
  const decimalsValid =
    decimals !== "" &&
    Number.isInteger(parsedDecimals) &&
    parsedDecimals >= 0 &&
    parsedDecimals <= 8;
  const amountBase = amount
    ? parseAssetAmount(amount, decimalsValid ? parsedDecimals : 0)
    : null;

  const disabledReason = !name
    ? "Enter a name"
    : name.length > 40
      ? "Name must be 40 characters or less"
      : !ticker
        ? "Enter a ticker"
        : ticker.length > 8
          ? "Ticker must be 8 characters or less"
          : !amount
            ? "Enter an amount"
            : amountBase == null || amountBase <= 0n
              ? "Amount must be positive"
              : !decimalsValid
                ? "Decimals must be 0–8"
                : controlMode === "existing" &&
                    !isValidAssetId(existingControlId.trim())
                  ? "Provide a valid control asset id"
                  : null;

  function confirmMint() {
    if (disabledReason) {
      setError(disabledReason);
      return;
    }
    Alert.alert(
      "Mint asset",
      `Mint ${prettyAssetAmount(amountBase ?? 0n, parsedDecimals)} ${ticker}? This is irreversible.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Mint",
          style: "default",
          onPress: () => {
            void handleMint();
          },
        },
      ],
    );
  }

  async function handleMint() {
    if (amountBase == null) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await issueAsset({
        name,
        ticker,
        decimals: parsedDecimals,
        icon: iconUrl.trim() || undefined,
        amount: amountBase,
        controlAssetId:
          controlMode === "existing" ? existingControlId.trim() : undefined,
        controlMode,
      });
      showToast("Asset minted", "success");
      nav.replace("AssetDetail", { assetId: result.assetId });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Mint failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={{ flex: 1, backgroundColor: theme.colors.background }}
    >
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={[styles.heading, { color: theme.colors.text }]}>
          Mint a new asset
        </Text>
        <Text style={[styles.body, { color: theme.colors.textMuted }]}>
          Metadata is immutable post-issuance. Asset amounts are stored in base
          units adjusted by the chosen decimals.
        </Text>

        {amountBase != null && amountBase > 0n ? (
          <View
            style={[
              styles.preview,
              {
                backgroundColor: theme.colors.surfaceSubtle,
                borderColor: theme.colors.border,
              },
            ]}
          >
            <Text
              style={[styles.previewLabel, { color: theme.colors.textSubtle }]}
            >
              Preview
            </Text>
            <Text style={[styles.previewAmount, { color: theme.colors.text }]}>
              {prettyAssetAmount(amountBase, parsedDecimals)}{" "}
              {ticker || "TICKER"}
            </Text>
          </View>
        ) : null}

        <Field label="Name *" theme={theme}>
          <TextInput
            value={name}
            onChangeText={(v) => setName(v.slice(0, 40))}
            placeholder="My Token"
            placeholderTextColor={theme.colors.textSubtle}
            style={[styles.input, { color: theme.colors.text }]}
            maxLength={40}
          />
        </Field>
        <Field label="Ticker *" theme={theme}>
          <TextInput
            value={ticker}
            onChangeText={(v) =>
              setTicker(v.slice(0, 8).toUpperCase().replace(/\s/g, ""))
            }
            placeholder="TKN"
            placeholderTextColor={theme.colors.textSubtle}
            autoCapitalize="characters"
            style={[styles.input, { color: theme.colors.text }]}
            maxLength={8}
          />
        </Field>
        <View style={styles.row}>
          <View style={{ flex: 1 }}>
            <Field label="Amount *" theme={theme}>
              <TextInput
                value={amount}
                onChangeText={setAmount}
                placeholder="1000"
                placeholderTextColor={theme.colors.textSubtle}
                keyboardType="decimal-pad"
                inputMode="decimal"
                style={[styles.input, { color: theme.colors.text }]}
              />
            </Field>
          </View>
          <View style={{ width: 110 }}>
            <Field label="Decimals" theme={theme}>
              <TextInput
                value={decimals}
                onChangeText={(v) => setDecimals(v.replace(/[^0-9]/g, ""))}
                placeholder="0"
                placeholderTextColor={theme.colors.textSubtle}
                keyboardType="number-pad"
                inputMode="numeric"
                style={[styles.input, { color: theme.colors.text }]}
                maxLength={1}
              />
            </Field>
          </View>
        </View>
        <Field label="Icon URL" theme={theme}>
          <TextInput
            value={iconUrl}
            onChangeText={setIconUrl}
            placeholder="https://… or data:image/png;base64,…"
            placeholderTextColor={theme.colors.textSubtle}
            autoCapitalize="none"
            autoCorrect={false}
            style={[styles.input, { color: theme.colors.text }]}
          />
        </Field>

        <Text style={[styles.sectionLabel, { color: theme.colors.textMuted }]}>
          Control asset
        </Text>
        <View
          style={[
            styles.segmented,
            { backgroundColor: theme.colors.surfaceSubtle },
          ]}
        >
          {CONTROL_MODES.map((m) => (
            <Pressable
              key={m}
              onPress={() => setControlMode(m)}
              style={[
                styles.segment,
                controlMode === m
                  ? { backgroundColor: theme.colors.primary }
                  : undefined,
              ]}
            >
              <Text
                style={[
                  styles.segmentLabel,
                  {
                    color:
                      controlMode === m
                        ? theme.colors.onPrimary
                        : theme.colors.text,
                  },
                ]}
              >
                {controlModeLabel(m)}
              </Text>
            </Pressable>
          ))}
        </View>
        {controlMode === "existing" ? (
          <Field label="Existing control asset id" theme={theme}>
            <TextInput
              value={existingControlId}
              onChangeText={setExistingControlId}
              placeholder="0000…"
              placeholderTextColor={theme.colors.textSubtle}
              autoCapitalize="none"
              autoCorrect={false}
              style={[styles.input, { color: theme.colors.text }]}
            />
            {existingControlId && !isValidAssetId(existingControlId.trim()) ? (
              <Text style={[styles.helper, { color: theme.colors.danger }]}>
                {truncatedAssetId(existingControlId.trim()) || "Invalid id"} is
                not a valid 68-char asset id.
              </Text>
            ) : null}
          </Field>
        ) : null}
        {controlMode === "new" ? (
          <Text style={[styles.helper, { color: theme.colors.textSubtle }]}>
            A 1-unit control asset will be minted first, then this asset.
          </Text>
        ) : null}

        {error ? (
          <Text style={[styles.error, { color: theme.colors.danger }]}>
            {error}
          </Text>
        ) : null}

        <Button
          label={submitting ? "Minting…" : "Mint asset"}
          theme={theme}
          onPress={confirmMint}
          loading={submitting}
          disabled={!!disabledReason || submitting}
          style={{ marginTop: spacing[5] }}
        />
        {disabledReason ? (
          <Text style={[styles.helper, { color: theme.colors.textSubtle }]}>
            {disabledReason}
          </Text>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Field({
  label,
  theme,
  children,
}: {
  label: string;
  theme: ReturnType<typeof useResolvedTheme>;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.field}>
      <Text style={[styles.fieldLabel, { color: theme.colors.textSubtle }]}>
        {label}
      </Text>
      <View
        style={[
          styles.fieldWrap,
          {
            backgroundColor: theme.colors.surfaceSubtle,
            borderColor: theme.colors.border,
          },
        ]}
      >
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: spacing[5],
    paddingBottom: 120,
    gap: spacing[3],
  },
  heading: {
    fontSize: typography.size.lg,
    fontWeight: typography.weight.semibold,
  },
  body: {
    fontSize: typography.size.sm,
  },
  preview: {
    padding: spacing[4],
    borderRadius: radius.md,
    borderWidth: 1,
    alignItems: "center",
  },
  previewLabel: {
    fontSize: typography.size.xs,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  previewAmount: {
    fontSize: 28,
    fontWeight: typography.weight.bold,
    fontVariant: ["tabular-nums"],
    marginTop: spacing[2],
  },
  field: {
    marginTop: spacing[2],
  },
  fieldLabel: {
    fontSize: typography.size.xs,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: spacing[1],
  },
  fieldWrap: {
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    borderRadius: radius.sm,
    borderWidth: 1,
  },
  input: {
    fontSize: typography.size.md,
    minHeight: 28,
  },
  row: {
    flexDirection: "row",
    gap: spacing[3],
    alignItems: "flex-start",
  },
  sectionLabel: {
    fontSize: typography.size.xs,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginTop: spacing[4],
  },
  segmented: {
    flexDirection: "row",
    padding: spacing[1],
    borderRadius: radius.md,
  },
  segment: {
    flex: 1,
    paddingVertical: spacing[2],
    alignItems: "center",
    borderRadius: radius.sm,
  },
  segmentLabel: {
    fontSize: typography.size.sm,
    fontWeight: typography.weight.semibold,
  },
  helper: {
    fontSize: typography.size.xs,
    marginTop: spacing[1],
  },
  error: {
    fontSize: typography.size.sm,
    marginTop: spacing[3],
  },
});
