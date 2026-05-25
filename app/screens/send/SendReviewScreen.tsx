import {
  type RouteProp,
  useNavigation,
  useRoute,
} from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { AlertTriangle, ArrowUpRight, Info } from "lucide-react-native";
import * as React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import AssetAvatar from "../../components/AssetAvatar";
import Button from "../../components/Button";
import { useToast } from "../../components/ToastProvider";
import { useFormatSats } from "../../hooks/useFormatSats";
import { useResolvedTheme } from "../../hooks/useResolvedTheme";
import type { RootStackParamList } from "../../navigation/RootStack";
import {
  prettyAssetAmount,
  truncatedAssetId,
} from "../../services/arkade/asset-format";
import { readIconApprovals } from "../../services/arkade/asset-icon-approval";
import {
  type CachedAssetDetails,
  fetchAssetDetailsCached,
} from "../../services/arkade/asset-metadata";
import {
  estimateOffboardFee,
  OffboardFeeEstimateError,
} from "../../services/arkade/feePreview";
import {
  type ChainSwapQuote,
  isLightningSupportedForNetwork,
  quoteArkToBtcChainSwap,
  quoteSubmarineSwapFee,
  type SubmarineFeeQuote,
} from "../../services/arkade/lightning";
import { ensureWallet } from "../../services/arkade/runtime";
import {
  networkNameOrNull,
  paymentTypeLabel,
} from "../../services/paymentParser";
import {
  type BitcoinRail,
  executeSend,
  unsupportedReasonFor,
} from "../../services/sendExecutor";
import { satsToFiat } from "../../store/mock";
import { useAppStore } from "../../store/useAppStore";
import { motion, radius, spacing, typography } from "../../theme/theme";

const ON_CHAIN_TIMING_NOTICE =
  "On-chain sends are settled by Arkade in the next batch round and confirmed on-chain afterwards.";
const CHAIN_SWAP_TIMING_NOTICE =
  "Settles in one Bitcoin confirmation (~10 min) via a Boltz chain swap.";

type Nav = NativeStackNavigationProp<RootStackParamList, "SendReview">;
type Route = RouteProp<RootStackParamList, "SendReview">;

function Row({
  label,
  value,
  mono,
  emphasis,
  pending,
}: {
  label: string;
  value: string;
  mono?: boolean;
  emphasis?: boolean;
  /**
   * When the row's value is still resolving (showing a loading label like
   * "Estimating…"). The loading label stays fully visible; only the final
   * value fades in once `pending` flips back to false.
   */
  pending?: boolean;
}) {
  const theme = useResolvedTheme();
  const valueOpacity = useSharedValue(1);
  const wasPending = React.useRef(pending ?? false);
  React.useEffect(() => {
    // Ease the resolved figure in only on the loading → resolved transition.
    // While pending the opacity holds at 1 so the "Estimating…" label reads
    // clearly; the brief fade is reserved for the final number arriving.
    if (wasPending.current && !pending) {
      valueOpacity.value = withSequence(
        withTiming(0, { duration: 0 }),
        withTiming(1, { duration: motion.duration.slow }),
      );
    }
    wasPending.current = pending ?? false;
  }, [pending, valueOpacity]);
  const valueStyle = useAnimatedStyle(() => ({ opacity: valueOpacity.value }));
  return (
    <View style={[rowStyles.row, { borderBottomColor: theme.colors.divider }]}>
      <Text style={[rowStyles.label, { color: theme.colors.textMuted }]}>
        {label}
      </Text>
      <Animated.Text
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
          valueStyle,
        ]}
        numberOfLines={1}
      >
        {value}
      </Animated.Text>
    </View>
  );
}

/**
 * Entrance wrapper for conditionally-mounted rows (the resolved Total lines).
 * On mount it eases from slightly-low + transparent to its resting position so
 * the total "arrives" gracefully once its quote resolves rather than popping in.
 */
