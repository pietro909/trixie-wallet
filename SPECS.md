# Agent Instructions — Expo-only Wallet App (iOS / Android)

> **Status (2026-04-27):** Initial build delivered. Wallet creation, lock/unlock (password + biometrics), theming, navigation (RootStack + RootTabs), and the spec'd screens are in place. Lint and `tsc --noEmit` are clean. Implementation choices that were left open by the spec: **Expo SDK 55** (RN 0.83 / React 19.2), **pnpm** for the package manager (`node-linker=hoisted`), **Biome** for linting, **`@react-navigation/native-stack`** for the stack (with a custom Android header — see [ISSUES.md](./ISSUES.md) item 8). Open follow-ups live in [ISSUES.md](./ISSUES.md); architecture lives in [CLAUDE.md](./CLAUDE.md).

You are a senior React Native engineer. Build a production-quality starter app using **Expo + React Native (TypeScript)**. The app must run on **iOS and Android from day #1** with premium UX: smooth animations, subtle transitions, responsive interactions, and no “stuck” feeling.

Prioritize native mobile readability, UX quality, platform conventions, and performance. Nothing should compromise the mobile experience.

> **Non-negotiable additions**
> - Icons are **strictly** `lucide-react-native`.
> - Navigation must be built on the provided **React Navigation bottom tabs** implementation (`RootTabs.tsx`) below. Extend it—don’t replace it.

---

## 0) Provided Navigation Baseline (must keep)

Use this exact file as the baseline and wire the rest of the app around it.

```tsx
import * as React from "react";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Network, WalletMinimal, CircleUserRound } from "lucide-react-native";

import { makeBottomTabsOptions, TabIcon, useAppTheme } from "../theme/theme";

import NetworksScreen from "../screens/NetworksScreen";
import WalletScreen from "../screens/WalletScreen";
import ProfileScreen from "../screens/ProfileScreen";

export type RootTabsParamList = {
  Networks: undefined;
  Wallet: undefined;
  Profile: undefined;
};

const Tab = createBottomTabNavigator<RootTabsParamList>();

export default function RootTabs() {
  const theme = useAppTheme();
  const insets = useSafeAreaInsets();

  return (
    <Tab.Navigator
      screenOptions={({ route }) => {
        const base = makeBottomTabsOptions(theme, {
          bottomInset: Math.max(0, insets.bottom - 6),
          blur: true,
          animation: "fade", // enable after you confirm it's stable in your setup
        });

        return {
          ...base,
          tabBarIcon: ({ focused, color, size }) => {
            const Icon =
              route.name === "Networks"
                ? Network
                : route.name === "Wallet"
                ? WalletMinimal
                : CircleUserRound;

            return (
              <TabIcon
                focused={focused}
                color={color}
                size={size ?? 24}
                theme={theme}
                Icon={Icon}
              />
            );
          },
        };
      }}
    >
      <Tab.Screen name="Networks" component={NetworksScreen} />
      <Tab.Screen name="Wallet" component={WalletScreen} />
      <Tab.Screen name="Profile" component={ProfileScreen} />
    </Tab.Navigator>
  );
}
```

### Requirements for tabs
- The **Wallet** tab is the **default** and should feel **more prominent** (styling handled via your `makeBottomTabsOptions` / `TabIcon` / theme system).
- Keep lucide icons:
  - Networks: `Network`
  - Wallet: `WalletMinimal`
  - Profile: `CircleUserRound`

---

## 1) Hard Constraints

- **Expo-only** React Native app.
- Must work from day one on:
  - **iOS**
  - **Android**
- User is **never logged in**.
- Wallet lives only in **local AsyncStorage**, as **JSON**.
- App must **always show activity indicators**: no dead air, no “stuck” feeling.
- Sensitive data including passwords, private keys, seeds, and similar secrets must always be encrypted at rest.
- Avoid long-lived in-memory exposure of sensitive data. Only decrypt/use secrets for the minimum time required by a specific action.
- Prioritize native mobile UX, performance, gestures, animations, haptics, and platform conventions.

---

## 2) Tech Stack

### Required libraries
- React Navigation
  - bottom tabs (`@react-navigation/bottom-tabs`)
  - native-stack for sub-screens (`@react-navigation/native-stack`)
- Animations:
  - `react-native-reanimated`
  - `react-native-gesture-handler`
  - `moti` optional but recommended for speed/polish
- Persistence:
  - `@react-native-async-storage/async-storage`
- Biometrics:
  - `expo-local-authentication`
  - Must gracefully handle unavailable or unenrolled biometrics on iOS/Android
