#!/usr/bin/env node
// Standalone decrypt CLI for `.trixiebackup` files.
//
// Uses only the Node built-in `crypto` module so it stays runnable even if
// the wallet codebase rots. See docs/BACKUP_FORMAT.md for the on-disk
// specification.
//
// Usage:
//   node scripts/decrypt-backup.mjs <path-to-backup> <password>
//
// The decrypted JSON payload is printed to stdout. Errors go to stderr and
// the script exits with a non-zero status code.

import { createDecipheriv, pbkdf2Sync } from "node:crypto";
import { readFileSync } from "node:fs";

function fail(message) {
  process.stderr.write(`error: ${message}\n`);
  process.exit(1);
}

function main() {
  const [, , filePath, password] = process.argv;
  if (!filePath || password == null) {
    fail("usage: node scripts/decrypt-backup.mjs <path-to-backup> <password>");
  }

  let raw;
  try {
    raw = readFileSync(filePath, "utf8");
  } catch (e) {
    fail(`could not read ${filePath}: ${e.message}`);
  }

  let envelope;
  try {
    envelope = JSON.parse(raw);
  } catch (e) {
    fail(`backup file is not valid JSON: ${e.message}`);
  }

  if (envelope.magic !== "trixie.backup") {
    fail("not a Trixie backup (magic mismatch)");
  }
  if (envelope.version !== 1) {
    fail(`unsupported envelope version ${envelope.version}`);
  }
  if (envelope.kdf?.name !== "PBKDF2-SHA256") {
    fail(`unsupported KDF: ${envelope.kdf?.name}`);
  }
  if (envelope.cipher?.name !== "AES-256-GCM") {
    fail(`unsupported cipher: ${envelope.cipher?.name}`);
  }

  const salt = Buffer.from(envelope.kdf.salt, "base64");
  const iv = Buffer.from(envelope.cipher.iv, "base64");
  const sealed = Buffer.from(envelope.cipher.ciphertext, "base64");
  if (salt.length !== 16) fail("salt is not 16 bytes");
  if (iv.length !== 12) fail("iv is not 12 bytes");
  if (sealed.length < 16) fail("ciphertext is shorter than the auth tag");

  const key = pbkdf2Sync(password, salt, envelope.kdf.iterations, 32, "sha256");
  const tag = sealed.subarray(sealed.length - 16);
  const ciphertext = sealed.subarray(0, sealed.length - 16);

  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  let plaintext;
  try {
    plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    fail("decryption failed (wrong password or corrupted file)");
  }

  let payload;
  try {
    payload = JSON.parse(plaintext.toString("utf8"));
  } catch (e) {
    fail(`decrypted plaintext is not valid JSON: ${e.message}`);
  }

  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

main();
