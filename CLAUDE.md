# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Development Commands

```bash
npx expo start          # Start dev server (press i for iOS, a for Android, w for web)
npx expo lint           # Run ESLint (flat config with eslint-config-expo)
```

No test framework is currently configured.

## Architecture

**Expo SDK 54 + React Native 0.81 + React 19** cross-platform app (iOS, Android, Web) using file-based routing via Expo Router v6.

### Routing (app/)

Uses Expo Router `_layout.tsx` to wrap the application in a `ThemeProvider`. The main navigation is handled by `RootTabs` (`app/navigation/RootTabs.tsx`), which implements a Bottom Tab Navigator using `@react-navigation/bottom-tabs`. Screens are located in `app/screens/`.

### Platform-specific files

Expo's file suffix convention is available for platform overrides (`.ios.tsx`, `.web.ts`). Reference examples are in `app-example/`; the main `app/` directory does not currently use platform-specific files.

### Theming

Custom theme implementation in `app/theme/theme.tsx`.
- Uses `useAppTheme()` hook to access colors (`theme.colors`), typography, and spacing.
- Theme supports light/dark modes based on system preference.
- Navigation theme is synced via `toNavigationTheme`.

### State management

No global state library — local `useState` only. `@react-native-async-storage/async-storage` is installed for persistent storage.

### Key dependencies

- `react-native-reanimated` — animations (CSS-like animation API)
- `react-native-gesture-handler` — gesture recognition
- `expo-image` — optimized image component (use instead of RN `<Image>`)
- `expo-haptics` — haptic feedback on tab presses (iOS)
- `lucide-react-native` — icons
- `expo-blur` — blur effects (used in Tab Bar)

## Conventions

- **Files**: PascalCase for components/screens (`WalletScreen.tsx`), kebab-case/camelCase for utilities (`theme.tsx`)
- **Components**: PascalCase. Named exports preferred for UI components; Default exports for Screens/Routes.
- **Hooks**: `use-` prefix in filename and export
- **Path alias**: `@/*` maps to project root (e.g. `@/components/...`)
