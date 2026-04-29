import { MnemonicIdentity, SingleKey } from "@arkade-os/sdk";
import { bech32 } from "@scure/base";
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

export function nsecToPrivateKeyHex(nsec: string): string {
  try {
    const decoded = bech32.decodeToBytes(nsec.trim());
    if (
      decoded.prefix.toLowerCase() !== "nsec" ||
      decoded.bytes.length !== 32
    ) {
      throw new Error("Invalid nsec private key");
    }
    return bytesToHex(decoded.bytes);
  } catch {
    throw new ArkadeError(
      "invalid_private_key",
      "Private key must be a valid nsec or 64-char hex string",
    );
  }
}

export function privateKeyHexToNsec(privateKeyHex: string): string {
  const trimmed = privateKeyHex.trim();
  if (!isValidPrivateKeyHex(trimmed)) {
    throw new ArkadeError(
      "invalid_private_key",
      "Private key must be 64 hex characters",
    );
  }
  return bech32.encodeFromBytes("nsec", hexToBytes(trimmed));
}

export function isValidNsec(value: string): boolean {
  try {
    nsecToPrivateKeyHex(value);
    return true;
  } catch {
    return false;
  }
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

export function buildSingleKeyIdentityFromNsec(
  nsec: string,
): IdentityArtifacts {
  return buildSingleKeyIdentityFromHex(nsecToPrivateKeyHex(nsec));
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

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}