- Haptics:
  - `expo-haptics`
- Icons:
  - ✅ `lucide-react-native` only
- Typography:
  - Inter via `@expo-google-fonts/inter` + `expo-font`
- State:
  - `zustand` store with typed selectors/actions
- Optional:
  - toast/snackbar solution, or implement a minimal custom one if needed

---

## 3) App Architecture

Use a **Root Stack** that decides what to show:

- `AppStartupGate` (hydration + routing)
- If **no wallet** → `LandingNoWallet`
- If **wallet exists** and locked → `Unlock`
- Else → `RootTabs` (provided)

### Navigation structure (recommended)
- **RootStack**
  - `LandingNoWallet`
  - `IntroCarousel`
  - `RestoreWallet` (disabled)
  - `Unlock`
  - `RootTabs` (contains Networks/Wallet/Profile)
  - `Transactions` (from Wallet)
  - `ProfilePreferences`
  - `ProfileBackup`
  - `ProfileLock`
  - `ProfileReset`

> You may group Profile subpages under a Profile stack if you prefer, but keep the mental model simple and stable.

---

## 4) Persisted Data Model (Local JSON)

Storage key: `app_state_v1`

```ts
type ThemePref = "system" | "light" | "dark";

type AppState = {
  schemaVersion: 1;
  walletContainer: WalletContainer | null;
  preferences: {
    theme: ThemePref;
    fiatCurrency: "EUR" | "USD" | "GBP"; // default EUR
  };
  security: {
    isLocked: boolean;
    passwordHash?: string;
    biometricsEnabled: boolean;
  };
};

type WalletContainer = {
  wallets: Wallet[];
  activeWalletId: string;
};

type Wallet = {
  id: string;
  type: "arkade" | "onchain" | "lightning"; // only "arkade" now
  label: string; // "Arkade"
  balanceSats: number;
  transactions: Transaction[];
  backup: {
    privateKeyHex: string;
    privateKeyNsec?: string;
    mnemonic?: string; // placeholder ok for now
  };
};

type Transaction = {
  id: string;
  direction: "in" | "out";
  amountSats: number;
  timestamp: number; // unix ms
  counterpartyLabel: string;
  status: "pending" | "confirmed";
};
```

Notes:
- Balances/transactions can be mocked, but structure must be future-proof.
- Fiat conversion can use a mocked rate constant for now.

---

## 5) UX Rules (Non-negotiable)

### “Never stuck”
Every async action must provide feedback:
- Hydration: full-screen loader
- Create wallet: animated loading screen with staged progress messages
- Buttons: loading state + disabled
- Lists: skeleton placeholders while loading
- Errors: toast/snackbar + inline messages (no silent failures)

### Animations
- Subtle screen transitions
- Press feedback (scale/opacity) + haptics
- Modals: smooth fade/slide and proper backdrop

### Visual style
- Premium minimal style: whitespace, rounded corners, subtle shadows
- Light/dark theme, respects “system”
- Inter font with balanced scale

---

## 6) Screen Specs

### A) App Startup Gate
- Load persisted state from AsyncStorage
- Show branded full-screen animated loader while loading
- Route:
  - If `walletContainer === null` → `LandingNoWallet`
  - Else if locked / password / biometrics required → `Unlock`
  - Else → `RootTabs`

---

### B) Landing (No Wallet)
- Greeting header
- “Learn more” button → opens **3-step carousel intro** (placeholder images, pagination dots)
- Two CTAs:
  - **Create new wallet**
  - **Restore wallet** (disabled for now but navigates to restore screen with disabled submit)

Create flow:
- Tap → fancy loading screen (simulate 2–3 seconds with staged messages)
- Generate wallet JSON + persist
- Navigate to `RootTabs` (Wallet tab)

---

### C) Restore Wallet (Disabled)
- Private key input: supports **NSEC or Hex** (validation OK)
- Seed phrase input visible but disabled
- Primary action disabled + “Work in progress”

---

### D) Unlock
- Password unlock if `passwordHash` exists
- Biometrics if enabled (best-effort)
- Failure → shake + inline error; never block UI

---

### E) Wallet (Tab)
- Wallet container is swipeable left/right (future multi-wallet), but starts with 1 wallet (“Arkade”)
- Big Balance (sats) + fiat equivalent (EUR default)
- Last 4 transactions preview + “See all” → Transactions screen
- Send + Receive buttons:
  - Tap → modal “Work in progress”
