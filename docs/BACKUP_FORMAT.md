# Trixie Backup Format

This document specifies the on-disk format for Trixie wallet backups so that any
language with AES-GCM and PBKDF2 can implement a compatible decoder. The goal
is that a future developer with the password and a pair of standard crypto
libraries can extract the original wallet payload without running the app.

The format is implemented in `app/services/backup/crypto.ts` (encrypt/decrypt)
and `app/services/backup/serializer.ts` (payload assembly). A standalone Node
CLI (`scripts/decrypt-backup.mjs`) decrypts a file using only Node's built-in
`crypto` module — useful both for support and as a reference implementation.

## File on Disk

A `.trixiebackup` file is UTF-8 JSON. The outer object — the *envelope* — is
human-readable; only the `cipher.ciphertext` field is opaque. This means an
inspector can verify magic, version, and creation timestamp without the
password, which is a useful sanity check before prompting the user to type it.

```jsonc
{
  "magic": "trixie.backup",
  "version": 1,
  "createdAt": 1730000000000,
  "appVersion": "1.0.0",
  "kdf": {
    "name": "PBKDF2-SHA256",
    "iterations": 200000,
    "salt": "<base64, 16 bytes>"
  },
  "cipher": {
    "name": "AES-256-GCM",
    "iv": "<base64, 12 bytes>",
    "ciphertext": "<base64, plaintext_length + 16 bytes>"
  }
}
```

Field semantics:

- `magic` — must equal the literal string `trixie.backup`. Anything else is
  not a Trixie backup.
- `version` — envelope version. The current version is `1`. Decoders should
  reject other versions outright; there is no migration in version 1.
- `createdAt` — milliseconds since Unix epoch (UTC).
- `appVersion` — the Trixie app version that produced the file. Diagnostic
  only; not load-bearing.
- `kdf.name` — must be `PBKDF2-SHA256`.
- `kdf.iterations` — PBKDF2 iteration count. The current export uses
  `200_000`, chosen to keep encryption under ~10s on emulators and slow
  phones while staying well above OWASP's threshold for KDFs that rely on a
  user-chosen password and a 16-byte random salt. Decoders must read this
  from the envelope, not assume the value — future exports may raise it once
  PBKDF2 moves to a native module.
- `kdf.salt` — base64 (RFC 4648, with padding) of a random 16-byte salt.
- `cipher.name` — must be `AES-256-GCM`.
- `cipher.iv` — base64 of a random 12-byte IV. AES-GCM with a random 96-bit
  IV is the standard NIST construction.
- `cipher.ciphertext` — base64 of `ENCRYPT(plaintext) || TAG`, where `TAG` is
  the 16-byte GCM authentication tag. **This is the same convention as
  WebCrypto and `@noble/ciphers`** — the tag is appended to the ciphertext,
  not stored separately.

Random values are produced via `expo-crypto.getRandomBytes` on the device,
which is backed by the platform's secure random source (`SecRandomCopyBytes`
on iOS, `SecureRandom` on Android).

### Decryption Algorithm

```text
key            = PBKDF2-HMAC-SHA256(password = utf8(password),
                                    salt     = base64decode(kdf.salt),
                                    c        = kdf.iterations,
                                    dkLen    = 32)
iv             = base64decode(cipher.iv)
sealed         = base64decode(cipher.ciphertext)
plaintext      = AES-256-GCM.Decrypt(key = key,
                                     iv  = iv,
                                     ciphertext = sealed[:-16],
                                     tag        = sealed[-16:])
payload        = JSON.parse(utf8decode(plaintext))
```

If the password is wrong, the AES-GCM authentication check fails and
decryption raises an error. The current Trixie code surfaces all auth-tag
failures as `wrong_password` because we cannot distinguish a wrong password
from a tampered ciphertext at this layer.

## Payload (after decryption)

The decrypted plaintext is a UTF-8 JSON document with its own version field,
so the envelope (crypto shape) and the payload (content shape) can evolve
independently.

