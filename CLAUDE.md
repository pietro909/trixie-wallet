# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Development Commands

```bash
npx expo start          # Start dev server (press i for iOS, a for Android, w for web)
npx expo lint           # Run ESLint (flat config with eslint-config-expo)
npx expo prebuild       # Generate native iOS/Android projects
```

No test framework is currently configured.

## Architecture

**Expo SDK 54 + React Native 0.81 + React 19** cross-platform app (iOS, Android, Web) using file-based routing via Expo Router v6.

### Routing (app/)

File-system routing with typed routes enabled. Root layout (`app/_layout.tsx`) sets up a `Stack` with two routes: a `(tabs)` group (Home + Explore tabs) and a `modal` screen. The tabs group is the anchor/default route.

### Platform-specific files

Uses Expo's file suffix convention for platform overrides:
- `.ios.tsx` — iOS-specific (e.g. `icon-symbol.ios.tsx` uses native SF Symbols)
- `.web.ts` — Web-specific (e.g. `use-color-scheme.web.ts` handles SSR hydration)

### Theming

`ThemedText` and `ThemedView` wrap RN primitives with colors from `constants/theme.ts`, resolved via `useThemeColor` hook. Theme follows system light/dark mode.

### State management

No global state library — local `useState` only. `@react-native-async-storage/async-storage` is installed for persistent storage.

### Key dependencies

- `react-native-reanimated` — animations (CSS-like animation API)
- `react-native-gesture-handler` — gesture recognition
- `expo-image` — optimized image component (use instead of RN `<Image>`)
- `expo-haptics` — haptic feedback on tab presses (iOS)

## Conventions

- **Files**: kebab-case (`themed-text.tsx`, `use-color-scheme.ts`)
- **Components**: PascalCase named exports (not default exports)
- **Hooks**: `use-` prefix in filename and export
- **Path alias**: `@/*` maps to project root (e.g. `@/components/...`)
- **Styles**: `StyleSheet.create` — no CSS-in-JS libraries
- **React Compiler** is enabled — skip manual `useMemo`/`useCallback` memoization
