import type { Activity, ActivitySource } from "../../store/types";
import { prettyAssetAmount, truncatedAssetId } from "../arkade/asset-format";
import type { CachedAssetDetails } from "../arkade/asset-metadata";
import { type ExplorerIdKind, explorerUrl } from "./explorer";

export type SectionRow =
  | { kind: "text"; label: string; value: string }
  | {
      kind: "copy";
      label: string;
      value: string;
      mono?: boolean;
      multiline?: boolean;
      explorerKind?: ExplorerIdKind;
    };

export type Section = {
  id: string;
  title: string;
  rows: SectionRow[];
};

export type BuildSectionsContext = {
  /** Active network, used by callers to resolve explorer links. */
  network: string | null | undefined;
  /**
   * Optional cached asset metadata keyed by assetId. Callers preload this from
   * the asset-metadata cache after first paint and re-run `buildSections`.
   * Builder treats missing entries as "no metadata yet" — name/ticker fall
   * back to truncated asset ids, decimals default to 0.
   */
  assetMetadata?: Map<string, CachedAssetDetails>;
};

function readString(
  metadata: Activity["metadata"],
  key: string,
): string | null {
  const v = metadata?.[key];
  return typeof v === "string" && v.length > 0 ? v : null;
}

function readNumber(
  metadata: Activity["metadata"],
  key: string,
): number | null {
  const v = metadata?.[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function readBoolean(
  metadata: Activity["metadata"],
  key: string,
): boolean | null {
  const v = metadata?.[key];
  return typeof v === "boolean" ? v : null;
}

function settlementReasonCopy(reason: string | null): string | null {
  if (!reason) return null;
  if (reason === "boarding_mixed_unresolved") {
    return "Mixed boarding settlement — part of the value could not be cleanly attributed to renewal vs. fresh receive.";
  }
  if (reason === "asset_bearing_settlement") {
    return "Asset-bearing settlement — the wallet does not classify mixed asset commitments.";
  }
  return null;
}

function railCopy(rail: Activity["rail"]): string {
  if (rail === "arkade") return "Arkade";
  if (rail === "bitcoin") return "Bitcoin";
  if (rail === "lightning") return "Lightning";
  return "Unknown";
}

function statusCopy(status: Activity["status"]): string {
  if (status === "pending") return "Pending";
  if (status === "confirmed") return "Confirmed";
  if (status === "failed") return "Failed";
  if (status === "refunded") return "Refunded";
  if (status === "info") return "Info";
  return status;
}

function sourceCopy(source: ActivitySource): string {
  if (source.type === "arkade_tx") return "Arkade transaction";
  if (source.type === "boltz_swap") {
    const t = source.swapType;
    if (t === "reverse") return "Boltz reverse swap";
    if (t === "submarine") return "Boltz submarine swap";
    if (t === "chain") return "Boltz chain swap";
    return "Boltz swap";
  }
  if (source.type === "wallet_event") return "Wallet event";
  return "Unknown source";
}

/**
 * Pure section builder. Returns the list of non-Summary sections to render
 * below the summary card. The Summary section is rendered inline by the
 * screen because it has bespoke layout (icon, big amount, tag pills).
 */
export function buildActivityDetailSections(
  activity: Activity,
  ctx: BuildSectionsContext,
): Section[] {
  const sections: Section[] = [];
  const md = activity.metadata;

  // ---- Network ----
  const networkRows: SectionRow[] = [];
  if (activity.rail) {
    networkRows.push({
      kind: "text",
      label: "Rail",
      value: railCopy(activity.rail),
    });
  }
  const network = readString(md, "network") ?? ctx.network ?? null;
  if (network) {
    networkRows.push({
      kind: "text",
      label: "Network",
      value: network,
    });
  }
  networkRows.push({
    kind: "text",
    label: "Status",
    value: statusCopy(activity.status),
  });
  if (networkRows.length > 0) {
    sections.push({ id: "network", title: "Network", rows: networkRows });
  }

  // ---- Payment / amounts ----
  const paymentRows: SectionRow[] = [];
  if (activity.amountSats != null) {
    paymentRows.push({
      kind: "text",
      label: "Amount",
      value: `${activity.amountSats.toLocaleString()} sats`,
    });
  }
  const feeSats = readNumber(md, "feeSats");
  if (feeSats != null) {
    paymentRows.push({
      kind: "text",
      label: "Fee",
      value: `${feeSats.toLocaleString()} sats`,
    });
  }
  const netDeltaSats = readNumber(md, "netDeltaSats");
  if (netDeltaSats != null) {
    const sign = netDeltaSats > 0 ? "+" : "";
    paymentRows.push({
      kind: "text",
      label: "Net delta",
      value: `${sign}${netDeltaSats.toLocaleString()} sats`,
    });
  }
  if (paymentRows.length > 0) {
    sections.push({ id: "payment", title: "Payment", rows: paymentRows });
  }

  // ---- Identifiers ----
  const identifierRows: SectionRow[] = [];
  const arkTxid = readString(md, "arkTxid");
  if (arkTxid) {
    identifierRows.push({
      kind: "copy",
      label: "Arkade transaction id",
      value: arkTxid,
      mono: true,
      explorerKind: "ark_tx",
    });
  }
  const commitmentTxid = readString(md, "commitmentTxid");
  if (commitmentTxid) {
    identifierRows.push({
      kind: "copy",
      label: "Commitment transaction id",
      value: commitmentTxid,
      mono: true,
      explorerKind: "commitment_tx",
    });
  }
  const boardingTxid = readString(md, "boardingTxid");
  if (boardingTxid) {
    identifierRows.push({
      kind: "copy",
      label: "Boarding transaction id",
      value: boardingTxid,
      mono: true,
      explorerKind: "boarding_tx",
    });
  }
  const bitcoinTxid = readString(md, "bitcoinTxid");
  if (bitcoinTxid) {
    identifierRows.push({
      kind: "copy",
      label: "Bitcoin transaction id",
      value: bitcoinTxid,
      mono: true,
      explorerKind: "bitcoin_tx",
    });
  }
  const claimTxid = readString(md, "claimTxid");
  if (claimTxid) {
    identifierRows.push({
      kind: "copy",
      label: "Claim transaction id",
      value: claimTxid,
      mono: true,
      explorerKind: "bitcoin_tx",
    });
  }
  const refundTxid = readString(md, "refundTxid");
  if (refundTxid) {
    identifierRows.push({
      kind: "copy",
      label: "Refund transaction id",
      value: refundTxid,
      mono: true,
      explorerKind: "bitcoin_tx",
    });
  }
  const fundingTxid = readString(md, "fundingTxid");
  if (fundingTxid) {
    identifierRows.push({
      kind: "copy",
      label: "Funding transaction id",
      value: fundingTxid,
      mono: true,
      explorerKind: "bitcoin_tx",
    });
  }
  const paymentHash = readString(md, "paymentHash");
  if (paymentHash) {
    identifierRows.push({
      kind: "copy",
      label: "Payment hash",
      value: paymentHash,
      mono: true,
    });
  }
  if (identifierRows.length > 0) {
    sections.push({
      id: "identifiers",
      title: "Identifiers",
      rows: identifierRows,
    });
  }

  // ---- Addresses (only what the wallet itself owns or resolves) ----
  const addressRows: SectionRow[] = [];
  const boardingAddress = readString(md, "boardingAddress");
  if (boardingAddress) {
    addressRows.push({
      kind: "copy",
      label: "Boarding address",
      value: boardingAddress,
      mono: true,
    });
  }
  const arkadeAddress = readString(md, "arkadeAddress");
  if (arkadeAddress) {
    addressRows.push({
      kind: "copy",
      label: "Arkade address",
      value: arkadeAddress,
      mono: true,
    });
  }
  const bitcoinAddress = readString(md, "bitcoinAddress");
  if (bitcoinAddress) {
    addressRows.push({
      kind: "copy",
      label: "Bitcoin address",
      value: bitcoinAddress,
      mono: true,
    });
  }
  if (addressRows.length > 0) {
    sections.push({
      id: "addresses",
      title: "Addresses",
      rows: addressRows,
    });
  }

  // ---- Lightning ----
  // Pull from metadata first; fall back to source.swapId / source.swapType
  // when metadata is empty (pre-Phase-3 rows).
  const lightningRows: SectionRow[] = [];
  let swapId = readString(md, "swapId");
  let swapType = readString(md, "swapType");
  if (
    !swapId &&
    activity.source.type === "boltz_swap" &&
    activity.source.swapId
  ) {
    swapId = activity.source.swapId;
  }
  if (
    !swapType &&
    activity.source.type === "boltz_swap" &&
    activity.source.swapType
  ) {
    swapType = activity.source.swapType;
  }
  const provider = readString(md, "provider");
  if (swapId) {
    lightningRows.push({
      kind: "copy",
      label: "Swap id",
      value: swapId,
      mono: true,
    });
  }
  if (swapType) {
    lightningRows.push({
      kind: "text",
      label: "Swap type",
      value: swapType,
    });
  }
  if (provider) {
    lightningRows.push({
      kind: "text",
      label: "Provider",
      value: provider,
    });
  }
  const invoice = readString(md, "invoice");
  if (invoice) {
    lightningRows.push({
      kind: "copy",
      label: "Invoice",
      value: invoice,
      mono: true,
      multiline: true,
    });
  }
  const invoiceAmountSats = readNumber(md, "invoiceAmountSats");
  if (invoiceAmountSats != null) {
    lightningRows.push({
      kind: "text",
      label: "Invoice amount",
      value: `${invoiceAmountSats.toLocaleString()} sats`,
    });
  }
  const arkadeAmountSats = readNumber(md, "arkadeAmountSats");
  if (arkadeAmountSats != null) {
    lightningRows.push({
      kind: "text",
      label: "Arkade amount",
      value: `${arkadeAmountSats.toLocaleString()} sats`,
    });
  }
  const lightningFeeSats = readNumber(md, "lightningFeeSats");
  if (lightningFeeSats != null) {
    lightningRows.push({
      kind: "text",
      label: "Lightning fee",
      value: `${lightningFeeSats.toLocaleString()} sats`,
    });
  }
  const claimFeeSats = readNumber(md, "claimFeeSats");
  if (claimFeeSats != null) {
    lightningRows.push({
      kind: "text",
      label: "Claim fee",
      value: `${claimFeeSats.toLocaleString()} sats`,
    });
  }
  const refundFeeSats = readNumber(md, "refundFeeSats");
  if (refundFeeSats != null) {
    lightningRows.push({
      kind: "text",
      label: "Refund fee",
      value: `${refundFeeSats.toLocaleString()} sats`,
    });
  }
  const linkSource = readString(md, "linkSource");
  if (linkSource) {
    lightningRows.push({
      kind: "text",
      label: "Link source",
      value: linkSource,
    });
  }
  const boltzApiUrl = readString(md, "boltzApiUrl");
  if (boltzApiUrl) {
    lightningRows.push({
      kind: "copy",
      label: "Boltz API",
      value: boltzApiUrl,
      mono: true,
    });
  }
  if (lightningRows.length > 0) {
    sections.push({
      id: "lightning",
      title: "Lightning",
      rows: lightningRows,
    });
  }

  // ---- Renewal & Settlement ----
  const renewalRows: SectionRow[] = [];
  const inputCount = readNumber(md, "inputCount");
  const outputCount = readNumber(md, "outputCount");
  const renewedAmountSats =
    readNumber(md, "renewedAmountSats") ?? readNumber(md, "amountSats");
  const unresolvedAmountSats = readNumber(md, "unresolvedAmountSats");
  const settlementReason =
    readString(md, "settlementReason") ?? readString(md, "reason");
  const automatic = readBoolean(md, "automatic");
  const delegated = readBoolean(md, "delegated");

  if (inputCount != null) {
    renewalRows.push({
      kind: "text",
      label: "Inputs",
      value: String(inputCount),
    });
  }
  if (outputCount != null) {
    renewalRows.push({
      kind: "text",
      label: "Outputs",
      value: String(outputCount),
    });
  }
  if (renewedAmountSats != null && activity.kind === "wallet_event") {
    renewalRows.push({
      kind: "text",
      label: "Renewed amount",
      value: `${renewedAmountSats.toLocaleString()} sats`,
    });
  }
  if (unresolvedAmountSats != null) {
    renewalRows.push({
      kind: "text",
      label: "Unresolved amount",
      value: `${unresolvedAmountSats.toLocaleString()} sats`,
    });
  }
  if (automatic != null) {
    renewalRows.push({
      kind: "text",
      label: "Automatic",
      value: automatic ? "Yes" : "No",
    });
  }
  if (delegated != null) {
    renewalRows.push({
      kind: "text",
      label: "Delegated",
      value: delegated ? "Yes" : "No",
    });
  }
  const reasonCopy = settlementReasonCopy(settlementReason);
  if (reasonCopy) {
    renewalRows.push({
      kind: "text",
      label: "Reason",
      value: reasonCopy,
    });
  }
  if (renewalRows.length > 0) {
    sections.push({
      id: "renewal",
      title: activity.title === "Arkade settlement" ? "Settlement" : "Renewal",
      rows: renewalRows,
    });
  }

  // ---- Asset blocks (one section per per-tx asset delta) ----
  // Source of truth is `activity.assets[]`. For legacy rows missing that
  // field, fall back to `metadata.assetId` so older persisted activities
  // still render.
  const assetEntries: Array<{ assetId: string; amount: bigint | null }> = [];
  if (activity.assets && activity.assets.length > 0) {
    for (const a of activity.assets) {
      let parsed: bigint | null = null;
      try {
        parsed = BigInt(a.amount);
      } catch {
        parsed = null;
      }
      assetEntries.push({ assetId: a.assetId, amount: parsed });
    }
  } else {
    const legacyId = readString(md, "assetId");
    if (legacyId) {
      const legacyAmount = readNumber(md, "assetAmount");
      assetEntries.push({
        assetId: legacyId,
        amount: legacyAmount != null ? BigInt(legacyAmount) : null,
      });
    }
  }
  if (assetEntries.length > 0) {
    const anchorAmountSats = readNumber(md, "anchorAmountSats");
    const classification = readString(md, "classification");
    for (let i = 0; i < assetEntries.length; i++) {
      const entry = assetEntries[i];
      const meta = ctx.assetMetadata?.get(entry.assetId);
      const decimals =
        typeof meta?.metadata?.decimals === "number"
          ? meta.metadata.decimals
          : 0;
      const name = meta?.metadata?.name;
      const ticker = meta?.metadata?.ticker;
      const rows: SectionRow[] = [];
      if (name) {
        rows.push({ kind: "text", label: "Name", value: name });
      }
      if (ticker) {
        rows.push({ kind: "text", label: "Ticker", value: ticker });
      }
      if (typeof meta?.metadata?.decimals === "number") {
        rows.push({
          kind: "text",
          label: "Decimals",
          value: String(meta.metadata.decimals),
        });
      }
      if (entry.amount != null) {
        const absAmount = entry.amount < 0n ? -entry.amount : entry.amount;
        rows.push({
          kind: "text",
          label: "Amount",
          value: `${entry.amount < 0n ? "-" : ""}${prettyAssetAmount(
            absAmount,
            decimals,
          )}${ticker ? ` ${ticker}` : ""}`,
        });
      }
      rows.push({
        kind: "copy",
        label: "Asset id",
        value: entry.assetId,
        mono: true,
      });
      if (entry.amount != null) {
        rows.push({
          kind: "text",
          label: "Amount (base units)",
          value: entry.amount.toString(),
        });
      }
      if (meta) {
        rows.push({
          kind: "text",
          label: "Supply",
          value: meta.supply,
        });
        if (meta.controlAssetId) {
          rows.push({
            kind: "copy",
            label: "Control asset id",
            value: meta.controlAssetId,
            mono: true,
          });
        }
      }
      if (i === 0 && anchorAmountSats != null) {
        rows.push({
          kind: "text",
          label: "Network anchor",
          value: `${anchorAmountSats.toLocaleString()} sats`,
        });
      }
      if (i === 0 && classification) {
        rows.push({
          kind: "text",
          label: "Classification",
          value: classification.replace(/_/g, " "),
        });
      }
      const title =
        assetEntries.length > 1
          ? `Asset ${i + 1} of ${assetEntries.length} — ${
              ticker ?? truncatedAssetId(entry.assetId)
            }`
          : ticker
            ? `Asset — ${ticker}`
            : "Asset";
      sections.push({ id: `asset:${entry.assetId}`, title, rows });
    }
  }

  // ---- Technical ----
  const technicalRows: SectionRow[] = [];
  technicalRows.push({
    kind: "copy",
    label: "Activity id",
    value: activity.id,
    mono: true,
  });
  technicalRows.push({
    kind: "text",
    label: "Activity kind",
    value: activity.kind,
  });
  technicalRows.push({
    kind: "text",
    label: "Source",
    value: sourceCopy(activity.source),
  });
  technicalRows.push({
    kind: "text",
    label: "Raw status",
    value: activity.status,
  });
  // Render any metadata key not already covered above so support has a
  // complete view without us having to update the builder for every new key.
  const renderedKeys = new Set([
    "network",
    "feeSats",
    "netDeltaSats",
    "arkTxid",
    "commitmentTxid",
    "boardingTxid",
    "bitcoinTxid",
    "claimTxid",
    "refundTxid",
    "fundingTxid",
    "paymentHash",
    "boardingAddress",
    "arkadeAddress",
    "bitcoinAddress",
    "swapId",
    "swapType",
    "provider",
    "invoice",
    "invoiceAmountSats",
    "arkadeAmountSats",
    "lightningFeeSats",
    "claimFeeSats",
    "refundFeeSats",
    "linkSource",
    "boltzApiUrl",
    "inputCount",
    "outputCount",
    "renewedAmountSats",
    "amountSats",
    "unresolvedAmountSats",
    "settlementReason",
    "reason",
    "automatic",
    "delegated",
    "assetId",
    "assetAmount",
    "anchorAmountSats",
    "classification",
  ]);
  if (md) {
    for (const [key, value] of Object.entries(md)) {
      if (renderedKeys.has(key)) continue;
      if (value == null) continue;
      technicalRows.push({
        kind: "text",
        label: key,
        value: String(value),
      });
    }
  }
  sections.push({
    id: "technical",
    title: "Technical",
    rows: technicalRows,
  });

  return sections;
}

export function resolveExplorerUrl(
  row: SectionRow,
  network: string | null | undefined,
): string | null {
  if (row.kind !== "copy") return null;
  if (!row.explorerKind) return null;
  return explorerUrl(row.explorerKind, row.value, network);
}
