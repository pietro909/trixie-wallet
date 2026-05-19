import {
  type RouteProp,
  useNavigation,
  useRoute,
} from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { ChevronDown, ChevronRight, FileQuestion } from "lucide-react-native";
import * as React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import AuthGate from "../../components/AuthGate";
import Button from "../../components/Button";
import CopyableField from "../../components/CopyableField";
import { useAssetMetadata } from "../../hooks/useAssetMetadata";
import { useFormatSats } from "../../hooks/useFormatSats";
import { useResolvedTheme } from "../../hooks/useResolvedTheme";
import type { RootStackParamList } from "../../navigation/RootStack";
import { explorerUrl } from "../../services/activity-details/explorer";
import {
  prettyAssetAmount,
  truncatedAssetId,
} from "../../services/arkade/asset-format";
import { ArkadeError } from "../../services/arkade/errors";
import type { ClassifiedVtxo } from "../../services/arkade/vtxo-listing";
import { vtxoStatusVisuals } from "../../services/vtxo-status";
import { useAppStore } from "../../store/useAppStore";
import { type AppTheme, radius, spacing, typography } from "../../theme/theme";

type Route = RouteProp<RootStackParamList, "VtxoDetail">;
type Nav = NativeStackNavigationProp<RootStackParamList, "VtxoDetail">;

