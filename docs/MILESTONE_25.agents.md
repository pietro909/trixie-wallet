# Milestone 25: Brand Identity

**Status:** Open.

## Goal

Replace the placeholder assets shipped with the Expo scaffold with production-quality branded images for the app icon and splash screen.

## Assets Required

All files go under `assets/images/`. All formats are PNG.

### `icon.png` — Universal app icon
- **Size:** 1024×1024 px
- **Format:** PNG, no transparency (Apple rejects transparent icons)
- Used by Expo as the iOS icon and the universal fallback.

### `android-icon-foreground.png` — Android adaptive icon foreground layer
- **Size:** 1024×1024 px
- **Format:** PNG with transparent background
- Logo/mark centered within the inner ~66% (672×672 px) safe zone. The system crops and masks this layer differently per launcher, so the mark must stay inside the safe area.

### `android-icon-background.png` — Android adaptive icon background layer
- **Size:** 1024×1024 px
- **Format:** PNG
- Solid color or subtle pattern behind the foreground. The config currently has `backgroundColor: "#E6F4FE"` as a fallback; replace with the brand color or a branded image.

### `android-icon-monochrome.png` — Android monochrome icon
- **Size:** 1024×1024 px
- **Format:** PNG — white silhouette on transparent background
- Used for Android notification icons and Android 13 themed/monochrome icons. Also the notification icon in `expo-notifications` config (tinted `#ff007f`).

### `splash-icon.png` — Splash screen logo
- **Size:** 1024×1024 px recommended (rendered at `imageWidth: 200` with `resizeMode: contain`)
- **Format:** PNG with transparent background
- Displayed centered on the splash screen. Background color is `#ffffff` (light) / `#000000` (dark) per the `expo-splash-screen` plugin config.

## Out of Scope

- Any code changes — all config wiring is already in place in `app.json`.
- Animated splash screens.
- Tablet-specific icon variants.
