import type { BoltzSwap } from "@arkade-os/boltz-swap";
import type {
  AppState,
  ArkadeWalletMetadata,
  WalletBehavior,
} from "../../store/types";
import type { StoredSecret } from "../arkade/secret-store";
import type { LocalSwapMetadata } from "../arkade/swap-storage";
import { recordError } from "../diagnostics/recorder";

export const PAYLOAD_VERSION = 2 as const;

const SUPPORTED_VERSIONS = new Set<number>([1, 2]);

/** Hard cap on imported asset ids carried in the backup envelope. */
const MAX_IMPORTED_ASSET_IDS = 200;

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
  preferences: AppState["preferences"];
  secret: StoredSecret;
  swapMetadata: LocalSwapMetadata[];
  boltzSwaps: BoltzSwap[];
};

export type BackupPayloadV2 = Omit<BackupPayloadV1, "version"> & {
  version: 2;
  importedAssetIds: string[];
};

export type BackupPayload = BackupPayloadV2;

export type BuildPayloadInput = {
  wallet: ArkadeWalletMetadata;
  walletBehavior: WalletBehavior;
  preferences: AppState["preferences"];
  secret: StoredSecret;
  swapMetadata: LocalSwapMetadata[];
  boltzSwaps: BoltzSwap[];
  importedAssetIds: string[];
};

export function buildBackupPayload(input: BuildPayloadInput): BackupPayload {
  return {
    version: PAYLOAD_VERSION,
    createdAt: Date.now(),
    wallet: {
      id: input.wallet.id,
      label: input.wallet.label,
      identityKind: input.wallet.identityKind,
      arkServerUrl: input.wallet.arkServerUrl,
      esploraUrl: input.wallet.esploraUrl ?? null,
      network: input.wallet.network,
    },
    walletBehavior: input.walletBehavior,
    preferences: input.preferences,
    secret: input.secret,
    swapMetadata: input.swapMetadata,
    boltzSwaps: input.boltzSwaps,
    importedAssetIds: input.importedAssetIds,
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
  if (typeof r.version !== "number") {
    throw new PayloadParseError(
      "malformed_payload",
      "Backup payload is missing version",
    );
  }
  if (!SUPPORTED_VERSIONS.has(r.version)) {
    throw new PayloadParseError(
      "unsupported_version",
      `Unsupported backup payload version ${r.version}`,
    );
  }
  if (typeof r.createdAt !== "number") {
    throw new PayloadParseError(
      "malformed_payload",
      "Backup payload is missing createdAt",
    );
  }
  const wallet = parseWallet(r.wallet);
  const walletBehavior = parseWalletBehavior(r.walletBehavior);
  const preferences = parsePreferences(r.preferences);
  const secret = parseSecret(r.secret);
  const swapMetadata = parseSwapMetadata(r.swapMetadata);
  const boltzSwaps = parseBoltzSwaps(r.boltzSwaps);
  const importedAssetIds =
    r.version === 1 ? [] : parseImportedAssetIds(r.importedAssetIds);
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
  };
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

function parseWallet(raw: unknown): BackupPayload["wallet"] {
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
  return {
    id: w.id,
    label: w.label,
    identityKind: w.identityKind,
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

function parsePreferences(raw: unknown): AppState["preferences"] {
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
  if (r.createdForFlow !== "send" && r.createdForFlow !== "receive") {
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