function formatTimestamp(ts: number): string {
  return new Date(ts).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function relative(ts: number): string {
  const diff = ts - Date.now();
  const abs = Math.abs(diff);
  const minutes = Math.round(abs / 60000);
  const hours = Math.round(minutes / 60);
  const days = Math.round(hours / 24);
  const future = diff >= 0;
  const fmt = (n: number, unit: string) =>
    future ? `in ${n}${unit}` : `${n}${unit} ago`;
  if (abs < 60_000) return future ? "in <1m" : "Just now";
  if (minutes < 60) return fmt(minutes, "m");
  if (hours < 24) return fmt(hours, "h");
  return fmt(days, "d");
}

/**
 * Lower bound (ms since epoch) used to distinguish a real `batchExpiry`
 * timestamp from a block-height value. The SDK reports `batchExpiry` in ms
 * on production networks but emits raw block heights on regtest — same
 * guard the SDK's own `isExpired` helper uses. 1e12 ms ≈ 2001-09-09, so
 * any value above this threshold is a timestamp and any value below it is
 * either unset or a block height (max realistic Bitcoin height ≪ 1e9).
 */
const BATCH_EXPIRY_MS_LOWER_BOUND = 1_000_000_000_000;

export default function VtxoDetailScreen(): React.ReactElement {
  const theme = useResolvedTheme();
  const nav = useNavigation<Nav>();
  const route = useRoute<Route>();
  const { outpoint } = route.params;
  const network = useAppStore(
    (s) => s.network.detectedNetwork ?? s.wallet?.network ?? null,
  );
  const loadWalletVtxos = useAppStore((s) => s.loadWalletVtxos);
  const { format: formatSats, label: unitLabel } = useFormatSats();
  const [vtxo, setVtxo] = React.useState<ClassifiedVtxo | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [showScript, setShowScript] = React.useState(false);
  const [authVisible, setAuthVisible] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        // Reuse the list-screen snapshot when fresh enough — tapping a row
        // shouldn't trigger a second `getVtxos` round-trip.
        const list = await loadWalletVtxos({ maxAgeMs: 30_000 });
        if (cancelled) return;
        const found = list.find((v) => v.outpoint === outpoint) ?? null;
        setVtxo(found);
        setError(null);
      } catch (e) {
        if (cancelled) return;
        const msg =
          e instanceof ArkadeError
            ? e.message
            : e instanceof Error
              ? e.message
              : "Failed to load VTXO";
        setError(msg);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadWalletVtxos, outpoint]);

  const assetIds = React.useMemo(() => {
    if (!vtxo?.assets) return [] as string[];
    return vtxo.assets.map((a) => a.assetId);
  }, [vtxo]);

  // Cache-only: the asset metadata cache is warmed by the screens that own
  // the mint/import flows (Wallet / AssetDetail); a forensic VTXO inspector
  // shouldn't reach out to the SDK for asset hydration.
  const { assetMetadata } = useAssetMetadata(network, assetIds);

  if (loading) {
    return (
      <View
        style={[styles.center, { backgroundColor: theme.colors.background }]}
      >
        <Text style={[styles.bodyText, { color: theme.colors.textMuted }]}>
          Loading…
        </Text>
      </View>
    );
  }

  if (error) {
    return (
      <View
        style={[styles.center, { backgroundColor: theme.colors.background }]}
      >
        <Text style={[styles.title, { color: theme.colors.text }]}>
          Couldn't load VTXO
        </Text>
        <Text style={[styles.bodyText, { color: theme.colors.textMuted }]}>
          {error}
        </Text>
        <Button
          label="Back"
          theme={theme}
          variant="secondary"
          onPress={() => nav.goBack()}
        />
      </View>
    );
  }

  if (!vtxo) {
    return (
      <View
        style={[styles.center, { backgroundColor: theme.colors.background }]}
      >
        <FileQuestion color={theme.colors.textSubtle} size={56} />
        <Text style={[styles.title, { color: theme.colors.text }]}>
          VTXO no longer present
        </Text>
        <Text style={[styles.bodyText, { color: theme.colors.textMuted }]}>
          This output may have been spent or swept since you opened the list.
        </Text>
        <Button
          label="Back"
          theme={theme}
          variant="secondary"
          onPress={() => nav.goBack()}
        />
      </View>
    );
  }

  const visuals = vtxoStatusVisuals(vtxo.status, theme);
  const expiry = vtxo.virtualStatus.batchExpiry;
  const txExplorer = explorerUrl("ark_tx", vtxo.txid, network);

  function handleToggleScript() {
    if (!showScript) {
      setAuthVisible(true);
    } else {
      setShowScript(false);
    }
  }

  function performShowScript() {
    setAuthVisible(false);
    setShowScript(true);
  }

  return (
    <ScrollView
      style={{ backgroundColor: theme.colors.background }}
      contentContainerStyle={styles.content}
    >
      <View
        style={[
          styles.summary,
          {
            backgroundColor: theme.colors.card,
            borderColor: theme.colors.border,
          },
        ]}
      >
        <Text style={[styles.amount, { color: theme.colors.text }]}>
          {formatSats(vtxo.amountSats)} {unitLabel}
        </Text>
        <View style={[styles.pill, { backgroundColor: visuals.bg }]}>
          <Text style={[styles.pillText, { color: visuals.fg }]}>
            {visuals.label}
          </Text>
        </View>
        <Text style={[styles.statusBlurb, { color: theme.colors.textMuted }]}>
          {visuals.description}
        </Text>
      </View>

      <Section title="Output" theme={theme}>
        <CopyableField label="Outpoint" value={vtxo.outpoint} mono />
        <CopyableField
          label="Transaction id"
          value={vtxo.txid}
          mono
          explorerUrl={txExplorer}
        />
        <View style={styles.kv}>
          <Text style={[styles.kvKey, { color: theme.colors.textSubtle }]}>
            Output index
          </Text>
          <Text style={[styles.kvValue, { color: theme.colors.text }]}>
            {vtxo.vout}
          </Text>
        </View>
        <View style={styles.kv}>
          <Text style={[styles.kvKey, { color: theme.colors.textSubtle }]}>
            Amount (sats)
          </Text>
          <Text
            style={[
              styles.kvValue,
              { color: theme.colors.text, fontVariant: ["tabular-nums"] },
            ]}
          >
            {vtxo.amountSats.toLocaleString()}
          </Text>
        </View>
      </Section>

      <Section title="Lifecycle" theme={theme}>
        <View style={styles.kv}>
          <Text style={[styles.kvKey, { color: theme.colors.textSubtle }]}>
            Created
          </Text>
          <Text style={[styles.kvValue, { color: theme.colors.text }]}>
            {formatTimestamp(vtxo.createdAt.getTime())} ·{" "}
            {relative(vtxo.createdAt.getTime())}
          </Text>
        </View>
        {expiry != null && expiry > BATCH_EXPIRY_MS_LOWER_BOUND ? (
          <View style={styles.kv}>
            <Text style={[styles.kvKey, { color: theme.colors.textSubtle }]}>
              Batch expiry
            </Text>
            <Text style={[styles.kvValue, { color: theme.colors.text }]}>
              {formatTimestamp(expiry)} · {relative(expiry)}
            </Text>
          </View>
        ) : null}
        {vtxo.isUnrolled ? (
          <View style={styles.kv}>
            <Text style={[styles.kvKey, { color: theme.colors.textSubtle }]}>
              Unrolled
            </Text>
            <Text style={[styles.kvValue, { color: theme.colors.text }]}>
              Yes — broadcast onchain via unilateral exit.
            </Text>
          </View>
        ) : null}
      </Section>

      {(vtxo.virtualStatus.commitmentTxIds?.length ?? 0) > 0 ||
      vtxo.settledBy ||
      vtxo.spentBy ||
      vtxo.arkTxId ? (
        <Section title="References" theme={theme}>
          {vtxo.virtualStatus.commitmentTxIds?.map((id) => (
            <CopyableField
              key={`commitment-${id}`}
              label="Commitment tx id"
              value={id}
              mono
              explorerUrl={explorerUrl("commitment_tx", id, network)}
            />
          ))}
          {vtxo.settledBy ? (
            <CopyableField
              label="Settled by"
              value={vtxo.settledBy}
              mono
              explorerUrl={explorerUrl(
                "commitment_tx",
                vtxo.settledBy,
                network,
              )}
            />
          ) : null}
          {vtxo.spentBy ? (
            <CopyableField label="Checkpoint tx id" value={vtxo.spentBy} mono />
          ) : null}
          {vtxo.arkTxId ? (
            <CopyableField
              label="Spending Arkade tx id"
              value={vtxo.arkTxId}
              mono
              explorerUrl={explorerUrl("ark_tx", vtxo.arkTxId, network)}
            />
          ) : null}
        </Section>
      ) : null}

      {vtxo.assets && vtxo.assets.length > 0 ? (
        <Section title="Assets" theme={theme}>
          {vtxo.assets.map((a) => {
            const details = assetMetadata.get(a.assetId);
            const decimals =
              typeof details?.metadata?.decimals === "number"
                ? details.metadata.decimals
                : 0;
            const ticker =
              details?.metadata?.ticker ?? truncatedAssetId(a.assetId);
            const formatted = prettyAssetAmount(a.amount, decimals);
            return (
              <View key={a.assetId} style={styles.assetRow}>
                <Text style={[styles.assetTitle, { color: theme.colors.text }]}>
                  {formatted} {ticker}
                </Text>
                <Text
                  style={[
                    styles.assetSub,
                    {
                      color: theme.colors.textSubtle,
                      fontFamily: typography.fontFamily.mono,
                    },
                  ]}
                >
                  {truncatedAssetId(a.assetId)}
                </Text>
              </View>
            );
          })}
        </Section>
      ) : null}

      <Section title="Script" theme={theme}>
        <Pressable onPress={handleToggleScript} style={styles.scriptToggle}>
          {showScript ? (
            <ChevronDown color={theme.colors.primary} size={16} />
          ) : (
            <ChevronRight color={theme.colors.primary} size={16} />
          )}
          <Text
            style={[styles.scriptToggleText, { color: theme.colors.primary }]}
          >
            {showScript ? "Hide script" : "Show script (hex)"}
          </Text>
        </Pressable>
        {showScript ? (
          <CopyableField label="Script" value={vtxo.script} mono multiline />
        ) : null}
      </Section>

      <AuthGate
        visible={authVisible}
        title="Authorize Script Reveal"
        message="Authorize to view the raw script hex for this VTXO. This can contain sensitive material."
        onSuccess={performShowScript}
        onCancel={() => setAuthVisible(false)}
      />
    </ScrollView>
  );
}

