import { gcm } from "@noble/ciphers/aes.js";
import { utf8ToBytes } from "@noble/ciphers/utils.js";
import { pbkdf2Async } from "@noble/hashes/pbkdf2.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { base64 } from "@scure/base";
import * as ExpoCrypto from "expo-crypto";

const MAGIC = "trixie.backup" as const;
const ENVELOPE_VERSION = 1 as const;
const KDF_NAME = "PBKDF2-SHA256" as const;
const CIPHER_NAME = "AES-256-GCM" as const;
// PBKDF2 in pure JS (no native acceleration via @noble) costs roughly 10–20k
// iters/sec on a typical phone, so 600k iterations would freeze the export
// for a minute or more. 200k matches Apple Keychain's default and stays well
// inside the OWASP-acceptable range when paired with a user-chosen password
// and a 16-byte random salt. Decoders read the value from the envelope, so
// later increases are forward-compatible.
const PBKDF2_ITERATIONS = 200_000;
const KEY_LENGTH_BYTES = 32;
const SALT_LENGTH_BYTES = 16;
const IV_LENGTH_BYTES = 12;

export type EncryptedEnvelope = {
  magic: typeof MAGIC;
  version: typeof ENVELOPE_VERSION;
  createdAt: number;
  appVersion: string;
  kdf: {
    name: typeof KDF_NAME;
    iterations: number;
    salt: string;
  };
  cipher: {
    name: typeof CIPHER_NAME;
    iv: string;
    ciphertext: string;
  };
};

export type BackupErrorKind =
  | "wrong_password"
  | "corrupted_envelope"
  | "unsupported_version"
  | "unsupported_algorithm"
  | "encrypt_failed";

export class BackupError extends Error {
  readonly kind: BackupErrorKind;
  readonly cause?: unknown;
  constructor(kind: BackupErrorKind, message: string, cause?: unknown) {
    super(message);
    this.name = "BackupError";
    this.kind = kind;
    this.cause = cause;
  }
}

export type EncryptBundleInput = {
  plaintext: Uint8Array;
  password: string;
  appVersion: string;
};

export async function encryptBundle(
  input: EncryptBundleInput,
): Promise<EncryptedEnvelope> {
  if (input.password.length === 0) {
    throw new BackupError("encrypt_failed", "Backup password is required");
  }
  try {
    const salt = ExpoCrypto.getRandomBytes(SALT_LENGTH_BYTES);
    const iv = ExpoCrypto.getRandomBytes(IV_LENGTH_BYTES);
    const key = await deriveKey(input.password, salt, PBKDF2_ITERATIONS);
    const ciphertext = gcm(key, iv).encrypt(input.plaintext);
    return {
      magic: MAGIC,
      version: ENVELOPE_VERSION,
      createdAt: Date.now(),
      appVersion: input.appVersion,
      kdf: {
        name: KDF_NAME,
        iterations: PBKDF2_ITERATIONS,
        salt: base64.encode(salt),
      },
      cipher: {
        name: CIPHER_NAME,
        iv: base64.encode(iv),
        ciphertext: base64.encode(ciphertext),
      },
    };
  } catch (e) {
    if (e instanceof BackupError) throw e;
    throw new BackupError("encrypt_failed", "Failed to encrypt backup", e);
  }
}

export async function decryptBundle(
  envelope: EncryptedEnvelope,
  password: string,
): Promise<Uint8Array> {
  validateEnvelopeShape(envelope);
  let salt: Uint8Array;
  let iv: Uint8Array;
  let ciphertext: Uint8Array;
  try {
    salt = base64.decode(envelope.kdf.salt);
    iv = base64.decode(envelope.cipher.iv);
    ciphertext = base64.decode(envelope.cipher.ciphertext);
  } catch (e) {
    throw new BackupError(
      "corrupted_envelope",
      "Backup file has invalid base64 fields",
      e,
    );
  }
  if (
    salt.length !== SALT_LENGTH_BYTES ||
    iv.length !== IV_LENGTH_BYTES ||
    ciphertext.length < 16
  ) {
    throw new BackupError(
      "corrupted_envelope",
      "Backup file has malformed crypto parameters",
    );
  }
  const key = await deriveKey(password, salt, envelope.kdf.iterations);
  try {
    return gcm(key, iv).decrypt(ciphertext);
  } catch (e) {
    // AES-GCM tag failures are surfaced by noble as a generic Error. The most
    // likely cause is a wrong password; the alternative (a tampered/truncated
    // ciphertext) is also covered by the same error surface — we accept the
    // ambiguity because we cannot tell them apart from the auth tag alone.
    throw new BackupError("wrong_password", "Incorrect password", e);
  }
}

export function isEncryptedEnvelope(
  value: unknown,
): value is EncryptedEnvelope {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (v.magic !== MAGIC) return false;
  if (typeof v.version !== "number") return false;
  if (typeof v.createdAt !== "number") return false;
  if (typeof v.appVersion !== "string") return false;
  const kdf = v.kdf as Record<string, unknown> | undefined;
  if (
    !kdf ||
    typeof kdf.name !== "string" ||
    typeof kdf.iterations !== "number" ||
    typeof kdf.salt !== "string"
  ) {
    return false;
  }
  const cipher = v.cipher as Record<string, unknown> | undefined;
  if (
    !cipher ||
    typeof cipher.name !== "string" ||
    typeof cipher.iv !== "string" ||
    typeof cipher.ciphertext !== "string"
  ) {
    return false;
  }
  return true;
}

function validateEnvelopeShape(envelope: EncryptedEnvelope): void {
  if (envelope.magic !== MAGIC) {
    throw new BackupError("corrupted_envelope", "File is not a Trixie backup");
  }
  if (envelope.version !== ENVELOPE_VERSION) {
    throw new BackupError(
      "unsupported_version",
      `Unsupported backup version ${envelope.version}`,
    );
  }
  if (envelope.kdf.name !== KDF_NAME) {
    throw new BackupError(
      "unsupported_algorithm",
      `Unsupported KDF ${envelope.kdf.name}`,
    );
  }
  if (envelope.cipher.name !== CIPHER_NAME) {
    throw new BackupError(
      "unsupported_algorithm",
      `Unsupported cipher ${envelope.cipher.name}`,
    );
  }
  if (
    !Number.isInteger(envelope.kdf.iterations) ||
    envelope.kdf.iterations < 1
  ) {
    throw new BackupError(
      "corrupted_envelope",
      "Backup KDF iteration count is invalid",
    );
  }
}

async function deriveKey(
  password: string,
  salt: Uint8Array,
  iterations: number,
): Promise<Uint8Array> {
  return pbkdf2Async(sha256, utf8ToBytes(password), salt, {
    c: iterations,
    dkLen: KEY_LENGTH_BYTES,
  });
}

export const BACKUP_CRYPTO_CONSTANTS = {
  MAGIC,
  ENVELOPE_VERSION,
  KDF_NAME,
  CIPHER_NAME,
  PBKDF2_ITERATIONS,
  KEY_LENGTH_BYTES,
  SALT_LENGTH_BYTES,
  IV_LENGTH_BYTES,
} as const;
