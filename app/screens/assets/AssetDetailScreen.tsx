import {
  type RouteProp,
  useNavigation,
  useRoute,
} from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { FileQuestion } from "lucide-react-native";
import * as React from "react";
import {
  Alert,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";
import AssetAvatar from "../../components/AssetAvatar";
import Button from "../../components/Button";
import CopyableField from "../../components/CopyableField";
import { useToast } from "../../components/ToastProvider";
import { useResolvedTheme } from "../../hooks/useResolvedTheme";
import type { RootStackParamList } from "../../navigation/RootStack";
import {
  prettyAssetAmount,
  truncatedAssetId,
} from "../../services/arkade/asset-format";
import {
  isIconApproved,
  setIconApproval,
} from "../../services/arkade/asset-icon-approval";
import {
  type CachedAssetDetails,
  fetchAssetDetailsCached,
} from "../../services/arkade/asset-metadata";
import { useAppStore } from "../../store/useAppStore";
import { radius, spacing, typography } from "../../theme/theme";

type Route = RouteProp<RootStackParamList, "AssetDetail">;
type Nav = NativeStackNavigationProp<RootStackParamList>;

export default function AssetDetailScreen() {
  const theme = useResolvedTheme();
  const nav = useNavigation<Nav>();
  const { assetId } = useRoute<Route>().params;
  const { showToast } = useToast();

  const network = useAppStore(
    (s) => s.network.detectedNetwork ?? s.wallet?.network ?? null,
  );
  const assetBalances = useAppStore((s) => s.wallet?.assetBalances ?? []);
  const balanceEntry = assetBalances.find((a) => a.assetId === assetId);
  const importedAssetIds = useAppStore((s) => s.assets.importedAssetIds);
  const forgetAsset = useAppStore((s) => s.forgetAsset);

  const [details, setDetails] = React.useState<CachedAssetDetails | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [approved, setApproved] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      const flag = await isIconApproved(assetId);
      if (!cancelled) setApproved(flag);
    })();
    return () => {
      cancelled = true;
    };
  }, [assetId]);

  React.useEffect(() => {
    if (!network) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const d = await fetchAssetDetailsCached(network, assetId, "cache");
        if (!cancelled) setDetails(d);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Could not load asset");
      } finally {
        if (!cancelled) setLoading(false);
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
  const ticker = details?.metadata?.ticker;
  const name = details?.metadata?.name;
  const icon = details?.metadata?.icon;
  let amount = 0n;
  try {
    amount = balanceEntry ? BigInt(balanceEntry.amount) : 0n;
  } catch {
    amount = 0n;
  }

  const holdsControlAsset = details?.controlAssetId
    ? assetBalances.some(
        (b) => b.assetId === details.controlAssetId && BigInt(b.amount) > 0n,
      )
    : false;

  async function handleToggleIcon(value: boolean) {
    setApproved(value);
    await setIconApproval(assetId, value);
  }

  async function refreshMetadata() {
    if (!network) return;
    setLoading(true);
    setError(null);
    try {
      const d = await fetchAssetDetailsCached(network, assetId, "fresh");
      setDetails(d);
      showToast("Metadata refreshed", "success");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Refresh failed");
    } finally {
      setLoading(false);
    }
  }

  function handleSend() {
    nav.navigate("SendEntry", { preselectAssetId: assetId });
  }

  function handleReceive() {
    nav.navigate("ReceiveQR", {
      type: "arkade",
      assetId,
    });
  }

  function handleMintMore() {
    nav.navigate("AssetReissue", { assetId });
  }

  function handleBurn() {
    nav.navigate("AssetBurn", { assetId });
  }

  function confirmForget() {
    Alert.alert(
      "Forget asset",
      `This removes ${ticker ?? "the asset"} from your tracked assets. If it still has a non-zero balance, it will reappear after the next refresh.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Forget",
          style: "destructive",
          onPress: () => {
            void (async () => {
              try {
                await forgetAsset(assetId);
                showToast("Asset removed from list", "success");
                nav.goBack();
              } catch (e) {
                showToast(
                  e instanceof Error ? e.message : "Could not forget asset",
                  "error",
                );
              }
            })();
          },
        },
      ],
    );
  }

  const isImported = importedAssetIds.includes(assetId);

  if (!balanceEntry && !isImported && !details && error) {
    return (
      <View
        style={[styles.notFound, { backgroundColor: theme.colors.background }]}
      >
        <FileQuestion color={theme.colors.textSubtle} size={56} />
        <Text style={[styles.notFoundTitle, { color: theme.colors.text }]}>
          Asset unavailable
        </Text>
        <Text style={[styles.notFoundBody, { color: theme.colors.textMuted }]}>
          {error}
        </Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={{ backgroundColor: theme.colors.background }}
      contentContainerStyle={styles.content}
    >
      <View
        style={[
          styles.header,
          {
            backgroundColor: theme.colors.card,
            borderColor: theme.colors.border,
          },
        ]}
      >
        <AssetAvatar
          size={72}
          icon={icon ?? null}
          approved={approved}
          ticker={ticker ?? null}
          name={name ?? null}
        />
        <Text style={[styles.title, { color: theme.colors.text }]}>
          {name ?? ticker ?? truncatedAssetId(assetId)}
        </Text>
        {ticker ? (
          <Text style={[styles.subtitle, { color: theme.colors.textSubtle }]}>
            {ticker}
          </Text>
        ) : null}
        <Text style={[styles.balance, { color: theme.colors.text }]}>
          {prettyAssetAmount(amount, decimals)}
          {ticker ? ` ${ticker}` : ""}
        </Text>
      </View>

      <View style={styles.actions}>
        <Button
          label="Send"
          theme={theme}
          onPress={handleSend}
          style={styles.actionBtn}
        />
        <Button
          label="Receive"
          variant="secondary"
          theme={theme}
          onPress={handleReceive}
          style={styles.actionBtn}
        />
      </View>
      <View style={[styles.actions, { marginTop: spacing[3] }]}>
        <Button
          label="Mint more"
          variant="secondary"
          theme={theme}
          onPress={handleMintMore}
          disabled={!holdsControlAsset || !details}
          style={styles.actionBtn}
        />
        <Button
          label="Burn"
          variant="danger"
          theme={theme}
          onPress={handleBurn}
          disabled={amount <= 0n}
          style={styles.actionBtn}
        />
      </View>
      {!holdsControlAsset && details?.controlAssetId ? (
        <Text style={[styles.helper, { color: theme.colors.textSubtle }]}>
          Mint more requires the control asset, which is not in this wallet.
        </Text>
      ) : null}

      <View
        style={[
          styles.metadataCard,
          {
            backgroundColor: theme.colors.card,
            borderColor: theme.colors.border,
          },
        ]}
      >
        <Text style={[styles.cardTitle, { color: theme.colors.text }]}>
          Metadata
        </Text>
        {loading ? (
          <Text style={[styles.helper, { color: theme.colors.textSubtle }]}>
            Loading…
          </Text>
        ) : null}
        {error && !details ? (
          <Text style={[styles.helper, { color: theme.colors.danger }]}>
            {error}
          </Text>
        ) : null}
        {name ? <Row label="Name" value={name} theme={theme} /> : null}
        {ticker ? <Row label="Ticker" value={ticker} theme={theme} /> : null}
        {typeof details?.metadata?.decimals === "number" ? (
          <Row
            label="Decimals"
            value={String(details.metadata.decimals)}
            theme={theme}
          />
        ) : null}
        {details ? (
          <Row label="Supply" value={details.supply} theme={theme} />
        ) : null}
        {details?.controlAssetId ? (
          <CopyableField
            label="Control asset id"
            value={details.controlAssetId}
            mono
          />
        ) : details ? (
          <Row label="Reissuable" value="No (no control asset)" theme={theme} />
        ) : null}
        <CopyableField label="Asset id" value={assetId} mono />
        {details ? (
          <View style={styles.iconRow}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.iconLabel, { color: theme.colors.text }]}>
                Show icon
              </Text>
              <Text style={[styles.helper, { color: theme.colors.textSubtle }]}>
                Unverified asset icons are hidden by default.
              </Text>
            </View>
            <Switch
              value={approved}
              onValueChange={handleToggleIcon}
              disabled={typeof icon !== "string"}
            />
          </View>
        ) : null}
        <View style={{ marginTop: spacing[2] }}>
          <Button
            label="Refresh metadata"
            variant="ghost"
            theme={theme}
            onPress={() => {
              void refreshMetadata();
            }}
            loading={loading}
            disabled={loading || !network}
          />
        </View>
      </View>

      {isImported ? (
        <View style={{ marginTop: spacing[5] }}>
          <Button
            label="Forget asset"
            variant="ghost"
            theme={theme}
            onPress={confirmForget}
          />
        </View>
      ) : null}
    </ScrollView>
  );
}

function Row({
  label,
  value,
  theme,
}: {
  label: string;
  value: string;
  theme: ReturnType<typeof useResolvedTheme>;
}) {
  return (
    <View style={styles.row}>
      <Text style={[styles.rowLabel, { color: theme.colors.textSubtle }]}>
        {label}
      </Text>
      <Text style={[styles.rowValue, { color: theme.colors.text }]}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: spacing[5],
    paddingBottom: 120,
  },
  header: {
    padding: spacing[6],
    borderRadius: radius.lg,
    borderWidth: 1,
    alignItems: "center",
    gap: spacing[2],
  },
  title: {
    fontSize: typography.size.lg,
    fontWeight: typography.weight.semibold,
    marginTop: spacing[3],
  },
  subtitle: {
    fontSize: typography.size.sm,
  },
  balance: {
    fontSize: 28,
    fontWeight: typography.weight.bold,
    fontVariant: ["tabular-nums"],
    marginTop: spacing[2],
  },
  actions: {
    flexDirection: "row",
    gap: spacing[3],
    marginTop: spacing[5],
  },
  actionBtn: {
    flex: 1,
  },
  helper: {
    fontSize: typography.size.xs,
    marginTop: spacing[2],
  },
  metadataCard: {
    marginTop: spacing[5],
    padding: spacing[5],
    borderRadius: radius.md,
    borderWidth: 1,
    gap: spacing[2],
  },
  cardTitle: {
    fontSize: typography.size.md,
    fontWeight: typography.weight.semibold,
    marginBottom: spacing[2],
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    paddingVertical: spacing[2],
    gap: spacing[3],
  },
  rowLabel: {
    fontSize: typography.size.xs,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    flexShrink: 0,
  },
  rowValue: {
    fontSize: typography.size.sm,
    flex: 1,
    textAlign: "right",
  },
  iconRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    paddingVertical: spacing[2],
  },
  iconLabel: {
    fontSize: typography.size.sm,
    fontWeight: typography.weight.medium,
  },
  notFound: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: spacing[6],
  },
  notFoundTitle: {
    fontSize: typography.size.lg,
    fontWeight: typography.weight.semibold,
    marginTop: spacing[4],
  },
  notFoundBody: {
    fontSize: typography.size.sm,
    marginTop: spacing[2],
    textAlign: "center",
  },
});
