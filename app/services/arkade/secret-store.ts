import * as SecureStore from "expo-secure-store";
import { ArkadeError, toArkadeError } from "./errors";

const PREFIX = "trixie_wallet_secret_";

function key(walletId: string): string {
  return `${PREFIX}${walletId}`;
}

export type StoredSecret =
  | { kind: "mnemonic"; mnemonic: string }
  | { kind: "singleKey"; privateKeyHex: string };

export async function saveSecret(
  walletId: string,
  secret: StoredSecret,
): Promise<void> {
  try {
    await SecureStore.setItemAsync(key(walletId), JSON.stringify(secret));
  } catch (e) {
    throw toArkadeError(
      "secret_storage_failed",
      "Failed to write wallet secret",
      e,
    );
  }
}

export async function readSecret(walletId: string): Promise<StoredSecret> {
  let raw: string | null;
  try {
    raw = await SecureStore.getItemAsync(key(walletId));
  } catch (e) {
    throw toArkadeError(
      "secret_storage_failed",
      "Failed to read wallet secret",
      e,
    );
  }
  if (!raw) {
    throw new ArkadeError(
      "secret_storage_failed",
      "Wallet secret not found in secure storage",
    );
  }
  try {
    const parsed = JSON.parse(raw) as StoredSecret;
    if (
      parsed.kind === "mnemonic" &&
      typeof parsed.mnemonic === "string" &&
      parsed.mnemonic.length > 0
    ) {
      return parsed;
    }
    if (
      parsed.kind === "singleKey" &&
      typeof parsed.privateKeyHex === "string" &&
      parsed.privateKeyHex.length > 0
    ) {
      return parsed;
    }
    throw new ArkadeError("secret_storage_failed", "Wallet secret is malformed");
  } catch (e) {
    throw toArkadeError(
      "secret_storage_failed",
      "Wallet secret is unreadable",
      e,
    );
  }
}

export async function deleteSecret(walletId: string): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(key(walletId));
  } catch {
    // best-effort delete; missing keys are not an error
  }
}