- Stats card placeholder:
  - VTXO renewal, swaps, on-chain activity (mock)

---

### F) Transactions
- Full list (mock ok)
- Nice empty state

---

### G) Networks (Tab)
- Placeholder “Coming soon”

---

### H) Profile (Tab)
List items:
1) Preferences
   - Theme: system/light/dark
   - Fiat currency: EUR/USD/GBP
2) Backup
   - Private key (masked, reveal + copy)
   - Mnemonic (masked, reveal + copy)
3) Lock wallet
   - If no password set → set password + confirm + biometrics toggle
   - Else lock immediately → go to Unlock
4) Reset wallet
   - Big warning
   - Confirm via typing `RESET` or long-press
   - Wipe AsyncStorage and go back to Landing

---

## 7) State Management

Implement a typed `zustand` store with actions:
- `hydrate()`
- `createWallet()`
- `lockWallet()`
- `unlockWithPassword()`
- `unlockWithBiometrics()`
- `resetWallet()`
- `setTheme()`
- `setFiatCurrency()`

Also implement:
- `LoadingOverlay` controlled by a `useLoading()` hook or store slice
- `runAsync(action, { loadingMessage })` helper that:
  - toggles overlay
  - handles errors via toast/snackbar
  - always clears loading state (finally)

---

## 8) Acceptance Criteria

Must-have:
- App runs on iOS/Android day one
- Your `RootTabs.tsx` baseline is preserved and used
- Wallet creation persists to AsyncStorage and survives reload
- App never feels stuck; all async has feedback
- Light/dark works, typography looks good, lucide icons everywhere
- Restore + Send/Receive + Networks are present but clearly “Work in progress”
- Lock/unlock works with password; biometrics is best-effort

Nice-to-have:
- Skeleton loaders, toasts, micro-interactions, haptics polish

---

## 9) Output Requirements (What to Deliver)

1) File tree (screens, navigation, theme, store, components)
2) Key files: store + persistence, `RootStack`, `RootTabs`, theme system, loading overlay
3) Run instructions for iOS / Android

---

If you also share your `theme/theme` helpers (`makeBottomTabsOptions`, `TabIcon`, `useAppTheme`), we can bake exact integration rules into this task so an agent can’t accidentally break your styling setup.

---

## 10) Follow-up Task: Receive Flow

Build a production-quality receive flow that replaces the current Receive “Work in progress” modal.

### Product direction

Use an explicit payment-type picker before showing a QR code:
- `Wallet` → `Receive` → payment type picker
- `Arkade` → show Arkade receive QR code
- `Bitcoin` → show Bitcoin receive QR code
- `LNURL` → show LNURL receive QR code
- `Lightning` → amount input → generate invoice → show Lightning invoice QR code

This adds one tap, but it is less confusing than showing a combined receive screen first. Each QR screen has one clear meaning, and the user always knows which payment rail they are sharing.

### Supported receive types

The supported URLs/addresses are:
- Arkade
- Bitcoin
- Lightning
- LNURL

Do not add a “Unified” receive option unless it becomes an explicit product requirement later.

### UX requirements

- Tapping `Receive` from the Wallet screen opens the payment-type picker.
- The picker must show all four supported receive types with clear labels and short helper text.
- Arkade, Bitcoin, and LNURL can show the QR screen immediately.
- Lightning requires an amount before an invoice is generated.
- The amount input is optional for non-Lightning receive types.
- If the user enters an amount for non-Lightning receive types, include that amount in the generated receive payload only if the target format supports it.
- The QR screen must show:
  - Back navigation
  - Screen title matching the selected payment type
  - Large scannable QR code
  - Optional amount/minimum note when relevant
  - Copy action for the selected payload
  - Share action for the selected payload
  - A list of all available receive payloads with individual copy buttons
- The list of receive payloads should include Lightning only after an amount-backed invoice exists.
- Copy actions must actually write to the native clipboard, not just show a toast.
- Share should use the native platform share sheet.
- All async work must show loading feedback and error feedback.

### Implementation notes

- Keep navigation inside the existing `RootStack`.
- Add dedicated receive routes instead of overloading the Wallet screen.
- Use `lucide-react-native` for icons only.
- Use `expo-clipboard` for copy behavior.
- Use React Native `Share` for sharing unless there is a strong reason to add another dependency.
- Use a QR code library that works reliably in Expo on iOS and Android.
- Keep generated receive data in memory unless there is a clear reason to persist it.
- Mock receive payload generation is acceptable for the first pass, but isolate it behind a small helper/service so the real Arkade SDK integration can replace it later.

