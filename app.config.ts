/// <reference types="node" />
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ConfigContext, ExpoConfig } from "expo/config";

function pkgVersion(name: string): string | null {
  try {
    const p = join(__dirname, "node_modules", name, "package.json");
    const json = JSON.parse(readFileSync(p, "utf8"));
    return typeof json.version === "string" ? json.version : null;
  } catch {
    return null;
  }
}

function git(args: string): string | null {
  try {
    const out = execSync(`git ${args}`, {
      cwd: __dirname,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return out || null;
  } catch {
    return null;
  }
}

function compact<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v != null) (out as Record<string, unknown>)[k] = v;
  }
  return out;
}

const sdkVersion = pkgVersion("@arkade-os/sdk");
const boltzVersion = pkgVersion("@arkade-os/boltz-swap");
const commit = git("rev-parse --short HEAD");
const exactTag = git("describe --tags --exact-match HEAD");
const describe = git("describe --tags --always --dirty");

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: config.name ?? "trixie-wallet",
  slug: config.slug ?? "trixie-wallet",
  extra: {
    ...(config.extra ?? {}),
    versions: compact({ sdk: sdkVersion, boltzSwap: boltzVersion }),
    git: compact({ commit, tag: exactTag, describe }),
  },
  ios: {
    bundleIdentifier: "uno.pietro.trixie",
  },
});
