import type { BoltzSwap } from "@arkade-os/boltz-swap";
import type {
  AppState,
  ArkadeWalletMetadata,
  WalletBehavior,
} from "../../store/types";
import type { ContractLabelBackup } from "../arkade/contracts";
import type { StoredSecret } from "../arkade/secret-store";
import {
  isLocalSwapFlow,
  type LocalSwapMetadata,
} from "../arkade/swap-storage";
import { recordError } from "../diagnostics/recorder";

export const PAYLOAD_VERSION = 4 as const;

const SUPPORTED_VERSIONS = new Set<number>([1, 2, 3, 4]);

/** Hard cap on imported asset ids carried in the backup envelope. */
const MAX_IMPORTED_ASSET_IDS = 200;

/**
 * Subset of `AppState["preferences"]` carried by the backup envelope.
 * `notifications` is intentionally excluded — it is a device-local
 * preference, parallel to `backgroundTasks`, and must not flow across
 * restores onto a new device.
 */
export type BackupPreferences = Omit<AppState["preferences"], "notifications">;

export type BackupPayloadV1 = {
  version: 1;
  createdAt: number;
  wallet: {
    id: string;
    label: string;
    identityKind: ArkadeWalletMetadata["identityKind"];
    arkServerUrl: string;
    esploraUrl: string | null;
    network: string;
  };
  walletBehavior: WalletBehavior;
  preferences: BackupPreferences;
  secret: StoredSecret;
  swapMetadata: LocalSwapMetadata[];
  boltzSwaps: BoltzSwap[];
};

export type BackupPayloadV2 = Omit<BackupPayloadV1, "version"> & {
  version: 2;
  importedAssetIds: string[];
};

export type BackupPayloadV3 = Omit<BackupPayloadV2, "version"> & {
  version: 3;
  contractLabels: ContractLabelBackup[];
};

export type BackupPayloadV4 = Omit<BackupPayloadV3, "version"> & {
  version: 4;
  wallet: BackupPayloadV3["wallet"] & {
    walletMode: "static" | "hd";
  };
};

export type BackupPayload = BackupPayloadV4;

export type BuildPayloadInput = {
  wallet: ArkadeWalletMetadata;
  walletBehavior: WalletBehavior;
  preferences: AppState["preferences"];
  secret: StoredSecret;
  swapMetadata: LocalSwapMetadata[];
  boltzSwaps: BoltzSwap[];
  importedAssetIds: string[];
  contractLabels: ContractLabelBackup[];
};

export function buildBackupPayload(input: BuildPayloadInput): BackupPayload {
  const { notifications: _notifications, ...portablePrefs } = input.preferences;
  return {
    version: PAYLOAD_VERSION,
    createdAt: Date.now(),
    wallet: {
      id: input.wallet.id,
      label: input.wallet.label,
      identityKind: input.wallet.identityKind,
      walletMode: input.wallet.walletMode,
      arkServerUrl: input.wallet.arkServerUrl,
      esploraUrl: input.wallet.esploraUrl ?? null,
      network: input.wallet.network,
    },
    walletBehavior: input.walletBehavior,
    preferences: portablePrefs,
    secret: input.secret,
    swapMetadata: input.swapMetadata,
    boltzSwaps: input.boltzSwaps,
    importedAssetIds: input.importedAssetIds,
    contractLabels: input.contractLabels,
  };
}

export type PayloadParseErrorKind = "malformed_payload" | "unsupported_version";

export class PayloadParseError extends Error {
  readonly kind: PayloadParseErrorKind;
  constructor(kind: PayloadParseErrorKind, message: string) {
    super(message);
    this.name = "PayloadParseError";
    this.kind = kind;
    recordError("backup", `${kind}: ${message}`);
  }
}

export function parseBackupPayload(raw: unknown): BackupPayload {
  if (typeof raw !== "object" || raw === null) {
    throw new PayloadParseError(
      "malformed_payload",
      "Backup payload is not an object",
    );
  }
  const r = raw as Record<string, unknown>;
  const version = typeof r.version === "number" ? r.version : 0;
  if (!SUPPORTED_VERSIONS.has(version)) {
    throw new PayloadParseError(
      "unsupported_version",
      `Unsupported backup payload version ${version}`,
    );
  }
  if (typeof r.createdAt !== "number") {
    throw new PayloadParseError(
      "malformed_payload",
      "Backup payload is missing createdAt",
    );
  }
  const wallet = parseWallet(r.wallet, version);
  const walletBehavior = parseWalletBehavior(r.walletBehavior);
  const preferences = parsePreferences(r.preferences);
  const secret = parseSecret(r.secret);

  // Cross-field validation for HD mode (v4+ only)
  if (wallet.walletMode === "hd") {
    if (wallet.identityKind !== "mnemonic" || secret.kind !== "mnemonic") {
      throw new PayloadParseError(
        "malformed_payload",
        "HD mode is only supported for mnemonic identities",
      );
    }
  }

  const swapMetadata = parseSwapMetadata(r.swapMetadata);
  const boltzSwaps = parseBoltzSwaps(r.boltzSwaps);
  const importedAssetIds =
    version === 1 ? [] : parseImportedAssetIds(r.importedAssetIds);
  const contractLabels =
    version < 3 ? [] : parseContractLabels(r.contractLabels);
  return {
    version: PAYLOAD_VERSION,
    createdAt: r.createdAt,
    wallet,
    walletBehavior,
    preferences,
    secret,
    swapMetadata,
    boltzSwaps,
    importedAssetIds,
    contractLabels,
  };
}