```jsonc
{
  "version": 1,
  "createdAt": 1730000000000,
  "wallet": {
    "id": "<hex string preserved across restore>",
    "label": "Arkade Seed",
    "identityKind": "mnemonic",
    "arkServerUrl": "https://...",
    "esploraUrl": "https://..." | null,
    "network": "mutinynet"
  },
  "walletBehavior": {
    "vtxoAutoRenewal": true,
    "delegatedRenewal": true
  },
  "preferences": {
    "theme": "system",
    "fiatCurrency": "EUR",
    "bitcoinUnit": "auto"
  },
  "secret": {
    "kind": "mnemonic",
    "mnemonic": "abandon abandon abandon ..."
  },
  "swapMetadata": [
    {
      "swapId": "...",
      "walletId": "...",
      "direction": "in" | "out",
      "createdForFlow": "send" | "receive",
      "invoiceAmountSats": 1000 | null,
      "arkadeAmountSats": 990 | null,
      "walletTxId": "..." | null,
      "paymentHash": "..." | null,
      "linkSource": "send_result" | "receive_claim" | "history_match" | null,
      "restoredAt": 1730000000000 | null,
      "createdAt": 1730000000000,
      "updatedAt": 1730000000000
    }
  ],
  "boltzSwaps": [
    /* Each entry is the BoltzSwap object as persisted by @arkade-os/boltz-swap.
       The shape is BoltzReverseSwap | BoltzSubmarineSwap | BoltzChainSwap;
       see the package's type definitions for the exact fields. */
  ]
}
```

`secret.kind === "singleKey"` carries `privateKeyHex` instead of `mnemonic`:

```jsonc
{ "kind": "singleKey", "privateKeyHex": "<64 hex chars>" }
```

### What the Payload Excludes (and Why)

- **Activities** — recomputed deterministically from the SDK + Boltz repo.
  Persisting them would risk drift on restore.
- **`ark_${walletId}_*` SDK repository tables** — the SDK rebuilds them from
  the Ark server on restore.
- **`security.passwordHash` / `security.biometricsEnabled`** — the lock state
  is per-device. The user re-sets the lock after restore.
- **`network.detectedNetwork` / `network.serverInfo` / `network.status` /
  `network.lastError`** — derived state, recomputed on first probe.
- **`lightningRestore`** — a status snapshot, recomputed on next restore.

The wallet `id` is preserved across restore so the
`trixie_swap_meta.wallet_id` foreign-key column stays intact and the SDK
repository prefix derived from the id remains stable.

## Versioning Policy

When the on-disk shape needs to change:

- **Envelope version bump** — change crypto primitives, KDF parameters that
  are not in the envelope, or the field layout. New decoders implement both
  versions; old decoders refuse the new version with `unsupported_version`.
- **Payload version bump** — change the structure of the decrypted JSON. New
  *importers* implement a migration that reads the old version and produces
  the new shape; old importers refuse with `unsupported_version`.

Both versions live independently. Bumping one does not require bumping the
other.

A migration must be deterministic and pure: same input → same output, no
network access. Add it to `app/services/backup/serializer.ts` next to the
parser for the new version.

## Worked Example (Reference Implementation)

The decrypt routine fits in ~50 lines of standalone Node:

```ts
import { readFileSync } from "node:fs";
import { createDecipheriv, pbkdf2Sync } from "node:crypto";

function decrypt(filePath: string, password: string): unknown {
  const env = JSON.parse(readFileSync(filePath, "utf8"));
  if (env.magic !== "trixie.backup") throw new Error("Not a Trixie backup");
  if (env.version !== 1) throw new Error("Unsupported envelope version");
  if (env.kdf.name !== "PBKDF2-SHA256") throw new Error("Unsupported KDF");
  if (env.cipher.name !== "AES-256-GCM") throw new Error("Unsupported cipher");

  const salt = Buffer.from(env.kdf.salt, "base64");
  const iv = Buffer.from(env.cipher.iv, "base64");
  const sealed = Buffer.from(env.cipher.ciphertext, "base64");
  const key = pbkdf2Sync(password, salt, env.kdf.iterations, 32, "sha256");

  const tag = sealed.subarray(sealed.length - 16);
  const ciphertext = sealed.subarray(0, sealed.length - 16);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return JSON.parse(plaintext.toString("utf8"));
}
```

The packaged version of this snippet lives at `scripts/decrypt-backup.mjs` and
is invoked as `node scripts/decrypt-backup.mjs <file> <password>`. It uses
exactly the primitives above and prints the decrypted payload as pretty JSON.

## Test Vectors

Run `node scripts/decrypt-backup.mjs <bundle> <password>` against an exported
file in the app and confirm that:

- The envelope's `version` is `1`.
- `kdf.iterations` is `200000`.
- `kdf.salt` decodes to 16 bytes.
- `cipher.iv` decodes to 12 bytes.
- `cipher.ciphertext` decodes to plaintext-length + 16 bytes.
- The decrypted JSON has `version: 1`, a non-empty `secret`, and a non-empty
  `wallet.id` matching the device's wallet id at export time.

A bit-flip anywhere in `cipher.ciphertext` causes decryption to fail with
`wrong_password` (the GCM auth tag verifies the entire ciphertext).
