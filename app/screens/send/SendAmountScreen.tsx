import {
  type RouteProp,
  useNavigation,
  useRoute,
} from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { ChevronDown, Lock } from "lucide-react-native";
import * as React from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import AssetAvatar from "../../components/AssetAvatar";
import Button from "../../components/Button";
import { useResolvedTheme } from "../../hooks/useResolvedTheme";
import type { RootStackParamList } from "../../navigation/RootStack";
import {
  parseAssetAmount,
  prettyAssetAmount,
  truncatedAssetId,
} from "../../services/arkade/asset-format";
import { readIconApprovals } from "../../services/arkade/asset-icon-approval";
import {
  type CachedAssetDetails,
  fetchAssetDetailsCached,
  readAssetMetadataMap,
} from "../../services/arkade/asset-metadata";
import { formatSatsAs } from "../../services/format";
import { paymentTypeLabel } from "../../services/paymentParser";
import { satsToFiat } from "../../store/mock";
import { useAppStore } from "../../store/useAppStore";
import { radius, spacing, typography } from "../../theme/theme";

type Nav = NativeStackNavigationProp<RootStackParamList, "SendAmount">;
type Route = RouteProp<RootStackParamList, "SendAmount">;

const PRESETS = [1_000, 10_000, 100_000];

const BTC_SELECTION = { kind: "btc" } as const;
type AssetSelection = typeof BTC_SELECTION | { kind: "asset"; assetId: string };