function Section({
  title,
  theme,
  children,
}: {
  title: string;
  theme: AppTheme;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <View
      style={[
        styles.section,
        {
          backgroundColor: theme.colors.card,
          borderColor: theme.colors.border,
        },
      ]}
    >
      <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>
        {title}
      </Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: spacing[5],
    paddingBottom: 120,
  },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: spacing[6],
    gap: spacing[3],
  },
  summary: {
    padding: spacing[5],
    borderRadius: radius.lg,
    borderWidth: 1,
    alignItems: "center",
    gap: spacing[2],
  },
  amount: {
    fontSize: 28,
    fontWeight: typography.weight.bold,
    fontVariant: ["tabular-nums"],
  },
  pill: {
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[1],
    borderRadius: radius.pill,
  },
  pillText: {
    fontSize: typography.size.xs,
    fontWeight: typography.weight.medium,
  },
  statusBlurb: {
    fontSize: typography.size.sm,
    textAlign: "center",
    lineHeight: typography.size.sm * 1.4,
  },
  section: {
    marginTop: spacing[4],
    padding: spacing[4],
    borderRadius: radius.md,
    borderWidth: 1,
    gap: spacing[2],
  },
  sectionTitle: {
    fontSize: typography.size.md,
    fontWeight: typography.weight.semibold,
    marginBottom: spacing[2],
  },
  kv: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    paddingVertical: spacing[2],
    gap: spacing[3],
  },
  kvKey: {
    fontSize: typography.size.xs,
    fontWeight: typography.weight.medium,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    flexShrink: 0,
  },
  kvValue: {
    fontSize: typography.size.sm,
    flex: 1,
    textAlign: "right",
  },
  assetRow: {
    paddingVertical: spacing[2],
  },
  assetTitle: {
    fontSize: typography.size.md,
    fontWeight: typography.weight.medium,
  },
  assetSub: {
    fontSize: typography.size.xs,
    marginTop: 2,
  },
  scriptToggle: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[1],
    paddingVertical: spacing[1],
  },
  scriptToggleText: {
    fontSize: typography.size.sm,
    fontWeight: typography.weight.medium,
  },
  title: {
    fontSize: typography.size.lg,
    fontWeight: typography.weight.semibold,
  },
  bodyText: {
    fontSize: typography.size.sm,
    textAlign: "center",
  },
});
