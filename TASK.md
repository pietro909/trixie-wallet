# Agent Instructions — Expo-only Wallet App (iOS / Android)

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
  - bottom tabs
  - stack navigator for sub-screens
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
  type: "ark" | "onchain" | "lightning"; // only "ark" now
  label: string; // "Ark"
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
- Wallet container is swipeable left/right (future multi-wallet), but starts with 1 wallet (“Ark”)
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
