import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import * as React from "react";
import { ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import Button from "../../components/Button";
import { useToast } from "../../components/ToastProvider";
import { useResolvedTheme } from "../../hooks/useResolvedTheme";
import type { RootStackParamList } from "../../navigation/RootStack";
import { isValidAssetId } from "../../services/arkade/asset-format";
import { fetchAssetDetailsCached } from "../../services/arkade/asset-metadata";
import { useAppStore } from "../../store/useAppStore";
import { radius, spacing, typography } from "../../theme/theme";

type Nav = NativeStackNavigationProp<RootStackParamList>;

export default function AssetImportScreen() {
  const theme = useResolvedTheme();
  const nav = useNavigation<Nav>();
  const { showToast } = useToast();
  const network = useAppStore(
    (s) => s.network.detectedNetwork ?? s.wallet?.network ?? null,
  );
  const importAsset = useAppStore((s) => s.importAsset);
  const [value, setValue] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);

  async function handleImport() {
    const trimmed = value.trim();
    if (!isValidAssetId(trimmed)) {
      setError("Asset id must be a 68-character hex string");
      return;
    }
    if (!network) {
      setError("Network is not ready yet — try again in a moment");
      return;
    }
    setError(null);
    setLoading(true);
    try {
      await fetchAssetDetailsCached(network, trimmed, "fresh");
      await importAsset(trimmed);
      showToast("Asset added", "success");
      nav.navigate("AssetDetail", { assetId: trimmed });
    } catch (e) {
      const message =
        e instanceof Error
          ? e.message
          : "Could not fetch asset details — check the id and try again";
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <ScrollView
      style={{ backgroundColor: theme.colors.background }}
      contentContainerStyle={styles.content}
    >
      <Text style={[styles.heading, { color: theme.colors.text }]}>
        Import asset
      </Text>
      <Text style={[styles.body, { color: theme.colors.textMuted }]}>
        Paste an Arkade asset id to track its balance and metadata in this
        wallet. The id must be exactly 68 hex characters.
      </Text>

      <View
        style={[
          styles.field,
          {
            backgroundColor: theme.colors.card,
            borderColor: theme.colors.border,
          },
        ]}
      >
        <Text style={[styles.fieldLabel, { color: theme.colors.textSubtle }]}>
          Asset id
        </Text>
        <TextInput
          value={value}
          onChangeText={(t) => {
            setValue(t);
            if (error) setError(null);
          }}
          placeholder="0000…"
          placeholderTextColor={theme.colors.textSubtle}
          autoCapitalize="none"
          autoCorrect={false}
          multiline
          style={[
            styles.input,
            { color: theme.colors.text, fontFamily: undefined },
          ]}
        />
      </View>
      {error ? (
        <Text style={[styles.error, { color: theme.colors.danger }]}>
          {error}
        </Text>
      ) : null}

      <View style={{ marginTop: spacing[5] }}>
        <Button
          label={loading ? "Importing…" : "Import"}
          theme={theme}
          onPress={() => {
            void handleImport();
          }}
          loading={loading}
          disabled={loading || value.trim().length === 0}
        />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: spacing[5],
    paddingBottom: 120,
  },
  heading: {
    fontSize: typography.size.lg,
    fontWeight: typography.weight.semibold,
  },
  body: {
    fontSize: typography.size.sm,
    marginTop: spacing[2],
    lineHeight: typography.size.sm * 1.4,
  },
  field: {
    marginTop: spacing[5],
    padding: spacing[4],
    borderRadius: radius.md,
    borderWidth: 1,
  },
  fieldLabel: {
    fontSize: typography.size.xs,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: spacing[2],
  },
  input: {
    fontSize: typography.size.sm,
    minHeight: 48,
    textAlignVertical: "top",
  },
  error: {
    marginTop: spacing[3],
    fontSize: typography.size.sm,
  },
});
