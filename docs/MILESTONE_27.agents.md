# Milestone 27: Localization & Internationalization (i18n)

**Status:** Proposed (2026-05-26).

## Goal

Make the Trixie Wallet accessible to a global audience by removing hardcoded English strings and introducing a robust localization framework. This includes support for multiple languages, locale-aware number/date formatting, and RTL readiness.

## Driver Symptom

Currently, all user-facing strings (labels, buttons, error messages, onboarding stages) are hardcoded in English across screens and services. Number formatting (e.g., sats and fiat) does not respect the user's system locale, leading to potential confusion in regions with different decimal/thousands separators.

## Current State

- **UI Strings:** Hardcoded in `.tsx` files (e.g., `WalletScreen.tsx`, `ProfileScreen.tsx`, `LandingNoWallet.tsx`).
- **Formatting:** `useFormatSats` and `prettyAssetAmount` use hardcoded or simple JavaScript formatting that doesn't fully account for locale.
- **Error Messages:** Often pass `e.message` directly to toasts, which may contain technical English or hardcoded fallback strings.
- **Language Detection:** No i18n engine currently resolves the system locale for translations or formatting.

## Product Rules

- **Zero Hardcoded Strings:** Every user-facing string must reside in a translation file.
- **System Locale Only:** The app uses the device/system locale as the only language source. There is no in-app language selector and no persisted language override.
- **Locale-Aware Formatting:** Currency, numbers, and dates must match the user's system locale.
- **Honest Pluralization:** Use i18n features for plurals (e.g., "1 asset" vs "2 assets") rather than manual string concatenation. Use modern `count` based keys (e.g., `key_one`, `key_other`) as per `i18next` v21+.
- **Fallback to English:** If a translation is missing for the user's locale, the app must gracefully fall back to English.
- **Non-Blocking Detection:** Language detection should happen during the `AppStartupGate` phase and not delay the app's responsiveness.
- **Developer Experience:** The translation key structure should be intuitive (e.g., `screens.wallet.title`) and consistent across the codebase.

## Selected Direction

The implementation is divided into four phases to ensure a stable rollout.

### Phase 1 — Infrastructure & Setup

Introduce the i18n stack and establish conventions.

- **Stack:** `i18next`, `react-i18next`, and `expo-localization`.
- **Detection:** Use `expo-localization` to detect the system language during startup.
- **Storage:** Do not persist a language preference in the Zustand store; language follows the system.
- **Structure:** Create `app/i18n/` directory with `index.ts` (config) and `locales/` (JSON files).
- **Validation:** Add a lint rule or script to check for hardcoded strings in `app/` (future consideration).

### Phase 2 — Static & Parameterized Extraction

Migrate the majority of UI strings to the new system.

- **Screens:** Extract all labels from `WalletScreen`, `ProfileScreen`, `LandingNoWallet`, and others.
- **Navigation:** Localize tab bar labels and stack header titles.
- **Parameters:** Implement interpolation for asset counts, accessibility labels, and dynamic warnings (e.g., "Wrong network...").
- **Menu Items:** Refactor `MENU_ITEMS` constants to use translation keys instead of hardcoded labels.

### Phase 3 — Complex Logic & Formatting

Refactor services that handle dynamic or formatted data.

- **Number Formatting:** Update `app/services/arkade/asset-format.ts` and `app/hooks/useFormatSats.ts` to use `Intl.NumberFormat` with the active locale.
- **Relative Time:** Replace manual time calculation in `WalletScreen.tsx` with a localized relative time formatter (e.g., `i18next` relative time plugin or `Intl.RelativeTimeFormat`).
- **Toast & Errors:** Create a mapping for common error codes to localized messages.

### Phase 4 — Testing & Language Support

Verify the implementation and add a second "proof-of-concept" language.

- **Verification:** Ensure RTL layouts (if applicable) don't break, though the initial focus is on LTR.
- **Italian/Spanish/French:** Add a complete translation file for one other language to verify system-locale selection and pluralization.
- **Unit Tests:** Add tests for the formatting services and i18n configuration.

