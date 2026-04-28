import * as ExpoCrypto from "expo-crypto";

// biome-ignore lint/suspicious/noExplicitAny: cross-environment Crypto shim must bypass DOM lib types
const g = globalThis as any;

if (!g.crypto) {
  g.crypto = {};
}

if (!g.crypto.getRandomValues) {
  g.crypto.getRandomValues = ExpoCrypto.getRandomValues.bind(ExpoCrypto);
}
