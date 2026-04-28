import { MnemonicIdentity, SingleKey } from "@arkade-os/sdk";
import { generateMnemonic, validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { ArkadeError } from "./errors";
import type { StoredSecret } from "./secret-store";

export type WalletIdentityKind = "mnemonic" | "singleKey";

export type IdentityArtifacts = {
  identity: MnemonicIdentity | SingleKey;
  secret: StoredSecret;
  identityKind: WalletIdentityKind;
};

export function createMnemonic(): string {
  return generateMnemonic(wordlist, 128);
}

export function isValidMnemonic(mnemonic: string): boolean {
  return validateMnemonic(mnemonic.trim(), wordlist);
}

export function isValidPrivateKeyHex(value: string): boolean {
  return /^[0-9a-fA-F]{64}$/.test(value.trim());
}

export function buildIdentityFromSecret(
  secret: StoredSecret,
  isMainnet: boolean,
): IdentityArtifacts {
  if (secret.kind === "mnemonic") {
    if (!isValidMnemonic(secret.mnemonic)) {
      throw new ArkadeError("invalid_mnemonic", "Stored mnemonic is invalid");
    }
    return {
      identity: MnemonicIdentity.fromMnemonic(secret.mnemonic.trim(), {
        isMainnet,
      }),
      secret,
      identityKind: "mnemonic",
    };
  }
  if (!isValidPrivateKeyHex(secret.privateKeyHex)) {
    throw new ArkadeError(
      "invalid_private_key",
      "Stored private key is not a valid 64-char hex string",
    );
  }
  return {
    identity: SingleKey.fromHex(secret.privateKeyHex.trim()),
    secret,
    identityKind: "singleKey",
  };
}

export function buildMnemonicIdentity(
  mnemonic: string,
  isMainnet: boolean,
): IdentityArtifacts {
  const trimmed = mnemonic.trim();
  if (!isValidMnemonic(trimmed)) {
    throw new ArkadeError("invalid_mnemonic", "Mnemonic is invalid");
  }
  return {
    identity: MnemonicIdentity.fromMnemonic(trimmed, { isMainnet }),
    secret: { kind: "mnemonic", mnemonic: trimmed },
    identityKind: "mnemonic",
  };
}

export function buildSingleKeyIdentityFromHex(
  privateKeyHex: string,
): IdentityArtifacts {
  const trimmed = privateKeyHex.trim();
  if (!isValidPrivateKeyHex(trimmed)) {
    throw new ArkadeError(
      "invalid_private_key",
      "Private key must be 64 hex characters",
    );
  }
  return {
    identity: SingleKey.fromHex(trimmed),
    secret: { kind: "singleKey", privateKeyHex: trimmed },
    identityKind: "singleKey",
  };
}

export function buildRandomSingleKeyIdentity(): IdentityArtifacts {
  const identity = SingleKey.fromRandomBytes();
  return {
    identity,
    secret: { kind: "singleKey", privateKeyHex: identity.toHex() },
    identityKind: "singleKey",
  };
}

export function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, "0");
  }
  return out;
}
