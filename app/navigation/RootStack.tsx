import * as React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { useAppStore } from "../store/useAppStore";
import { useResolvedTheme } from "../hooks/useResolvedTheme";

import RootTabs from "./RootTabs";
import LandingNoWallet from "../screens/LandingNoWallet";
import IntroCarousel from "../screens/IntroCarousel";
import RestoreWallet from "../screens/RestoreWallet";
import UnlockScreen from "../screens/UnlockScreen";
import TransactionsScreen from "../screens/TransactionsScreen";
import ProfilePreferences from "../screens/ProfilePreferences";
import ProfileBackup from "../screens/ProfileBackup";
import ProfileLock from "../screens/ProfileLock";
import ProfileReset from "../screens/ProfileReset";

export type RootStackParamList = {
  Landing: undefined;
  IntroCarousel: undefined;
  RestoreWallet: undefined;
  Unlock: undefined;
  Main: undefined;
  Transactions: undefined;
  ProfilePreferences: undefined;
  ProfileBackup: undefined;
  ProfileLock: undefined;
  ProfileReset: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function RootStack() {
  const theme = useResolvedTheme();
  const walletContainer = useAppStore((s) => s.walletContainer);
  const security = useAppStore((s) => s.security);

  const headerStyle = {
    backgroundColor: theme.colors.background,
  };
  const headerTintColor = theme.colors.text;

  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: theme.colors.background },
        animation: "fade",
      }}
    >
      {!walletContainer ? (
        // No wallet flow
        <>
          <Stack.Screen name="Landing" component={LandingNoWallet} />
          <Stack.Screen name="IntroCarousel" component={IntroCarousel} />
          <Stack.Screen name="RestoreWallet" component={RestoreWallet} options={{
            headerShown: true,
            title: "Restore Wallet",
            headerStyle,
            headerTintColor,
          }} />
        </>
      ) : security.isLocked ? (
        // Locked flow
        <Stack.Screen name="Unlock" component={UnlockScreen} />
      ) : (
        // Main app flow
        <>
          <Stack.Screen name="Main" component={RootTabs} />
          <Stack.Screen
            name="Transactions"
            component={TransactionsScreen}
            options={{
              headerShown: true,
              title: "Transactions",
              headerStyle,
              headerTintColor,
            }}
          />
          <Stack.Screen
            name="ProfilePreferences"
            component={ProfilePreferences}
            options={{
              headerShown: true,
              title: "Preferences",
              headerStyle,
              headerTintColor,
            }}
          />
          <Stack.Screen
            name="ProfileBackup"
            component={ProfileBackup}
            options={{
              headerShown: true,
              title: "Backup",
              headerStyle,
              headerTintColor,
            }}
          />
          <Stack.Screen
            name="ProfileLock"
            component={ProfileLock}
            options={{
              headerShown: true,
              title: "Lock Wallet",
              headerStyle,
              headerTintColor,
            }}
          />
          <Stack.Screen
            name="ProfileReset"
            component={ProfileReset}
            options={{
              headerShown: true,
              title: "Reset Wallet",
              headerStyle,
              headerTintColor,
            }}
          />
        </>
      )}
    </Stack.Navigator>
  );
}
