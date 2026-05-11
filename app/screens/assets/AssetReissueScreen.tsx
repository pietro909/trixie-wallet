import {
  type RouteProp,
  useNavigation,
  useRoute,
} from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import * as React from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
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
  parseAssetAmount,
  prettyAssetAmount,
  truncatedAssetId,
} from "../../services/arkade/asset-format";
import {
  type CachedAssetDetails,
  fetchAssetDetailsCached,
} from "../../services/arkade/asset-metadata";
import { useAppStore } from "../../store/useAppStore";
import { radius, spacing, typography } from "../../theme/theme";

type Route = RouteProp<RootStackParamList, "AssetReissue">;
type Nav = NativeStackNavigationProp<RootStackParamList>;

export default function AssetReissueScreen() {
  const theme = useResolvedTheme();
  const nav = useNavigation<Nav>();
  const { assetId } = useRoute<Route>().params;
  const { showToast } = useToast();
  const network = useAppStore(
    (s) => s.network.detectedNetwork ?? s.wallet?.network ?? null,
  );
  const reissueAsset = useAppStore((s) => s.reissueAsset);

  const [details, setDetails] = React.useState<CachedAssetDetails | null>(null);
  const [amount, setAmount] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!network) return;
    let cancelled = false;
    void (async () => {
      try {
        const d = await fetchAssetDetailsCached(network, assetId, "cache");
        if (!cancelled) setDetails(d);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Could not load asset");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [network, assetId]);

  const decimals =
    typeof details?.metadata?.decimals === "number"
      ? details.metadata.decimals
      : 0;
  const ticker = details?.metadata?.ticker ?? truncatedAssetId(assetId);
  const amountBase = amount ? parseAssetAmount(amount, decimals) : null;
  const valid = amountBase != null && amountBase > 0n;

  function confirmReissue() {
    if (!valid || amountBase == null) {
      setError("Enter a positive amount");
      return;
    }
    Alert.alert(
      "Reissue asset",
      `Issue an additional ${prettyAssetAmount(amountBase, decimals)} ${ticker}? This requires the control asset and is irreversible.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Reissue",
          style: "default",
          onPress: () => {
            void handleReissue();
          },
        },
      ],
    );
  }

  async function handleReissue() {
    if (amountBase == null) return;
    setSubmitting(true);
    setError(null);
    try {
      await reissueAsset(assetId, amountBase);
      showToast("Reissued", "success");
      nav.goBack();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Reissue failed");
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
          Mint more {ticker}
        </Text>
        <Text style={[styles.body, { color: theme.colors.textMuted }]}>
          Increase the supply of an existing asset. Your wallet must hold the
          control asset.
        </Text>

        <View
          style={[
            styles.field,
            {
              backgroundColor: theme.colors.surfaceSubtle,
              borderColor: theme.colors.border,
            },
          ]}
        >
          <Text style={[styles.fieldLabel, { color: theme.colors.textSubtle }]}>
            Amount to add ({ticker})
          </Text>
          <TextInput
            value={amount}
            onChangeText={setAmount}
            placeholder="0"
            placeholderTextColor={theme.colors.textSubtle}
            keyboardType="decimal-pad"
            inputMode="decimal"
            style={[styles.input, { color: theme.colors.text }]}
          />
        </View>

        {error ? (
          <Text style={[styles.error, { color: theme.colors.danger }]}>
            {error}
          </Text>
        ) : null}

        <Button
          label={submitting ? "Reissuing…" : "Reissue"}
          theme={theme}
          onPress={confirmReissue}
          loading={submitting}
          disabled={!valid || submitting}
          style={{ marginTop: spacing[5] }}
        />
      </ScrollView>
    </KeyboardAvoidingView>
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
  field: {
    padding: spacing[4],
    borderRadius: radius.md,
    borderWidth: 1,
    marginTop: spacing[2],
  },
  fieldLabel: {
    fontSize: typography.size.xs,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: spacing[2],
  },
  input: {
    fontSize: 28,
    fontWeight: typography.weight.semibold,
    fontVariant: ["tabular-nums"],
  },
  error: {
    fontSize: typography.size.sm,
    marginTop: spacing[3],
  },
});