function AnimatedRow({
  visible = true,
  children,
}: {
  visible?: boolean;
  children: React.ReactNode;
}) {
  const progress = useSharedValue(0);
  React.useEffect(() => {
    progress.value = withTiming(visible ? 1 : 0, {
      duration: motion.duration.slow,
    });
  }, [visible, progress]);
  const style = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: (1 - progress.value) * 10 }],
  }));
  return <Animated.View style={style}>{children}</Animated.View>;
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

function bitcoinAddressFromOption(raw: string): string | null {
  const trimmed = raw.trim();
  const noScheme = trimmed.replace(/^bitcoin:/i, "");
  const qIndex = noScheme.indexOf("?");
  const address = qIndex === -1 ? noScheme : noScheme.slice(0, qIndex);
  return address || null;
}

export default function SendReviewScreen() {
  const theme = useResolvedTheme();
  const nav = useNavigation<Nav>();
  const {
    option,
    amountSats,
    flow,
    assetId,
    assetAmountBase,
    assetDecimals: routeAssetDecimals,
    assetTicker: routeAssetTicker,
  } = useRoute<Route>().params;
  const isAssetSend = typeof assetId === "string" && !!assetAmountBase;
  let assetAmountBaseParsed: bigint | null = null;
  if (isAssetSend && assetAmountBase) {
    try {
      assetAmountBaseParsed = BigInt(assetAmountBase);
    } catch {
      assetAmountBaseParsed = null;
    }
  }
  const [assetDetails, setAssetDetails] =
    React.useState<CachedAssetDetails | null>(null);
  // Route-provided values are the source of truth for the on-screen
  // amount/ticker: SendAmount only navigates after metadata is resolved
  // (see decimalsResolved gate there). Async metadata fetch below only
  // hydrates secondary fields (name, supply, icon, controlAssetId).
  const assetDecimals =
    typeof routeAssetDecimals === "number"
      ? routeAssetDecimals
      : typeof assetDetails?.metadata?.decimals === "number"
        ? assetDetails.metadata.decimals
        : 0;
  const assetTicker = routeAssetTicker ?? assetDetails?.metadata?.ticker ?? "";
  const [iconApprovals, setIconApprovals] = React.useState<
    Record<string, boolean>
  >({});
  const fiatCurrency = useAppStore((s) => s.preferences.fiatCurrency);
  const network = useAppStore(
    (s) => s.network.detectedNetwork ?? s.wallet?.network ?? null,
  );
  const wallet = useAppStore((s) => s.wallet);
  const walletBehavior = useAppStore((s) => s.walletBehavior);
  const serverInfo = useAppStore((s) => s.network.serverInfo);
  const { format: formatSats, label: unitLabel } = useFormatSats();
  const { showToast } = useToast();

  const [sending, setSending] = React.useState(false);
  React.useEffect(() => {
    if (!isAssetSend || !assetId || !network) return;
    let cancelled = false;
    void (async () => {
      const [details, approvals] = await Promise.all([
        fetchAssetDetailsCached(network, assetId, "cache").catch(() => null),
        readIconApprovals(),
      ]);
      if (cancelled) return;
      if (details) setAssetDetails(details);
      setIconApprovals(approvals);
    })();
    return () => {
      cancelled = true;
    };
  }, [assetId, network, isAssetSend]);
  const [lightningFee, setLightningFee] =
    React.useState<SubmarineFeeQuote | null>(null);
  const [lightningFeeLoading, setLightningFeeLoading] = React.useState(false);

  const [onchainFeeSats, setOnchainFeeSats] = React.useState<number | null>(
    null,
  );
  const [onchainFeeLoading, setOnchainFeeLoading] = React.useState(false);
  const [onchainFeeError, setOnchainFeeError] = React.useState<string | null>(
    null,
  );

  const chainSwapAvailable =
    option.type === "bitcoin" && isLightningSupportedForNetwork(network);
  const [chainSwapQuote, setChainSwapQuote] =
    React.useState<ChainSwapQuote | null>(null);
  const [chainSwapLoading, setChainSwapLoading] = React.useState(false);
  const [chainSwapError, setChainSwapError] = React.useState<string | null>(
    null,
  );

  const [bitcoinRail, setBitcoinRail] = React.useState<BitcoinRail>("collab");

  React.useEffect(() => {
    if (option.type !== "lightning" || !network) return;
    let cancelled = false;
    setLightningFeeLoading(true);
    quoteSubmarineSwapFee(network, amountSats)
      .then((quote) => {
        if (!cancelled) setLightningFee(quote);
      })
      .catch(() => {
        if (!cancelled) setLightningFee(null);
      })
      .finally(() => {
        if (!cancelled) setLightningFeeLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [option.type, network, amountSats]);

  React.useEffect(() => {
    if (option.type !== "bitcoin" || !wallet || !serverInfo) return;
    const address = bitcoinAddressFromOption(option.raw);
    if (!address) {
      setOnchainFeeError("Bitcoin address could not be parsed");
      return;
    }
    let cancelled = false;
    setOnchainFeeLoading(true);
    setOnchainFeeError(null);
    (async () => {
      try {
        const w = await ensureWallet({
          metadata: wallet,
          behavior: walletBehavior,
        });
        const vtxos = await w.getVtxos({
          withRecoverable: true,
          withUnrolled: false,
        });
        const estimate = estimateOffboardFee({
          vtxos,
          amountSats,
          destinationAddress: address,
          feeInfo: { intentFee: serverInfo.intentFee },
          network: networkNameOrNull(network),
        });
        if (!cancelled) setOnchainFeeSats(estimate.feeSats);
      } catch (e) {
        if (cancelled) return;
        const message =
          e instanceof OffboardFeeEstimateError
            ? e.message
            : e instanceof Error
              ? e.message
              : "Could not estimate fee";
        setOnchainFeeError(message);
        setOnchainFeeSats(null);
      } finally {
        if (!cancelled) setOnchainFeeLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    option.type,
    option.raw,
    amountSats,
    wallet,
    walletBehavior,
    serverInfo,
    network,
  ]);

  React.useEffect(() => {
    if (!chainSwapAvailable || !network) return;
    let cancelled = false;
    setChainSwapLoading(true);
    setChainSwapError(null);
    quoteArkToBtcChainSwap(network, amountSats)
      .then((quote) => {
        if (cancelled) return;
        if (!quote) {
          setChainSwapError("Chain swap quote unavailable");
          setChainSwapQuote(null);
          return;
        }
        if (!quote.withinLimits) {
          setChainSwapError(
            `Chain swap supports ${quote.min}–${quote.max} sats`,
          );
          setChainSwapQuote(quote);
          return;
        }
        setChainSwapQuote(quote);
      })
      .catch(() => {
        if (cancelled) return;
        setChainSwapError("Chain swap quote unavailable");
        setChainSwapQuote(null);
      })
      .finally(() => {
        if (!cancelled) setChainSwapLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [chainSwapAvailable, network, amountSats]);

  const unsupported = unsupportedReasonFor(option);
  const insufficientOffchain =
    option.type === "bitcoin" &&
    wallet != null &&
    amountSats > wallet.balanceSats;

  const collabFee = onchainFeeSats;
  const chainSwapFee = chainSwapQuote?.withinLimits
    ? chainSwapQuote.feeSats
    : null;
  const collabAvailable = option.type === "bitcoin" && onchainFeeError == null;
  const chainSwapPayable =
    option.type === "bitcoin" &&
    chainSwapAvailable &&
    chainSwapError == null &&
    chainSwapFee != null;
  const insufficientForChainSwap =
    chainSwapFee != null &&
    wallet != null &&
    amountSats + chainSwapFee > wallet.balanceSats;
  const activeRailSendable =
    bitcoinRail === "collab"
      ? collabAvailable && !insufficientOffchain
      : chainSwapPayable && !insufficientForChainSwap;
  const onchainSendBlocked = option.type === "bitcoin" && !activeRailSendable;

  // Auto-fall back to whichever rail is available if the user hasn't picked
  // one explicitly (e.g. chain swap unsupported on this network).
  React.useEffect(() => {
    if (option.type !== "bitcoin") return;
    if (bitcoinRail === "chainswap" && !chainSwapPayable && collabAvailable) {
      setBitcoinRail("collab");
    } else if (
      bitcoinRail === "collab" &&
      !collabAvailable &&
      chainSwapPayable
    ) {
      setBitcoinRail("chainswap");
    }
  }, [option.type, bitcoinRail, chainSwapPayable, collabAvailable]);

  async function handleConfirm() {
    setSending(true);
    const railForResult: BitcoinRail | undefined =
      option.type === "bitcoin" ? bitcoinRail : undefined;
    try {
      const result = await executeSend(option, amountSats, {
        bitcoinRail: railForResult,
        flow,
        asset:
          isAssetSend && assetId && assetAmountBaseParsed != null
            ? { assetId, amountBase: assetAmountBaseParsed }
            : undefined,
      });
      if (result.ok) {
        nav.replace("SendResult", {
          status: "success",
          txId: result.txId,
          amountSats: result.amountSats,
          feeSats: result.feeSats,
          paymentType: option.type,
          destination: option.destination,
          bitcoinRail: railForResult,
          flow,
          assetId,
          assetAmountBase,
          assetDecimals: routeAssetDecimals,
          assetTicker: routeAssetTicker,
        });
      } else {
        showToast(result.error, "error");
        nav.replace("SendResult", {
          status: "error",
          message: result.error,
          amountSats,
          paymentType: option.type,
          destination: option.destination,
          bitcoinRail: railForResult,
          flow,
          assetId,
          assetAmountBase,
          assetDecimals: routeAssetDecimals,
          assetTicker: routeAssetTicker,
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
        bitcoinRail: railForResult,
        flow,
        assetId,
        assetAmountBase,
        assetDecimals: routeAssetDecimals,
        assetTicker: routeAssetTicker,
      });
    } finally {
      setSending(false);
    }
  }

  const paymentTypeDisplay =
    flow === "lnurl_send" ? "LNURL" : paymentTypeLabel(option.type);

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
          {isAssetSend ? (
            <AssetAvatar
              size={56}
              icon={assetDetails?.metadata?.icon ?? null}
              approved={assetId ? iconApprovals[assetId] === true : false}
              ticker={assetTicker || null}
              name={assetDetails?.metadata?.name ?? null}
            />
          ) : (
            <View
              style={[
                styles.iconWrap,
                { backgroundColor: theme.colors.primarySoft },
              ]}
            >
              <ArrowUpRight color={theme.colors.primary} size={24} />
            </View>
          )}
          <Text style={[styles.headerAmount, { color: theme.colors.text }]}>
            {isAssetSend && assetAmountBaseParsed != null
              ? `${prettyAssetAmount(
                  assetAmountBaseParsed,
                  assetDecimals,
                )} ${assetTicker}`.trim()
              : `${formatSats(amountSats)} ${unitLabel}`}
          </Text>
          {!isAssetSend ? (
            <Text
              style={[styles.headerFiat, { color: theme.colors.textMuted }]}
            >
              ≈ {satsToFiat(amountSats, fiatCurrency)}
            </Text>
          ) : assetId ? (
            <Text
              style={[styles.headerFiat, { color: theme.colors.textMuted }]}
            >
              {truncatedAssetId(assetId)}
            </Text>
          ) : null}
        </View>

        <View style={styles.card}>
          <Row
            label="Payment type"
            value={
              isAssetSend ? `${paymentTypeDisplay} · Asset` : paymentTypeDisplay
            }
          />
          <Row label="Destination" value={option.destination} mono />
          {option.memo ? <Row label="Memo" value={option.memo} /> : null}
          {isAssetSend && assetAmountBaseParsed != null ? (
            <>
              {assetDetails?.metadata?.name ? (
                <Row
                  label="Asset"
                  value={`${assetDetails.metadata.name}${
                    assetTicker ? ` (${assetTicker})` : ""
                  }`}
                />
              ) : null}
              <Row
                label="Asset amount"
                value={`${prettyAssetAmount(
                  assetAmountBaseParsed,
                  assetDecimals,
                )}${assetTicker ? ` ${assetTicker}` : ""}`}
                emphasis
              />
              <Row
                label="Network anchor"
                value={`${formatSats(amountSats)} ${unitLabel}`}
              />
            </>
          ) : (
            <Row
              label="Amount"
              value={`${formatSats(amountSats)} ${unitLabel}`}
              emphasis
            />
          )}
          {option.type === "lightning" ? (
            <>
              <Row
                label="Network fee"
                value={
                  lightningFeeLoading
                    ? "Calculating…"
                    : lightningFee
                      ? `${formatSats(lightningFee.feeSats)} ${unitLabel}`
                      : "Unavailable"
                }
                pending={lightningFeeLoading}
              />
              {lightningFee ? (
                <AnimatedRow>
                  <Row
                    label="Total"
                    value={`${formatSats(amountSats + lightningFee.feeSats)} ${unitLabel}`}
                    emphasis
                  />
                </AnimatedRow>
              ) : null}
            </>
          ) : null}
          {option.type === "bitcoin" ? (
            <>
              {chainSwapAvailable ? (
                <View style={styles.railToggle}>
                  <Pressable
                    onPress={() => setBitcoinRail("collab")}
                    disabled={!collabAvailable}
                    style={[
                      styles.railTab,
                      {
                        backgroundColor:
                          bitcoinRail === "collab"
                            ? theme.colors.primary
                            : theme.colors.surfaceSubtle,
                        opacity: collabAvailable ? 1 : 0.5,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.railTabLabel,
                        {
                          color:
                            bitcoinRail === "collab"
                              ? theme.colors.onPrimary
                              : theme.colors.text,
                        },
                      ]}
                    >
                      Cheap
                    </Text>
                    <Text
                      style={[
                        styles.railTabSub,
                        {
                          color:
                            bitcoinRail === "collab"
                              ? theme.colors.onPrimary
                              : theme.colors.textMuted,
                        },
                      ]}
                    >
                      next batch
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => setBitcoinRail("chainswap")}
                    disabled={!chainSwapPayable}
                    style={[
                      styles.railTab,
                      {
                        backgroundColor:
                          bitcoinRail === "chainswap"
                            ? theme.colors.primary
                            : theme.colors.surfaceSubtle,
                        opacity: chainSwapPayable ? 1 : 0.5,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.railTabLabel,
                        {
                          color:
                            bitcoinRail === "chainswap"
                              ? theme.colors.onPrimary
                              : theme.colors.text,
                        },
                      ]}
                    >
                      Fast
                    </Text>
                    <Text
                      style={[
                        styles.railTabSub,
                        {
                          color:
                            bitcoinRail === "chainswap"
                              ? theme.colors.onPrimary
                              : theme.colors.textMuted,
                        },
                      ]}
                    >
                      chain swap
                    </Text>
                  </Pressable>
                </View>
              ) : null}
              <Row
                label="Network fee"
                value={
                  bitcoinRail === "collab"
                    ? onchainFeeLoading
                      ? "Estimating…"
                      : onchainFeeError
                        ? "Unavailable"
                        : collabFee != null
                          ? `${formatSats(collabFee)} ${unitLabel}`
                          : "—"
                    : chainSwapLoading
                      ? "Quoting…"
                      : chainSwapError
                        ? "Unavailable"
                        : chainSwapFee != null
                          ? `${formatSats(chainSwapFee)} ${unitLabel}`
                          : "—"
                }
                pending={
                  bitcoinRail === "collab"
                    ? onchainFeeLoading
                    : chainSwapLoading
                }
              />
              {bitcoinRail === "collab" && collabFee != null ? (
                <Text
                  style={[styles.feeHint, { color: theme.colors.textSubtle }]}
                >
                  Estimate — finalised at settlement.
                </Text>
              ) : null}
              {bitcoinRail === "chainswap" && chainSwapFee != null ? (
                <AnimatedRow>
                  <Row
                    label="Total"
                    value={`${formatSats(amountSats + chainSwapFee)} ${unitLabel}`}
                    emphasis
                  />
                </AnimatedRow>
              ) : null}
            </>
          ) : null}
        </View>

        {option.type === "bitcoin" && activeRailSendable ? (
          <View
            style={[
              styles.notice,
              { backgroundColor: `${theme.colors.primary}15` },
            ]}
          >
            <Info color={theme.colors.primary} size={16} />
            <Text style={[styles.noticeText, { color: theme.colors.primary }]}>
              {bitcoinRail === "collab"
                ? ON_CHAIN_TIMING_NOTICE
                : CHAIN_SWAP_TIMING_NOTICE}
            </Text>
          </View>
        ) : null}

        {bitcoinRail === "collab" && insufficientOffchain ? (
          <View
            style={[
              styles.notice,
              { backgroundColor: `${theme.colors.danger}15` },
            ]}
          >
            <AlertTriangle color={theme.colors.danger} size={16} />
            <Text style={[styles.noticeText, { color: theme.colors.danger }]}>
              Amount exceeds your offchain balance.
            </Text>
          </View>
        ) : null}

        {bitcoinRail === "chainswap" && insufficientForChainSwap ? (
          <View
            style={[
              styles.notice,
              { backgroundColor: `${theme.colors.danger}15` },
            ]}
          >
            <AlertTriangle color={theme.colors.danger} size={16} />
            <Text style={[styles.noticeText, { color: theme.colors.danger }]}>
              Amount + chain swap fee exceeds your offchain balance.
            </Text>
          </View>
        ) : null}

        {option.type === "bitcoin" &&
        bitcoinRail === "collab" &&
        onchainFeeError ? (
          <View
            style={[
              styles.notice,
              { backgroundColor: `${theme.colors.danger}15` },
            ]}
          >
            <AlertTriangle color={theme.colors.danger} size={16} />
            <Text style={[styles.noticeText, { color: theme.colors.danger }]}>
              {onchainFeeError}
            </Text>
          </View>
        ) : null}

        {option.type === "bitcoin" &&
        bitcoinRail === "chainswap" &&
        chainSwapError ? (
          <View
            style={[
              styles.notice,
              { backgroundColor: `${theme.colors.danger}15` },
            ]}
          >
            <AlertTriangle color={theme.colors.danger} size={16} />
            <Text style={[styles.noticeText, { color: theme.colors.danger }]}>
              {chainSwapError}
            </Text>
          </View>
        ) : null}

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
        ) : null}
      </ScrollView>

      <View style={styles.footer}>
        <Button
          label={
            sending
              ? "Sending…"
              : isAssetSend && assetAmountBaseParsed != null
                ? `Send ${prettyAssetAmount(
                    assetAmountBaseParsed,
                    assetDecimals,
                  )}${assetTicker ? ` ${assetTicker}` : ""}`
                : `Send ${formatSats(amountSats)} ${unitLabel}`
          }
          theme={theme}
          loading={sending}
          disabled={sending || !!unsupported || onchainSendBlocked}
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
  feeHint: {
    fontSize: typography.size.xs,
    textAlign: "right",
    marginTop: -spacing[1],
    paddingBottom: spacing[2],
  },
  railToggle: {
    flexDirection: "row",
    gap: spacing[2],
    paddingVertical: spacing[3],
  },
  railTab: {
    flex: 1,
    alignItems: "center",
    paddingVertical: spacing[3],
    paddingHorizontal: spacing[3],
    borderRadius: radius.sm,
  },
  railTabLabel: {
    fontSize: typography.size.sm,
    fontWeight: typography.weight.semibold,
  },
  railTabSub: {
    fontSize: typography.size.xs,
    marginTop: 2,
  },
  footer: {
    padding: spacing[5],
  },
});
