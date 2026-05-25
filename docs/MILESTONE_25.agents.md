# Milestone 25: Brand Identity

**Status:** Delivered (2026-05-25, commit `30ac8e4`). Branded assets installed under `assets/images/`, native Android project regenerated via `npx expo prebuild --clean`, JS animated splash (`app/components/AnimatedSplash.tsx` + `Sparkle.tsx`) wired into `AppStartupGate`. iOS prebuild deferred — see Issue 4 in [ISSUES.md](../ISSUES.md).

## Goal

Replace the placeholder assets shipped with the Expo scaffold with production-quality branded images for the app icon and splash screen.

## Assets Required

All files go under `assets/images/`. All PNG unless noted.

### Icons — iOS

#### `icon.png` — primary iOS app icon
- 1024×1024 px, PNG, no transparency, no rounded corners (iOS applies the mask)
- Solid #ff007f background, white sparkle centered

#### `icon-dark.png` — iOS 18 dark mode variant (optional but recommended)
- 1024×1024 px, PNG, no transparency
- Darker backdrop (e.g. #1a0010 or pure black) with the brand-pink sparkle, OR keep brand pink slightly muted

#### `icon-tinted.png` — iOS 18 tinted mode variant (optional)
- 1024×1024 px, PNG, no transparency
- Grayscale: dark gray background, white sparkle. iOS applies the user-chosen tint.

### Icons — Android adaptive

#### `android-icon-foreground.png`
- 1024×1024 px, PNG, transparent background
- Sparkle centered inside the 672×672 safe zone. Make the sparkle slightly smaller than on iOS — the system zooms adaptive icons ~15%.

#### `android-icon-background.png` (skip if using solid color)
- 1024×1024 px, PNG. Solid #ff007f.
- **Recommendation:** drop this file and set `backgroundColor: "#ff007f"` in the adaptive icon config instead. One less asset to maintain.

#### `android-icon-monochrome.png` — Android 13+ themed icons
- 1024×1024 px, PNG, white-on-transparent
- Simplified mark: large main sparkle only, no companion (it'll smudge at small sizes)

### Notification icon

#### `notification-icon.png`
- 96×96 px minimum (ship 256×256 for safety), PNG, white-on-transparent
- Just the main sparkle, simplified, thicker strokes. Tinted #ff007f at runtime by `expo-notifications`.

### Splash screen

#### `splash-icon.png` — static fallback / first frame
- 1024×1024 px, PNG, transparent background
- The sparkle at its final state. Used by `expo-splash-screen` for the native splash before JS loads.

#### Animated splash — handled in JS (see `components/AnimatedSplash.tsx`)
- The native splash (`splash-icon.png` on #ff007f) shows during cold start
- Once JS is ready, an in-app animated component takes over and runs the entrance, then hides the native splash via `SplashScreen.hideAsync()`

### Web (only for landing page, we DO NOT support web)

#### `favicon.png` — 48×48 px PNG, brand-pink background, white sparkle
