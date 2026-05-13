# FOUNDATION.md

Shared project guidance for AI coding agents working in this repository. Agent-specific entrypoints should import this file instead of duplicating project facts.

## Build & Development Commands

```bash
pnpm install            # Install dependencies (uses .npmrc with node-linker=hoisted)
pnpm start              # Start Metro dev server (then press i / a)
pnpm android            # Start dev server and open Android
pnpm ios                # Start dev server and open iOS
pnpm lint               # Run Biome (lint only)
pnpm lint:fix           # Apply safe Biome fixes (use --unsafe via biome CLI for the rest)
pnpm format             # Format with Biome
pnpm check              # Biome lint + formatter check
pnpm test               # Run Jest test suite
pnpm test:watch         # Re-run Jest on change
pnpm test:coverage      # Jest with coverage (scoped — see docs/TESTING.md)
```

Tests live under `app/services/arkade/__tests__/` (Jest via `jest-expo`). Service-level coverage only — no UI tests. See [docs/TESTING.md](./docs/TESTING.md) for layout, patterns, and coverage policy.

**Tooling:** pnpm 10.x with `node-linker=hoisted` in `.npmrc` (required for Metro to resolve npm-style aliases like `@babel/traverse--for-generate-function-map`), Biome 2.x for linting, TypeScript 6.x.

## Architecture

**Expo SDK 55 + React Native 0.83 + React 19.2** native app, **iOS and Android only** (no web target).

### Entry point

The active entry is `index.ts` → `App.tsx`, which mounts:

```
<SafeAreaProvider>
  <ToastProvider>
    <NavigationContainer>
      <AppStartupGate>
        <RootStack />
```

> **Known oddity:** `app/_layout.tsx` exists from the Expo Router scaffolding but is unreachable — `package.json` `main` points at `./index.ts`, not Expo Router's auto-entry. Tracked in [ISSUES.md](./ISSUES.md).

### Navigation

- `app/navigation/RootStack.tsx` — `@react-navigation/native-stack` navigator. Routes based on wallet state:
  - No wallet → `Landing`, `IntroCarousel`, `RestoreWallet`
  - Locked → `Unlock`
  - Unlocked → `Main` (RootTabs) + `Transactions`, `ProfilePreferences`, `ProfileBackup`, `ProfileLock`, `ProfileReset`
- `app/navigation/RootTabs.tsx` — Bottom tab navigator (Networks, **Wallet** [default], Profile) using `@react-navigation/bottom-tabs`.
- **Custom Android header:** native-stack ignores `headerStatusBarHeight` on Android with `edgeToEdgeEnabled: true`. `RootStack.tsx` defines a `StackHeader` component (Lucide `ChevronLeft` + title, padded by `useSafeAreaInsets().top + spacing[3]`) used **only on Android** via `Platform.OS` check. iOS keeps the native header.
- Screens are in `app/screens/`.

### State Management

**Zustand** store in `app/store/useAppStore.ts` with manual AsyncStorage persistence (key: `app_state_v1`).
- Types in `app/store/types.ts` (`AppState`, `Wallet`, `Transaction`, etc.)
- Mock data helpers in `app/store/mock.ts`
- Actions: `hydrate()`, `createWallet()`, `lockWallet()`, `unlockWithPassword()`, `unlockWithBiometrics()`, `resetWallet()`, `setTheme()`, `setFiatCurrency()`, `setPassword()`, `toggleBiometrics()`

### Theming

Custom theme in `app/theme/theme.tsx`. Brand color: `#ff007f`.
- `useAppTheme()` — system-based theme (light/dark).
- `useResolvedTheme()` (`app/hooks/useResolvedTheme.ts`) — respects user preference from store. **Use this in screens.**
- `toNavigationTheme()` — converts to React Navigation theme.
- Typography uses Inter font (`@expo-google-fonts/inter`), loaded in `AppStartupGate`.
- Exports: `spacing`, `radius`, `typography`, `motion`, `shadow()`, `TabIcon`, `AnimatedTabBarButton`, `makeBottomTabsOptions`.

### Shared Components (`app/components/`)

- `Button.tsx` — Primary/secondary/danger/ghost variants, loading state, press animation + haptics.
- `LoadingOverlay.tsx` — Full-screen overlay with spinner + message.
- `ToastProvider.tsx` — Context-based toast system (`useToast()` → `showToast(msg, type)`).
- `WipModal.tsx` — "Work in Progress" modal for unimplemented features.
- `Skeleton.tsx` — Animated pulse placeholder.
- `AppStartupGate.tsx` — Hydrates store, loads fonts, shows branded loader.

### Platform-specific files

Expo's file suffix convention is available for platform overrides (`.ios.tsx`, `.android.tsx`). The main `app/` directory does not currently use platform-specific files; platform branching is handled in-file via `Platform.OS` (see `RootStack.tsx`).

### Key dependencies

- `zustand` — state management
- `@react-native-async-storage/async-storage` (v2.x — Expo SDK 55 expects 2.2.0; do **not** bump to v3 until SDK catches up)
- `@expo-google-fonts/inter` — typography
- `react-native-reanimated` — animations
- `react-native-gesture-handler` — gesture recognition
- `react-native-safe-area-context` — safe-area insets (used by `StackHeader` and `RootTabs`)
- `expo-image` — optimized image component (use instead of RN `<Image>`)
- `expo-haptics` — haptic feedback
- `expo-local-authentication` — biometrics
- `expo-blur` — blur effects (used in Tab Bar)
- `lucide-react-native` — icons (only icon library allowed)
- `@react-navigation/native-stack` — stack navigation
- `@react-navigation/bottom-tabs` — tab navigation

## Conventions

- **Files**: PascalCase for components/screens (`WalletScreen.tsx`), camelCase for utilities and hooks (`useAppStore.ts`, `mock.ts`)
- **Components**: PascalCase. Named exports for UI components; default exports for Screens/Routes.
- **Hooks**: `use` prefix (`useLoading.ts`, `useResolvedTheme.ts`)
- **Icons**: Only `lucide-react-native` — never use other icon libraries.
- **Path alias**: `@/*` maps to project root (e.g. `@/app/theme/theme`)
- **Package manager**: pnpm only. `package-lock.json` must not be reintroduced. After SDK upgrades, prefer `rm -rf node_modules && pnpm install` to flush stale nested copies.
- **Lint suppressions**: Biome's `// biome-ignore lint/<rule>: <reason>` must be on the line **immediately preceding** the diagnostic.
