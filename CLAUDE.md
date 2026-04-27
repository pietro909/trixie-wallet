# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Development Commands

```bash
npx expo start          # Start dev server (press i for iOS, a for Android)
pnpm lint               # Run Biome (lint + format check; configured via biome.json)
pnpm lint:fix           # Apply safe Biome fixes
pnpm format             # Format with Biome
```

No test framework is currently configured.

## Architecture

**Expo SDK 54 + React Native 0.81 + React 19** native app (iOS, Android) using Expo Router v6 for the root layout, with React Navigation for all screen navigation.

### Navigation

- `app/_layout.tsx` — Root layout. Wraps app in `ToastProvider` → `ThemeProvider` → `AppStartupGate` → `RootStack`.
- `app/navigation/RootStack.tsx` — Native stack navigator. Routes based on wallet state:
  - No wallet → `Landing`, `IntroCarousel`, `RestoreWallet`
  - Locked → `Unlock`
  - Unlocked → `Main` (RootTabs) + profile/transaction sub-screens
- `app/navigation/RootTabs.tsx` — Bottom tab navigator (Networks, **Wallet** [default], Profile) using `@react-navigation/bottom-tabs`.
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

Expo's file suffix convention is available for platform overrides (`.ios.tsx`, `.android.tsx`). The main `app/` directory does not currently use platform-specific files.

### Key dependencies

- `zustand` — state management
- `@expo-google-fonts/inter` — typography
- `react-native-reanimated` — animations
- `react-native-gesture-handler` — gesture recognition
- `expo-image` — optimized image component (use instead of RN `<Image>`)
- `expo-haptics` — haptic feedback
- `expo-local-authentication` — biometrics
- `expo-blur` — blur effects (used in Tab Bar)
- `lucide-react-native` — icons (only icon library allowed)
- `@react-navigation/native-stack` — stack navigation
- `@react-navigation/bottom-tabs` — tab navigation

## Conventions

- **Files**: PascalCase for components/screens (`WalletScreen.tsx`), camelCase for utilities and hooks (`useAppStore.ts`, `mock.ts`)
- **Components**: PascalCase. Named exports for UI components; Default exports for Screens/Routes.
- **Hooks**: `use` prefix (`useLoading.ts`, `useResolvedTheme.ts`)
- **Icons**: Only `lucide-react-native` — never use other icon libraries.
- **Path alias**: `@/*` maps to project root (e.g. `@/app/theme/theme`)