## Actionable Task List

### Phase 1: Infrastructure & Setup
- [ ] **Dependency Installation:** Run `pnpm add i18next react-i18next` and `pnpm expo install expo-localization`.
- [ ] **Intl Verification:** Verify `Intl.RelativeTimeFormat` and `Intl.PluralRules` support in Hermes; add polyfills if necessary.
- [ ] **Locale Source:** Add a small locale resolver that reads `getLocales()` from `expo-localization`, returns a BCP-47 locale tag (e.g., `en-US`, `it-IT`), and falls back to English when the system locale is unavailable.
- [ ] **Initial Translation File:** Create `app/i18n/locales/en.json` with a nested structure (e.g., `common`, `screens`, `navigation`).
- [ ] **I18n Engine:** Create `app/i18n/index.ts` to initialize `i18next`. Use the system locale from `expo-localization` as `lng`, with English as `fallbackLng`.
- [ ] **Initialization Gate:** Extend `AppStartupGate.tsx` readiness so `i18next.isInitialized` is true before rendering the navigation tree.

### Phase 2: UI Extraction
- [ ] **Navigation Titles:** Replace hardcoded strings in `RootStack.tsx` and `RootTabs.tsx` with dynamic `t('navigation.xxx')` calls based on the resolved system locale.
- [ ] **Common Components:** Ensure shared components receive localized caller-provided labels/messages; keep `Button.tsx`, `ToastProvider.tsx`, and `LoadingOverlay.tsx` presentation-only unless a default string is added.
- [ ] **Onboarding Screens:** Extract strings from `LandingNoWallet.tsx`, `IntroCarousel.tsx`, and `RestoreWallet.tsx`.
- [ ] **Wallet Home:** Extract strings from `WalletScreen.tsx`, including the "Assets" header and empty state messages.
- [ ] **Profile Menu:** Refactor `MENU_ITEMS` in `ProfileScreen.tsx` to store `key` (e.g., `menu.backup`) instead of `label`, and call `t(item.key)` in the render loop.
- [ ] **Accessibility Labels:** Audit all `accessibilityLabel` and `accessibilityHint` props across the `app/` directory and replace them with localized variants.

### Phase 3: Logic & Formatting
- [ ] **Localized Sats:** Refactor `app/hooks/useFormatSats.ts` to use `Intl.NumberFormat` with the active locale from `i18next`.
- [ ] **Asset Formatting:** Update `prettyAssetNumber` in `app/services/arkade/asset-format.ts` to remove the hardcoded English BigInt fallback, or make it locale-aware.
- [ ] **Relative Time:** Replace the custom `formatRelativeTime` in `WalletScreen.tsx` with a utility in `app/services/format.ts` using `Intl.RelativeTimeFormat`.
- [ ] **Enum Mapping:** Update `statusVisuals` (`activity-status.ts`) and `paymentTypeLabel` (`paymentParser.ts`) to return translation keys or perform lookups directly.
- [ ] **Error Handler:** Implement a `localizeError(error: unknown)` helper in `app/services/format.ts` that maps common SDK error messages to user-friendly translation keys.

### Phase 4: Verification & Multi-language Support
- [ ] **Second Locale:** Create `app/i18n/locales/it.json` (Italian) as a proof-of-concept, filling it with translations matching the `en.json` structure.
- [ ] **System Locale Verification:** Verify that the app renders using the device locale on startup, including translations and number/date formatting.
- [ ] **Pluralization Test:** Verify that "1 asset" vs "2 assets" displays correctly in both English and the second locale using `i18next` pluralization rules.
- [ ] **Unit Tests:** Add tests to `app/services/__tests__/format.test.ts` to verify number and date formatting across different locales (e.g., `en-US` vs `it-IT`).

## Out of Scope

- Overhauling the UI for Right-to-Left (RTL) support (this milestone ensures *string* readiness, but layout adjustments are separate).
- Translating the app into 10+ languages (focus is on the *system*).
- Localizing developer-facing logs or non-user-facing metadata.
