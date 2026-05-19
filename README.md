# Trixie Wallet

**Status: alpha.** Persisted state and on-disk formats are not stable. Every iteration is treated as a clean slate — there are no migrations, no backward-compatibility shims, and no commitment to preserving existing wallets across versions. Reinstall or reset between builds. Compatibility rules will be defined when the project reaches beta.

Self-custodial Arkade wallet for iOS and Android, built with Expo. See [ROADMAP.md](./ROADMAP.md) for milestone tracking, [SPECS.md](./SPECS.md) for the original spec, [CLAUDE.md](./CLAUDE.md) for architecture and conventions, and [ISSUES.md](./ISSUES.md) for open items.

## Stack

Expo SDK 55 · React Native 0.83 · React 19.2 · TypeScript 6 · pnpm 10 · Biome 2.

iOS and Android only — no web target.

## Run

```bash
pnpm install
pnpm android        # Android emulator / device
pnpm ios            # iOS simulator / device
pnpm start          # Dev server only (then press i / a)
```

## Lint & format

```bash
pnpm lint           # Biome lint
pnpm lint:fix       # Apply safe lint fixes
pnpm format         # Format files
pnpm check          # Lint + formatter check
```

## Notes

- Package manager is **pnpm**. The repo uses `node-linker=hoisted` in `.npmrc` for Metro / Babel-alias compatibility.
- After Expo SDK bumps, `rm -rf node_modules && pnpm install` is recommended to flush stale nested copies.
- `app-example/` is the leftover `create-expo-app` template, kept around as reference. It is gitignored and excluded from `tsconfig.json`.