function parseContractLabels(raw: unknown): ContractLabelBackup[] {
  if (raw == null) return [];
  if (!Array.isArray(raw)) {
    throw new PayloadParseError(
      "malformed_payload",
      "Backup contractLabels is not an array",
    );
  }
  const out: ContractLabelBackup[] = [];
  const seen = new Map<string, number>();
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) {
      throw new PayloadParseError(
        "malformed_payload",
        "Backup contractLabels entry is not an object",
      );
    }
    const r = entry as Record<string, unknown>;
    const script = typeof r.script === "string" ? r.script : "";
    if (script.length === 0) {
      throw new PayloadParseError(
        "malformed_payload",
        "Backup contractLabels entry has missing or empty script",
      );
    }
    const labelRaw = typeof r.label === "string" ? r.label : "";
    const label = labelRaw.trim();
    if (label.length === 0) {
      throw new PayloadParseError(
        "malformed_payload",
        "Backup contractLabels entry has missing or empty label",
      );
    }
    const existing = seen.get(script);
    if (existing != null) {
      out[existing] = { script, label };
    } else {
      seen.set(script, out.length);
      out.push({ script, label });
    }
  }
  return out;
}

function parseImportedAssetIds(raw: unknown): string[] {
  if (raw == null) return [];
  if (!Array.isArray(raw)) {
    throw new PayloadParseError(
      "malformed_payload",
      "Backup importedAssetIds is not an array",
    );
  }
  const out: string[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    if (typeof entry !== "string") {
      throw new PayloadParseError(
        "malformed_payload",
        "Backup importedAssetIds contains a non-string entry",
      );
    }
    if (seen.has(entry)) continue;
    seen.add(entry);
    out.push(entry);
    if (out.length >= MAX_IMPORTED_ASSET_IDS) break;
  }
  return out;
}

function parseWallet(raw: unknown, version: number): BackupPayload["wallet"] {
  if (typeof raw !== "object" || raw === null) {
    throw new PayloadParseError(
      "malformed_payload",
      "Backup payload is missing wallet section",
    );
  }
  const w = raw as Record<string, unknown>;
  if (typeof w.id !== "string" || w.id.length === 0) {
    throw new PayloadParseError(
      "malformed_payload",
      "Backup wallet.id is missing or invalid",
    );
  }
  if (typeof w.label !== "string") {
    throw new PayloadParseError(
      "malformed_payload",
      "Backup wallet.label is missing",
    );
  }
  if (w.identityKind !== "mnemonic" && w.identityKind !== "singleKey") {
    throw new PayloadParseError(
      "malformed_payload",
      "Backup wallet.identityKind is invalid",
    );
  }
  if (typeof w.arkServerUrl !== "string" || w.arkServerUrl.length === 0) {
    throw new PayloadParseError(
      "malformed_payload",
      "Backup wallet.arkServerUrl is missing",
    );
  }
  if (typeof w.network !== "string" || w.network.length === 0) {
    throw new PayloadParseError(
      "malformed_payload",
      "Backup wallet.network is missing",
    );
  }
  const esploraUrl =
    w.esploraUrl == null
      ? null
      : typeof w.esploraUrl === "string"
        ? w.esploraUrl
        : null;

  const walletMode =
    version < 4
      ? "static"
      : w.walletMode === "hd" || w.walletMode === "static"
        ? w.walletMode
        : null;
  if (!walletMode) {
    throw new PayloadParseError(
      "malformed_payload",
      "Backup wallet.walletMode is missing or invalid",
    );
  }

  return {
    id: w.id,
    label: w.label,
    identityKind: w.identityKind,
    walletMode,
    arkServerUrl: w.arkServerUrl,
    esploraUrl,
    network: w.network,
  };
}

function parseWalletBehavior(raw: unknown): WalletBehavior {
  if (typeof raw !== "object" || raw === null) {
    throw new PayloadParseError(
      "malformed_payload",
      "Backup walletBehavior is missing",
    );
  }
  const b = raw as Record<string, unknown>;
  return {
    vtxoAutoRenewal: b.vtxoAutoRenewal === true,
    delegatedRenewal: b.delegatedRenewal === true,
  };
}