export default function SendAmountScreen() {
  const theme = useResolvedTheme();
  const nav = useNavigation<Nav>();
  const { option, preselectAssetId } = useRoute<Route>().params;
  const fiatCurrency = useAppStore((s) => s.preferences.fiatCurrency);
  const wallet = useAppStore((s) => s.wallet);
  const importedAssetIds = useAppStore((s) => s.assets.importedAssetIds);
  const network = useAppStore(
    (s) => s.network.detectedNetwork ?? s.wallet?.network ?? null,
  );

  const assetBalances = wallet?.assetBalances ?? [];
  const candidateAssetIds = React.useMemo(() => {
    const set = new Set<string>();
    for (const b of assetBalances) set.add(b.assetId);
    for (const id of importedAssetIds) set.add(id);
    return Array.from(set);
  }, [assetBalances, importedAssetIds]);

  // Lightning invoices with an embedded amount are amount-locked.
  const isLightningLocked = option.type === "lightning" && !!option.amountSats;
  const assetCarriedByOption = option.assetId;
  const assetCarriedFromShortcut = preselectAssetId;

  const initialSelection: AssetSelection =
    option.type === "arkade" &&
    assetCarriedByOption &&
    candidateAssetIds.includes(assetCarriedByOption)
      ? { kind: "asset", assetId: assetCarriedByOption }
      : option.type === "arkade" &&
          assetCarriedByOption &&
          !candidateAssetIds.includes(assetCarriedByOption)
        ? { kind: "asset", assetId: assetCarriedByOption }
        : option.type === "arkade" && assetCarriedFromShortcut
          ? { kind: "asset", assetId: assetCarriedFromShortcut }
          : BTC_SELECTION;

  const [selection, setSelection] =
    React.useState<AssetSelection>(initialSelection);
  const [showAssetPicker, setShowAssetPicker] = React.useState(false);
  const [assetMetadata, setAssetMetadata] = React.useState<
    Map<string, CachedAssetDetails>
  >(() => new Map());
  const [iconApprovals, setIconApprovals] = React.useState<
    Record<string, boolean>
  >({});

  React.useEffect(() => {
    if (!network) return;
    if (candidateAssetIds.length === 0 && !assetCarriedByOption) return;
    const idsToLoad = new Set<string>(candidateAssetIds);
    if (assetCarriedByOption) idsToLoad.add(assetCarriedByOption);
    let cancelled = false;
    void (async () => {
      const ids = Array.from(idsToLoad);
      const [initial, approvals] = await Promise.all([
        readAssetMetadataMap(network, ids),
        readIconApprovals(),
      ]);
      if (cancelled) return;
      setAssetMetadata(new Map(initial));
      setIconApprovals(approvals);
      const next = new Map(initial);
      for (const id of ids) {
        if (next.has(id)) continue;
        try {
          const fetched = await fetchAssetDetailsCached(network, id, "cache");
          if (cancelled) return;
          next.set(id, fetched);
        } catch {
          // best-effort
        }
      }
      if (!cancelled) setAssetMetadata(new Map(next));
    })();
    return () => {
      cancelled = true;
    };
  }, [network, candidateAssetIds, assetCarriedByOption]);

  const selectedAssetId = selection.kind === "asset" ? selection.assetId : null;
  const selectedAssetDetails = selectedAssetId
    ? assetMetadata.get(selectedAssetId)
    : undefined;
  const selectedAssetDecimals =
    typeof selectedAssetDetails?.metadata?.decimals === "number"
      ? selectedAssetDetails.metadata.decimals
      : 0;
  const selectedAssetTicker =
    selectedAssetDetails?.metadata?.ticker ??
    (selectedAssetId ? truncatedAssetId(selectedAssetId) : "");
  const selectedAssetBalance = selectedAssetId
    ? assetBalances.find((b) => b.assetId === selectedAssetId)
    : undefined;
  let selectedAssetBalanceBase = 0n;
  try {
    selectedAssetBalanceBase = selectedAssetBalance
      ? BigInt(selectedAssetBalance.amount)
      : 0n;
  } catch {
    selectedAssetBalanceBase = 0n;
  }

  // Source of truth for the BIP21-carried asset amount: parse the URI's
  // base-unit value once. The user-visible string is *derived* from this
  // (re-rendered when decimals load) until the user edits, at which point
  // we switch to the typed string. This avoids the "100 displayed as
  // decimals-0, then re-parsed as decimals-2 → 10000 base units" bug.
  const bip21AssetAmountBase = React.useMemo<bigint | null>(() => {
    if (option.type !== "arkade" || !option.assetAmountBase) return null;
    try {
      const n = BigInt(option.assetAmountBase);
      return n > 0n ? n : null;
    } catch {
      return null;
    }
  }, [option]);

  const [userValue, setUserValue] = React.useState<string>(
    selection.kind === "btc" && option.amountSats
      ? String(option.amountSats)
      : "",
  );
  const [userTouched, setUserTouched] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Reset the value when the user switches asset selection so we don't carry
  // a stale sats string into an asset context with different precision.
  const lastSelectionKey = React.useRef<string>("");
  React.useEffect(() => {
    const key = selection.kind === "btc" ? "btc" : `asset:${selection.assetId}`;
    if (lastSelectionKey.current === key) return;
    lastSelectionKey.current = key;
    // Only auto-clear after the initial mount; the initial value is already
    // set above.
    if (
      key ===
      (selection.kind === "btc"
        ? "btc"
        : `asset:${initialSelection.kind === "asset" ? initialSelection.assetId : "btc"}`)
    ) {
      return;
    }
    setUserValue("");
    setUserTouched(false);
    setError(null);
  }, [selection, initialSelection]);

  // Asset selection forces Arkade-only destinations.
  const isAssetSend = selection.kind === "asset";
  const arkadeOnlyViolation =
    isAssetSend && (option.type === "lightning" || option.type === "bitcoin");

  // Display value: prefer the BIP21 base amount (rendered with current
  // decimals) until the user types; once they do, the typed string wins.
  const useBip21Display =
    isAssetSend && !userTouched && bip21AssetAmountBase != null;
  const value = useBip21Display
    ? prettyAssetAmount(
        bip21AssetAmountBase as bigint,
        selectedAssetDecimals,
        false,
      )
    : userValue;

  let sats = 0;
  let assetAmountBase: bigint | null = null;
  let valid = false;
  let insufficient = false;

  if (isAssetSend) {
    if (useBip21Display) {
      // BIP21-carried amount is canonical — no re-parse round-trip.
      assetAmountBase = bip21AssetAmountBase;
      if (assetAmountBase != null && assetAmountBase > 0n) {
        valid = true;
        insufficient = assetAmountBase > selectedAssetBalanceBase;
      }
    } else {
      const trimmed = userValue.trim();
      if (trimmed.length > 0) {
        assetAmountBase = parseAssetAmount(trimmed, selectedAssetDecimals);
        if (assetAmountBase != null && assetAmountBase > 0n) {
          valid = true;
          insufficient = assetAmountBase > selectedAssetBalanceBase;
        }
      }
    }
  } else {
    sats = Number.parseInt(userValue.replace(/[^0-9]/g, ""), 10);
    const balance = wallet?.balanceSats ?? 0;
    valid = Number.isFinite(sats) && sats > 0;
    insufficient = valid && sats > balance;
  }

  function handleContinue() {
    if (arkadeOnlyViolation) {
      setError("Assets can only be sent to Arkade addresses");
      return;
    }
    if (!valid) {
      setError(
        isAssetSend ? "Enter an asset amount" : "Enter an amount in sats",
      );
      return;
    }
    if (insufficient) {
      setError(
        isAssetSend
          ? `Insufficient ${selectedAssetTicker} balance`
          : "Amount exceeds wallet balance",
      );
      return;
    }
    if (isAssetSend && assetAmountBase != null && selectedAssetId) {
      nav.navigate("SendReview", {
        option,
        amountSats: 330,
        assetId: selectedAssetId,
        assetAmountBase: assetAmountBase.toString(),
      });
      return;
    }
    nav.navigate("SendReview", { option, amountSats: sats });
  }

  function handleChange(text: string) {
    if (isLightningLocked) return;
    setUserTouched(true);
    if (isAssetSend) {
      // Allow digits + a single decimal separator.
      setUserValue(text.replace(/[^0-9.]/g, ""));
    } else {
      setUserValue(text.replace(/[^0-9]/g, ""));
    }
    setError(null);
  }

  function selectorLabel(): {
    title: string;
    subtitle: string;
    avatarTicker: string | null;
    avatarName: string | null;
    icon?: string;
    approved?: boolean;
  } {
    if (selection.kind === "btc") {
      return {
        title: "Bitcoin",
        subtitle: `${formatSatsAs(wallet?.balanceSats ?? 0, "sats")} sats available`,
        avatarTicker: "B",
        avatarName: "Bitcoin",
      };
    }
    const details = assetMetadata.get(selection.assetId);
    return {
      title:
        details?.metadata?.ticker ??
        details?.metadata?.name ??
        truncatedAssetId(selection.assetId),
      subtitle: `${prettyAssetAmount(selectedAssetBalanceBase, selectedAssetDecimals)} ${
        details?.metadata?.ticker ?? ""
      } available`,
      avatarTicker: details?.metadata?.ticker ?? null,
      avatarName: details?.metadata?.name ?? null,
      icon: details?.metadata?.icon,
      approved: iconApprovals[selection.assetId] === true,
    };
  }

  const sel = selectorLabel();
  const canShowSelector =
    option.type === "arkade" && candidateAssetIds.length > 0;

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
            <Text
              style={[styles.summaryLabel, { color: theme.colors.textMuted }]}
            >
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
              <Text
                style={[styles.summaryMemo, { color: theme.colors.textSubtle }]}
              >
                "{option.memo}"
              </Text>
            ) : null}
          </View>

          {arkadeOnlyViolation ? (
            <View
              style={[
                styles.banner,
                {
                  backgroundColor: `${theme.colors.danger}20`,
                  borderColor: theme.colors.danger,
                },
              ]}
            >
              <Text style={[styles.bannerText, { color: theme.colors.danger }]}>
                Asset sends are Arkade-only. Switch back to Bitcoin or pick an
                Arkade destination.
              </Text>
            </View>
          ) : null}

          {canShowSelector ? (
            <Pressable
              onPress={() => setShowAssetPicker(true)}
              style={({ pressed }) => [
                styles.selector,
                {
                  backgroundColor: theme.colors.card,
                  borderColor: theme.colors.border,
                  opacity: pressed ? 0.8 : 1,
                },
              ]}
            >
              <AssetAvatar
                size={36}
                icon={sel.icon ?? null}
                approved={sel.approved === true}
                ticker={sel.avatarTicker}
                name={sel.avatarName}
              />
              <View style={styles.selectorInfo}>
                <Text
                  style={[styles.selectorTitle, { color: theme.colors.text }]}
                >
                  {sel.title}
                </Text>
                <Text
                  style={[
                    styles.selectorSubtitle,
                    { color: theme.colors.textSubtle },
                  ]}
                >
                  {sel.subtitle}
                </Text>
              </View>
              <ChevronDown color={theme.colors.textSubtle} size={20} />
            </Pressable>
          ) : null}

          <View style={styles.amountSection}>
            <View style={styles.amountHeader}>
              <Text
                style={[styles.amountTitle, { color: theme.colors.textMuted }]}
              >
                Amount
              </Text>
              {isLightningLocked ? (
                <View style={styles.lockedTag}>
                  <Lock color={theme.colors.textSubtle} size={12} />
                  <Text
                    style={[
                      styles.lockedTagText,
                      { color: theme.colors.textSubtle },
                    ]}
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
                  opacity: isLightningLocked ? 0.85 : 1,
                },
              ]}
            >
              <TextInput
                value={value}
                onChangeText={handleChange}
                placeholder="0"
                placeholderTextColor={theme.colors.placeholder}
                keyboardType={isAssetSend ? "decimal-pad" : "number-pad"}
                inputMode={isAssetSend ? "decimal" : "numeric"}
                editable={!isLightningLocked}
                autoFocus={!isLightningLocked}
                style={[styles.input, { color: theme.colors.text }]}
                accessibilityLabel="Amount"
              />
              <Text style={[styles.unit, { color: theme.colors.textSubtle }]}>
                {isAssetSend ? selectedAssetTicker : "sats"}
              </Text>
            </View>

            <View style={styles.metaRow}>
              <Text
                style={[styles.metaText, { color: theme.colors.textSubtle }]}
              >
                {!isAssetSend && sats > 0
                  ? `≈ ${satsToFiat(sats, fiatCurrency)}`
                  : " "}
              </Text>
              <Text
                style={[styles.metaText, { color: theme.colors.textSubtle }]}
              >
                {isAssetSend
                  ? `Balance: ${prettyAssetAmount(
                      selectedAssetBalanceBase,
                      selectedAssetDecimals,
                    )} ${selectedAssetTicker}`
                  : `Balance: ${formatSatsAs(wallet?.balanceSats ?? 0, "sats")} sats`}
              </Text>
            </View>

            {!isLightningLocked && !isAssetSend ? (
              <View style={styles.presets}>
                {PRESETS.map((p) => (
                  <Pressable
                    key={p}
                    onPress={() => {
                      setUserTouched(true);
                      setUserValue(String(p));
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
                      style={[styles.presetLabel, { color: theme.colors.text }]}
                    >
                      {formatSatsAs(p, "sats")}
                    </Text>
                  </Pressable>
                ))}
                <Pressable
                  onPress={() => {
                    setUserTouched(true);
                    setUserValue(String(wallet?.balanceSats ?? 0));
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
                    style={[
                      styles.presetLabel,
                      { color: theme.colors.primary },
                    ]}
                  >
                    Max
                  </Text>
                </Pressable>
              </View>
            ) : null}

            {!isLightningLocked &&
            isAssetSend &&
            selectedAssetBalanceBase > 0n ? (
              <View style={styles.presets}>
                <Pressable
                  onPress={() => {
                    setUserTouched(true);
                    setUserValue(
                      prettyAssetAmount(
                        selectedAssetBalanceBase,
                        selectedAssetDecimals,
                        false,
                      ),
                    );
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
                    style={[
                      styles.presetLabel,
                      { color: theme.colors.primary },
                    ]}
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
            disabled={!valid || insufficient || arkadeOnlyViolation}
            onPress={handleContinue}
          />
        </View>
      </KeyboardAvoidingView>

      <Modal
        visible={showAssetPicker}
        animationType="slide"
        transparent
        onRequestClose={() => setShowAssetPicker(false)}
      >
        <Pressable
          style={styles.modalBackdrop}
          onPress={() => setShowAssetPicker(false)}
        >
          <Pressable
            style={[
              styles.modalSheet,
              {
                backgroundColor: theme.colors.card,
                borderColor: theme.colors.border,
              },
            ]}
            onPress={(e) => e.stopPropagation()}
          >
            <Text style={[styles.modalTitle, { color: theme.colors.text }]}>
              Pick what to send
            </Text>
            <ScrollView style={styles.modalList}>
              <AssetPickerRow
                title="Bitcoin"
                subtitle={`${formatSatsAs(wallet?.balanceSats ?? 0, "sats")} sats`}
                avatarTicker="B"
                avatarName="Bitcoin"
                selected={selection.kind === "btc"}
                onPress={() => {
                  setSelection(BTC_SELECTION);
                  setShowAssetPicker(false);
                }}
              />
              {candidateAssetIds.map((id) => {
                const details = assetMetadata.get(id);
                const decimals =
                  typeof details?.metadata?.decimals === "number"
                    ? details.metadata.decimals
                    : 0;
                const balanceEntry = assetBalances.find(
                  (b) => b.assetId === id,
                );
                let amount = 0n;
                try {
                  amount = balanceEntry ? BigInt(balanceEntry.amount) : 0n;
                } catch {
                  amount = 0n;
                }
                const ticker =
                  details?.metadata?.ticker ?? truncatedAssetId(id);
                return (
                  <AssetPickerRow
                    key={id}
                    title={details?.metadata?.name ?? ticker}
                    subtitle={`${prettyAssetAmount(amount, decimals)} ${ticker}`}
                    avatarTicker={details?.metadata?.ticker ?? null}
                    avatarName={details?.metadata?.name ?? null}
                    icon={details?.metadata?.icon}
                    approved={iconApprovals[id] === true}
                    selected={
                      selection.kind === "asset" && selection.assetId === id
                    }
                    onPress={() => {
                      setSelection({ kind: "asset", assetId: id });
                      setShowAssetPicker(false);
                    }}
                  />
                );
              })}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

function AssetPickerRow(props: {
  title: string;
  subtitle: string;
  avatarTicker?: string | null;
  avatarName?: string | null;
  icon?: string;
  approved?: boolean;
  selected: boolean;
  onPress: () => void;
}) {
  const theme = useResolvedTheme();
  return (
    <Pressable
      onPress={props.onPress}
      style={({ pressed }) => [
        styles.pickerRow,
        {
          backgroundColor: props.selected
            ? theme.colors.primarySoft
            : "transparent",
          opacity: pressed ? 0.8 : 1,
        },
      ]}
    >
      <AssetAvatar
        size={36}
        icon={props.icon ?? null}
        approved={props.approved === true}
        ticker={props.avatarTicker ?? null}
        name={props.avatarName ?? null}
      />
      <View style={{ flex: 1 }}>
        <Text style={[styles.pickerTitle, { color: theme.colors.text }]}>
          {props.title}
        </Text>
        <Text
          style={[styles.pickerSubtitle, { color: theme.colors.textSubtle }]}
        >
          {props.subtitle}
        </Text>
      </View>
    </Pressable>
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
  banner: {
    marginTop: spacing[4],
    padding: spacing[3],
    borderRadius: radius.md,
    borderWidth: 1,
  },
  bannerText: {
    fontSize: typography.size.sm,
  },
  selector: {
    marginTop: spacing[4],
    paddingVertical: spacing[3],
    paddingHorizontal: spacing[4],
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
  },
  selectorInfo: {
    flex: 1,
    gap: 2,
  },
  selectorTitle: {
    fontSize: typography.size.md,
    fontWeight: typography.weight.semibold,
  },
  selectorSubtitle: {
    fontSize: typography.size.xs,
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
  modalBackdrop: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.5)",
  },
  modalSheet: {
    paddingTop: spacing[5],
    paddingHorizontal: spacing[5],
    paddingBottom: spacing[7],
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    borderTopWidth: 1,
    maxHeight: "70%",
  },
  modalTitle: {
    fontSize: typography.size.md,
    fontWeight: typography.weight.semibold,
    marginBottom: spacing[3],
  },
  modalList: {
    paddingBottom: spacing[5],
  },
  pickerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    paddingVertical: spacing[3],
    paddingHorizontal: spacing[3],
    borderRadius: radius.md,
  },
  pickerTitle: {
    fontSize: typography.size.md,
    fontWeight: typography.weight.medium,
  },
  pickerSubtitle: {
    fontSize: typography.size.xs,
    marginTop: 2,
  },
});