### Acceptance criteria

- `Receive` no longer opens the WIP modal.
- User can choose Arkade, Bitcoin, Lightning, or LNURL before seeing a QR code.
- Arkade, Bitcoin, and LNURL flows show a QR code without requiring an amount.
- Lightning flow requires an amount, generates an invoice only after amount submission, then shows a QR code.
- QR payload can be copied and shared.
- Each listed payload has its own copy button.
- Missing/failed payload generation shows a user-visible error.
- The flow works on iOS and Android with no web-specific code paths.

---

## 11) Follow-up Task: Send Flow

Build a production-quality send flow that replaces the current Send “Work in progress” modal.

### Product direction

Use scan/paste as the first step, then show the payment options recognized from the scanned QR code or pasted string:
- `Wallet` → `Send` → scan QR code or paste payment string
- Parse the input
- Show recognized payable options
- User selects Arkade, Bitcoin, Lightning, or LNURL when more than one option is available
- Continue to amount/review/confirmation based on the selected payment type

This keeps the first interaction fast while avoiding hidden routing decisions. A BIP-21 QR can encode more than one way to pay, so the app should surface those recognized options instead of silently choosing one.

### Supported input types

The parser must recognize:
- BIP-21 Bitcoin URIs, including query parameters that encode additional payment options
- Arkade payment URLs/addresses
- Bitcoin on-chain addresses and `bitcoin:` URIs
- Lightning invoices
- LNURL pay/request URLs

For BIP-21, parse the base on-chain payment target and all supported embedded alternatives. If a QR or pasted string contains both Bitcoin and Arkade/Lightning/LNURL options, show them as separate selectable payment methods.

### UX requirements

- Tapping `Send` from the Wallet screen opens the send entry screen.
- The send entry screen must offer:
  - QR scanning
  - Paste/input field
  - Clear/reset action
  - Loading and error states
- QR scanning should parse immediately after a successful scan.
- Paste/input should parse after submit, not on every keystroke.
- After parsing, show a list of recognized payment options.
- Each recognized option should show:
  - Payment type
  - Destination preview
  - Amount, if the payload includes one
  - Description/memo, if available
  - Warning state if the option is recognized but cannot currently be paid
- If exactly one payable option is recognized, the app may continue automatically only if there is no ambiguity. Prefer showing the option with a clear continue action for the first implementation.
- If no supported option is recognized, show a clear error and keep the original input editable.
- If an amount is included in the payload, prefill it and make clear whether it is fixed or editable.
- If no amount is included, request an amount before review for payment types that require one.
- Always show a review screen before sending.
- The review screen must show:
  - Payment type
  - Destination preview
  - Amount in sats
  - Fee estimate placeholder
  - Total placeholder
  - Optional memo/description
  - Confirm button with loading state
- The confirm action can be mocked in the first pass, but it must produce success/failure feedback and a transaction-like result.

### Implementation notes

- Keep navigation inside the existing `RootStack`.
- Add dedicated send routes instead of overloading the Wallet screen.
- Use `lucide-react-native` for icons only.
- Use Expo-compatible QR scanning APIs. Prefer the Expo camera/barcode scanner path that is current for the installed Expo SDK.
- Use `expo-clipboard` for paste-from-clipboard convenience if needed, but also support manual text entry.
- Isolate parsing into a small helper/service, for example `app/services/paymentParser.ts`.
- The parser should return a normalized structure such as:

```ts
type ParsedPaymentOption = {
  id: string;
  type: "arkade" | "bitcoin" | "lightning" | "lnurl";
  raw: string;
  destination: string;
  amountSats?: number;
  memo?: string;
  isPayable: boolean;
  warning?: string;
};
```

- Keep send execution behind a separate helper/service so real Arkade SDK and Bitcoin/Lightning integrations can replace the mock behavior later.
- Do not silently discard unknown BIP-21 parameters; keep them available in parser metadata for future integrations.
- Never log full payment payloads in production paths.

### Acceptance criteria

- `Send` no longer opens the WIP modal.
- User can scan a QR code or paste/type a payment string.
- BIP-21 inputs are parsed into all recognized supported payment options.
- Multiple recognized options are shown as a selectable list.
- Arkade, Bitcoin, Lightning, and LNURL options are labeled clearly.
- Amounts and memos from the payload are preserved and displayed.
- Unsupported or malformed inputs show a user-visible error.
- User sees a review screen before confirming.
- Confirm send has loading, success, and failure feedback.
- The flow works on iOS and Android with no web-specific code paths.