function parsePreferences(raw: unknown): BackupPreferences {
  if (typeof raw !== "object" || raw === null) {
    throw new PayloadParseError(
      "malformed_payload",
      "Backup preferences are missing",
    );
  }
  const p = raw as Record<string, unknown>;
  const theme = p.theme === "light" || p.theme === "dark" ? p.theme : "system";
  const fiat =
    p.fiatCurrency === "USD" || p.fiatCurrency === "GBP"
      ? p.fiatCurrency
      : "EUR";
  const unit =
    p.bitcoinUnit === "sats" || p.bitcoinUnit === "btc"
      ? p.bitcoinUnit
      : "auto";
  return { theme, fiatCurrency: fiat, bitcoinUnit: unit };
}

function parseSecret(raw: unknown): StoredSecret {
  if (typeof raw !== "object" || raw === null) {
    throw new PayloadParseError(
      "malformed_payload",
      "Backup secret is missing",
    );
  }
  const s = raw as Record<string, unknown>;
  if (s.kind === "mnemonic") {
    if (typeof s.mnemonic !== "string" || s.mnemonic.length === 0) {
      throw new PayloadParseError(
        "malformed_payload",
        "Backup secret mnemonic is invalid",
      );
    }
    return { kind: "mnemonic", mnemonic: s.mnemonic };
  }
  if (s.kind === "singleKey") {
    if (typeof s.privateKeyHex !== "string" || s.privateKeyHex.length === 0) {
      throw new PayloadParseError(
        "malformed_payload",
        "Backup secret privateKeyHex is invalid",
      );
    }
    return { kind: "singleKey", privateKeyHex: s.privateKeyHex };
  }
  throw new PayloadParseError(
    "malformed_payload",
    "Backup secret kind is invalid",
  );
}

function parseSwapMetadata(raw: unknown): LocalSwapMetadata[] {
  if (raw == null) return [];
  if (!Array.isArray(raw)) {
    throw new PayloadParseError(
      "malformed_payload",
      "Backup swapMetadata is not an array",
    );
  }
  return raw.map((row, i) => parseSwapMetadataRow(row, i));
}

function parseSwapMetadataRow(raw: unknown, index: number): LocalSwapMetadata {
  if (typeof raw !== "object" || raw === null) {
    throw new PayloadParseError(
      "malformed_payload",
      `Backup swapMetadata[${index}] is not an object`,
    );
  }
  const r = raw as Record<string, unknown>;
  if (typeof r.swapId !== "string" || typeof r.walletId !== "string") {
    throw new PayloadParseError(
      "malformed_payload",
      `Backup swapMetadata[${index}] is missing ids`,
    );
  }
  if (r.direction !== "in" && r.direction !== "out") {
    throw new PayloadParseError(
      "malformed_payload",
      `Backup swapMetadata[${index}] direction is invalid`,
    );
  }
  if (!isLocalSwapFlow(r.createdForFlow)) {
    throw new PayloadParseError(
      "malformed_payload",
      `Backup swapMetadata[${index}] createdForFlow is invalid`,
    );
  }
  return {
    swapId: r.swapId,
    walletId: r.walletId,
    direction: r.direction,
    createdForFlow: r.createdForFlow,
    invoiceAmountSats: numberOrNull(r.invoiceAmountSats),
    arkadeAmountSats: numberOrNull(r.arkadeAmountSats),
    walletTxId: stringOrNull(r.walletTxId),
    paymentHash: stringOrNull(r.paymentHash),
    linkSource: parseLinkSource(r.linkSource),
    backgroundNotified: false,
    restoredAt: numberOrNull(r.restoredAt),
    createdAt: numberOr(r.createdAt, Date.now()),
    updatedAt: numberOr(r.updatedAt, Date.now()),
  };
}

function parseLinkSource(raw: unknown): LocalSwapMetadata["linkSource"] {
  if (
    raw === "send_result" ||
    raw === "receive_claim" ||
    raw === "history_match"
  ) {
    return raw;
  }
  return null;
}

function parseBoltzSwaps(raw: unknown): BoltzSwap[] {
  if (raw == null) return [];
  if (!Array.isArray(raw)) {
    throw new PayloadParseError(
      "malformed_payload",
      "Backup boltzSwaps is not an array",
    );
  }
  return raw.map((row, i) => {
    if (typeof row !== "object" || row === null) {
      throw new PayloadParseError(
        "malformed_payload",
        `Backup boltzSwaps[${i}] is not an object`,
      );
    }
    const r = row as Record<string, unknown>;
    if (typeof r.id !== "string" || typeof r.type !== "string") {
      throw new PayloadParseError(
        "malformed_payload",
        `Backup boltzSwaps[${i}] is missing id/type`,
      );
    }
    return row as BoltzSwap;
  });
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" ? value : fallback;
}
